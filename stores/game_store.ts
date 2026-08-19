/**
 * Gamification state.
 *
 * Mirrors the server's `game_state` row (XP, hearts, streak) and keeps playing
 * when the network does not: writes fall back to the offline queue and the local
 * copy is updated optimistically with the same rules Postgres applies.
 *
 * @module stores/game_store
 */

import { create } from 'zustand';

import { MAX_HEARTS, starsForScore } from '@/lib/gamification';
import { AppError, toAppError } from '@/lib/errors';
import type { CourseId, Question } from '@/lib/content_schema';
import {
  completeLesson as completeLessonRpc,
  fetchGameState,
  recordAnswer as recordAnswerRpc,
  refillHearts as refillHeartsRpc,
  type GameState,
  type LessonResult,
} from '@/services/progress_service';
import { useProgressStore } from '@/stores/progress_store';
import { useSyncQueue } from '@/stores/sync_queue';

type GameStoreState = {
  state: GameState | null;
  isLoading: boolean;
  isRefreshing: boolean;
  error: AppError | null;
  /** True while the last write only landed locally. */
  pendingSync: boolean;
};

type GameStoreActions = {
  /** Load state from the server. Safe to call on every app foreground. */
  refresh: (options?: { silent?: boolean }) => Promise<void>;
  /** Report one answer; returns the hearts left afterwards. */
  submitAnswer: (params: {
    question: Pick<Question, 'id' | 'type'>;
    lessonId: string;
    courseId: CourseId;
    isCorrect: boolean;
    answer?: string;
    durationMs?: number;
    isPractice?: boolean;
  }) => Promise<{ heartsLeft: number; unlimitedHearts: boolean }>;
  /** Close a lesson and collect the reward. */
  finishLesson: (params: {
    lessonId: string;
    unitId: string;
    courseId: CourseId;
    correct: number;
    total: number;
    baseXp: number;
    playedOn?: string;
  }) => Promise<LessonResult>;
  refill: () => Promise<void>;
  /** Overwrite the subscription flag when RevenueCat reports a change. */
  setSubscribed: (isSubscribed: boolean) => void;
  clear: () => void;
};

const emptyState: GameStoreState = {
  state: null,
  isLoading: true,
  isRefreshing: false,
  error: null,
  pendingSync: false,
};

/** Local mirror of the server's scoring, used when a write has to be queued. */
function localLessonResult(
  state: GameState | null,
  params: {
    correct: number;
    total: number;
    baseXp: number;
  }
): LessonResult {
  const score = Math.round((params.correct / Math.max(1, params.total)) * 100);
  const perfectBonus = score === 100 ? 10 : 0;
  const awarded = Math.round(params.baseXp * (score / 100)) + perfectBonus;
  const today = new Date().toISOString().slice(0, 10);
  const streak =
    state?.lastActiveDate === today ? (state?.streakDays ?? 0) : (state?.streakDays ?? 0) + 1;

  return {
    totalXp: (state?.totalXp ?? 0) + awarded,
    xpAwarded: awarded,
    perfectBonus,
    // The seven-day bonus depends on server-held streak history, so the
    // optimistic result never promises one; the real figure lands on sync.
    streakBonus: 0,
    streakDays: streak,
    hearts: state?.hearts ?? MAX_HEARTS,
    stars: score === 100 ? 3 : score >= 80 ? 2 : score >= 50 ? 1 : 0,
    score,
    isFirstCompletion: true,
    dailyXp: (state?.dailyXp ?? 0) + awarded,
  };
}

export const useGameStore = create<GameStoreState & GameStoreActions>((set, get) => ({
  ...emptyState,

  refresh: async (options) => {
    if (!options?.silent) set({ isRefreshing: true });
    try {
      // Land any offline writes first so the state we read is the final one.
      await useSyncQueue.getState().flush();
      const state = await fetchGameState();
      set({ state, isLoading: false, isRefreshing: false, error: null, pendingSync: false });
    } catch (error) {
      const appError = toAppError(error);
      set({
        isLoading: false,
        isRefreshing: false,
        // Offline is not an error worth shouting about when we have a cached state.
        error: appError.code === 'network' && get().state ? null : appError,
      });
    }
  },

  submitAnswer: async (params) => {
    const state = get().state;
    const unlimited = state?.hasSubscription ?? false;

    try {
      const outcome = await recordAnswerRpc(params);
      set((current) => ({
        state: current.state ? { ...current.state, hearts: outcome.heartsLeft } : current.state,
        pendingSync: false,
      }));
      return outcome;
    } catch (error) {
      const appError = toAppError(error);
      if (appError.code !== 'network') throw appError;

      useSyncQueue.getState().enqueue({
        kind: 'answer',
        payload: {
          questionId: params.question.id,
          questionType: params.question.type,
          lessonId: params.lessonId,
          courseId: params.courseId,
          isCorrect: params.isCorrect,
          answer: params.answer,
          durationMs: params.durationMs,
          isPractice: params.isPractice,
        },
      });

      const heartsLeft =
        params.isCorrect || unlimited || params.isPractice
          ? (state?.hearts ?? MAX_HEARTS)
          : Math.max(0, (state?.hearts ?? MAX_HEARTS) - 1);

      set((current) => ({
        state: current.state ? { ...current.state, hearts: heartsLeft } : current.state,
        pendingSync: true,
      }));

      return { heartsLeft, unlimitedHearts: unlimited };
    }
  },

  finishLesson: async (params) => {
    try {
      const result = await completeLessonRpc(params);
      set((current) => ({
        state: current.state
          ? {
              ...current.state,
              totalXp: result.totalXp,
              hearts: result.hearts,
              streakDays: result.streakDays,
              longestStreak: Math.max(current.state.longestStreak, result.streakDays),
              dailyXp: result.dailyXp,
              lessonsCompleted:
                current.state.lessonsCompleted +
                (result.isFirstCompletion && result.score >= 50 ? 1 : 0),
              lastActiveDate: new Date().toISOString().slice(0, 10),
            }
          : current.state,
        pendingSync: false,
      }));
      return result;
    } catch (error) {
      const appError = toAppError(error);
      if (appError.code !== 'network') throw appError;

      useSyncQueue.getState().enqueue({
        kind: 'lesson',
        payload: { ...params, playedOn: new Date().toISOString().slice(0, 10) },
      });
      const result = localLessonResult(get().state, params);

      set((current) => ({
        state: current.state
          ? {
              ...current.state,
              totalXp: result.totalXp,
              streakDays: result.streakDays,
              longestStreak: Math.max(current.state.longestStreak, result.streakDays),
              dailyXp: result.dailyXp,
              lastActiveDate: new Date().toISOString().slice(0, 10),
            }
          : current.state,
        pendingSync: true,
      }));

      return result;
    }
  },

  refill: async () => {
    const hearts = await refillHeartsRpc();
    set((current) => ({
      state: current.state
        ? { ...current.state, hearts, heartsUpdatedAt: new Date().toISOString() }
        : current.state,
    }));
  },

  setSubscribed: (isSubscribed) =>
    set((current) => ({
      state: current.state ? { ...current.state, hasSubscription: isSubscribed } : current.state,
    })),

  clear: () => set({ ...emptyState, isLoading: false }),
}));

/** Hearts left right now, defaulting to full while state loads. */
export const selectHearts = (state: GameStoreState): number => state.state?.hearts ?? MAX_HEARTS;

/** True when the learner may answer without spending a heart they do not have. */
export const selectCanPlay = (state: GameStoreState): boolean =>
  (state.state?.hasSubscription ?? false) || (state.state?.hearts ?? MAX_HEARTS) > 0;
