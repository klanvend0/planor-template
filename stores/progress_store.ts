/**
 * Per-lesson progress and the unlock rules built on top of it.
 *
 * Holds the `lesson_progress` rows for the active course and answers the two
 * questions the learn map asks constantly: is this lesson unlocked, and how far
 * through the unit is the learner.
 *
 * @module stores/progress_store
 */

import { create } from 'zustand';

import { FREE_UNIT_LIMIT } from '@/lib/constants';
import { toAppError, type AppError } from '@/lib/errors';
import type { CourseId } from '@/lib/content_schema';
import { getCourseLessons, getUnits } from '@/services/content_service';
import {
  fetchLessonProgress,
  type LessonProgress,
  type LessonResult,
} from '@/services/progress_service';

export type LessonStatus = 'locked' | 'available' | 'completed' | 'premium_locked';

type ProgressStoreState = {
  byLesson: Record<string, LessonProgress>;
  loadedCourse: CourseId | null;
  isLoading: boolean;
  error: AppError | null;
};

type ProgressStoreActions = {
  load: (courseId: CourseId, options?: { force?: boolean }) => Promise<void>;
  /** Fold a finished lesson into the local map without a refetch. */
  applyResult: (params: {
    lessonId: string;
    unitId: string;
    courseId: CourseId;
    result: Pick<LessonResult, 'score' | 'stars' | 'xpAwarded'>;
  }) => void;
  clear: () => void;
};

export const useProgressStore = create<ProgressStoreState & ProgressStoreActions>((set, get) => ({
  byLesson: {},
  loadedCourse: null,
  isLoading: false,
  error: null,

  load: async (courseId, options) => {
    if (!options?.force && get().loadedCourse === courseId && !get().error) return;
    set({ isLoading: true, error: null });
    try {
      const rows = await fetchLessonProgress(courseId);
      const byLesson: Record<string, LessonProgress> = {};
      for (const row of rows) byLesson[row.lessonId] = row;
      set({ byLesson, loadedCourse: courseId, isLoading: false });
    } catch (error) {
      const appError = toAppError(error);
      // Keep whatever we already show when the failure is just connectivity.
      set({ isLoading: false, error: appError.code === 'network' ? null : appError });
    }
  },

  applyResult: ({ lessonId, unitId, courseId, result }) =>
    set((state) => {
      const previous = state.byLesson[lessonId];
      const bestScore = Math.max(previous?.bestScore ?? 0, result.score);
      return {
        byLesson: {
          ...state.byLesson,
          [lessonId]: {
            lessonId,
            unitId,
            courseId,
            status: bestScore >= 50 ? 'completed' : 'in_progress',
            bestScore,
            stars: Math.max(previous?.stars ?? 0, result.stars),
            attempts: (previous?.attempts ?? 0) + 1,
            xpEarned: (previous?.xpEarned ?? 0) + result.xpAwarded,
            firstCompletedAt: previous?.firstCompletedAt ?? new Date().toISOString(),
          },
        },
      };
    }),

  clear: () => set({ byLesson: {}, loadedCourse: null, error: null }),
}));

/** True when the lesson has been finished at least once with a passing score. */
export function isLessonCompleted(
  byLesson: Record<string, LessonProgress>,
  lessonId: string
): boolean {
  return byLesson[lessonId]?.status === 'completed';
}

/**
 * Resolve the state of a lesson on the learn map.
 *
 * Lessons unlock strictly in order so nothing appears before it has been taught;
 * units past {@link FREE_UNIT_LIMIT} additionally need a subscription.
 */
export function lessonStatus(params: {
  byLesson: Record<string, LessonProgress>;
  courseId: CourseId;
  lessonId: string;
  hasSubscription: boolean;
}): LessonStatus {
  const { byLesson, courseId, lessonId, hasSubscription } = params;
  const lessons = getCourseLessons(courseId);
  const position = lessons.findIndex((entry) => entry.lesson.id === lessonId);
  if (position < 0) return 'locked';

  const unitIndex = lessons[position].unit.index;
  if (!hasSubscription && unitIndex > FREE_UNIT_LIMIT) return 'premium_locked';

  if (isLessonCompleted(byLesson, lessonId)) return 'completed';
  if (position === 0) return 'available';

  const previous = lessons[position - 1].lesson.id;
  return isLessonCompleted(byLesson, previous) ? 'available' : 'locked';
}

/** Completed / total lessons for a unit, for the unit header ring. */
export function unitProgress(
  byLesson: Record<string, LessonProgress>,
  unitId: string,
  courseId: CourseId
): { done: number; total: number } {
  const unit = getUnits(courseId).find((entry) => entry.id === unitId);
  if (!unit) return { done: 0, total: 0 };
  const done = unit.lessons.filter((lesson) => isLessonCompleted(byLesson, lesson.id)).length;
  return { done, total: unit.lessons.length };
}

/** The lesson the "continue" button should open. */
export function nextLessonId(
  byLesson: Record<string, LessonProgress>,
  courseId: CourseId,
  hasSubscription: boolean
): string | null {
  const lessons = getCourseLessons(courseId);
  for (const entry of lessons) {
    const status = lessonStatus({
      byLesson,
      courseId,
      lessonId: entry.lesson.id,
      hasSubscription,
    });
    if (status === 'available') return entry.lesson.id;
    if (status === 'premium_locked' || status === 'locked') break;
  }
  return null;
}

/** Units where every lesson is complete, for the achievement check. */
export function completedUnitCount(
  byLesson: Record<string, LessonProgress>,
  courseId: CourseId
): number {
  return getUnits(courseId).filter((unit) =>
    unit.lessons.every((lesson) => isLessonCompleted(byLesson, lesson.id))
  ).length;
}
