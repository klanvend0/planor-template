/**
 * Offline write queue.
 *
 * Lessons are bundled, so a learner can finish one on a plane. The answers and
 * lesson results they produce are queued here and replayed in order the next
 * time a call succeeds, which keeps XP and streaks honest without blocking play.
 *
 * Constraints:
 * - Replay has to be free. The queue is at-least-once by construction — an
 *   entry is dropped only after the write is acknowledged, so a response lost
 *   after the server committed comes back around. Answers therefore carry an
 *   `attemptId` the server dedupes on, and `complete_lesson` pays for score
 *   improvement only, so replaying either one costs nothing.
 * - The queue is capped; the oldest entries are dropped first so a long offline
 *   stretch cannot grow storage without bound.
 *
 * @module stores/sync_queue
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { AppError, toAppError } from '@/lib/errors';
import type { CourseId, QuestionType } from '@/lib/content_schema';
import { completeLesson, recordAnswer } from '@/services/progress_service';

const MAX_ENTRIES = 200;

export type QueuedAnswer = {
  id: string;
  kind: 'answer';
  queuedAt: number;
  /** The learner this write belongs to; see {@link setQueueOwner}. */
  userId?: string;
  payload: {
    questionId: string;
    questionType: QuestionType;
    lessonId: string;
    courseId: CourseId;
    isCorrect: boolean;
    answer?: string;
    durationMs?: number;
    isPractice?: boolean;
    /** Minted before the first attempt, so the replay dedupes against it. */
    attemptId?: string;
  };
};

export type QueuedLesson = {
  id: string;
  kind: 'lesson';
  queuedAt: number;
  userId?: string;
  payload: {
    lessonId: string;
    unitId: string;
    courseId: CourseId;
    correct: number;
    total: number;
    baseXp: number;
    /** Local date the lesson was played, so a late sync still counts that day. */
    playedOn?: string;
  };
};

export type QueuedWrite = QueuedAnswer | QueuedLesson;

type SyncQueueState = {
  entries: QueuedWrite[];
  flushing: boolean;
  /**
   * Who the queued writes belong to. Devices are shared and accounts are
   * deleted, so writes from a previous session must never be replayed into
   * whoever signs in next.
   */
  ownerId: string | null;
};

type SyncQueueActions = {
  enqueue: (
    entry: Omit<QueuedAnswer, 'id' | 'queuedAt'> | Omit<QueuedLesson, 'id' | 'queuedAt'>
  ) => void;
  /** Bind the queue to a learner, dropping anything left by a different one. */
  setOwner: (userId: string | null) => void;
  /** Replay pending writes oldest-first. Stops at the first network failure. */
  flush: () => Promise<number>;
  clear: () => void;
};

let counter = 0;
const nextId = (): string => {
  counter += 1;
  return `${Date.now().toString(36)}-${counter.toString(36)}`;
};

export const useSyncQueue = create<SyncQueueState & SyncQueueActions>()(
  persist(
    (set, get) => ({
      entries: [],
      flushing: false,
      ownerId: null,

      setOwner: (userId) =>
        set((state) => {
          // A different learner (or none): their queue is not this one's to send.
          if (state.ownerId === userId) return { ownerId: userId };
          return { ownerId: userId, entries: [] };
        }),

      enqueue: (entry) =>
        set((state) => {
          const next = [
            ...state.entries,
            { ...entry, id: nextId(), queuedAt: Date.now() } as QueuedWrite,
          ];
          return { entries: next.slice(-MAX_ENTRIES) };
        }),

      flush: async () => {
        if (get().flushing || get().entries.length === 0) return 0;
        if (!get().ownerId) return 0;
        set({ flushing: true });

        let replayed = 0;
        try {
          // Re-read the queue each round: a lesson can finish mid-flush.
          while (get().entries.length > 0) {
            const [entry, ...rest] = get().entries;

            // Belt and braces: an entry stamped with another learner is dropped
            // rather than sent, even if setOwner was missed somehow.
            if (entry.userId && entry.userId !== get().ownerId) {
              set({ entries: rest });
              continue;
            }

            try {
              if (entry.kind === 'answer') {
                await recordAnswer({
                  question: { id: entry.payload.questionId, type: entry.payload.questionType },
                  lessonId: entry.payload.lessonId,
                  courseId: entry.payload.courseId,
                  isCorrect: entry.payload.isCorrect,
                  answer: entry.payload.answer,
                  durationMs: entry.payload.durationMs,
                  isPractice: entry.payload.isPractice,
                  attemptId: entry.payload.attemptId,
                });
              } else {
                await completeLesson(entry.payload);
              }
              set({ entries: rest });
              replayed += 1;
            } catch (error) {
              const appError = error instanceof AppError ? error : toAppError(error);
              // Still offline (or signed out): keep everything for the next try.
              if (appError.code === 'network' || appError.code === 'auth') break;
              // A payload the server refuses would block the queue forever.
              set({ entries: rest });
            }
          }
        } finally {
          set({ flushing: false });
        }

        return replayed;
      },

      clear: () => set({ entries: [] }),
    }),
    {
      name: 'codeling.sync_queue',
      storage: createJSONStorage(() => AsyncStorage),
      version: 1,
      partialize: ({ entries, ownerId }) => ({ entries, ownerId }),
    }
  )
);

/** Number of writes still waiting, for the "syncing" indicator. */
export const pendingWriteCount = (): number => useSyncQueue.getState().entries.length;
