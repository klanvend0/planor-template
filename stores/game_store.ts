/**
 * Gamification state.
 *
 * Mirrors the server's `game_state` row (XP, hearts, streak) and keeps playing
 * when the network does not: writes fall back to the offline queue and the local
 * copy is updated optimistically with the same rules Postgres applies.
 *
 * @module stores/game_store
 */

import { randomUUID } from 'expo-crypto';
import { create } from 'zustand';

import { PASS_SCORE } from '@/lib/constants';
import { MAX_HEARTS, starsForScore } from '@/lib/gamification';
import { lessonAward, scoreFor, streakAfter, toIsoDate } from '@/lib/scoring';
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

/**
 * The offline estimate.
 *
 * When the write has to be queued, this is the number the results screen shows,
 * so it follows {@link lib/scoring} — the same rules `complete_lesson` applies.
 * It remains an estimate: the server scores against `lesson_catalog`, and the
 * cached lesson row read here may be missing on a cold offline start, in which
 * case the run is treated as a first completion.
 */
function localLessonResult(
  state: GameState | null,
  params: {
    lessonId: string;
    correct: number;
    total: number;
    baseXp: number;
  }
): { result: LessonResult; streakFreezes: number; clearedFirstTime: boolean; wasPerfect: boolean } {
  const score = scoreFor(params.correct, params.total);

  const previous = useProgressStore.getState().byLesson[params.lessonId];
  const bestBefore = previous?.bestScore ?? 0;
  // The server counts an `in_progress` row as still unfinished, so a failed
  // first attempt does not spend the first completion.
  const isFirstCompletion = previous?.status !== 'completed';

  const { award, perfectBonus } = lessonAward({ score, bestBefore, baseXp: params.baseXp });
  const today = toIsoDate(Date.now());
  const streak = streakAfter({
    lastActiveDate: state?.lastActiveDate ?? null,
    playedOn: today,
    streakDays: state?.streakDays ?? 0,
    streakFreezes: state?.streakFreezes ?? 0,
  });

  const awarded = award + perfectBonus + streak.bonus;

  return {
    result: {
      totalXp: (state?.totalXp ?? 0) + awarded,
      xpAwarded: awarded,
      perfectBonus,
      streakBonus: streak.bonus,
      streakDays: streak.streakDays,
      hearts: state?.hearts ?? MAX_HEARTS,
      stars: starsForScore(score),
      score,
      isFirstCompletion,
      dailyXp: (state?.dailyXp ?? 0) + awarded,
    },
    // A spent freeze has to leave the local state too, or the same one rescues
    // every missed day until the next refresh.
    streakFreezes: streak.streakFreezes,
    clearedFirstTime: isFirstCompletion && score >= PASS_SCORE,
    wasPerfect: perfectBonus > 0,
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
    // Minted here rather than at enqueue time: the queue entry is only created
    // after the first call already failed, and the whole point is that the
    // replay carries the same id as the attempt that may have landed.
    const attemptId = randomUUID();

    try {
      const outcome = await recordAnswerRpc({ ...params, attemptId });
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
          attemptId,
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
                (result.isFirstCompletion && result.score >= PASS_SCORE ? 1 : 0),
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
      const { result, streakFreezes, clearedFirstTime, wasPerfect } = localLessonResult(
        get().state,
        params
      );

      set((current) => ({
        state: current.state
          ? {
              ...current.state,
              totalXp: result.totalXp,
              streakDays: result.streakDays,
              longestStreak: Math.max(current.state.longestStreak, result.streakDays),
              streakFreezes,
              lessonsCompleted: current.state.lessonsCompleted + (clearedFirstTime ? 1 : 0),
              perfectLessons: current.state.perfectLessons + (wasPerfect ? 1 : 0),
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
