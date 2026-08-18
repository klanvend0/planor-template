/**
 * Profile statistics.
 *
 * Collects everything the profile screen and the achievement grid need: the
 * server's game state plus the derived counts that only the bundled content can
 * answer (how many units are finished, how many courses have been started).
 *
 * @module hooks/use_profile_stats
 */

import { useCallback, useEffect, useState } from 'react';

import type { AchievementStats } from '@/lib/gamification';
import { listCourses } from '@/services/content_service';
import { countPassedAiReviews, fetchAllLessonProgress } from '@/services/progress_service';
import { useGameStore } from '@/stores/game_store';

export type ProfileStats = {
  stats: AchievementStats;
  isLoading: boolean;
  reload: () => Promise<void>;
};

const EMPTY: AchievementStats = {
  totalXp: 0,
  streakDays: 0,
  longestStreak: 0,
  lessonsCompleted: 0,
  perfectLessons: 0,
  aiReviewsPassed: 0,
  coursesStarted: 0,
  unitsCompleted: 0,
};

export function useProfileStats(): ProfileStats {
  const gameState = useGameStore((state) => state.state);
  const [derived, setDerived] = useState({ aiReviewsPassed: 0, coursesStarted: 0, unitsCompleted: 0 });
  const [isLoading, setIsLoading] = useState(true);

  const reload = useCallback(async () => {
    setIsLoading(true);
    try {
      const [rows, aiReviewsPassed] = await Promise.all([
        fetchAllLessonProgress(),
        countPassedAiReviews(),
      ]);

      const completed = new Set(
        rows.filter((row) => row.status === 'completed').map((row) => row.lessonId)
      );

      let unitsCompleted = 0;
      let coursesStarted = 0;

      for (const course of listCourses()) {
        const touched = rows.some((row) => row.courseId === course.id);
        if (touched) coursesStarted += 1;

        for (const unit of course.units) {
          if (unit.lessons.every((lesson) => completed.has(lesson.id))) unitsCompleted += 1;
        }
      }

      setDerived({ aiReviewsPassed, coursesStarted, unitsCompleted });
    } catch (error) {
      // Stats are decorative; a failure must not blank the profile screen.
      console.warn('[profile] stats failed', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return {
    stats: {
      ...EMPTY,
      totalXp: gameState?.totalXp ?? 0,
      streakDays: gameState?.streakDays ?? 0,
      longestStreak: gameState?.longestStreak ?? 0,
      lessonsCompleted: gameState?.lessonsCompleted ?? 0,
      perfectLessons: gameState?.perfectLessons ?? 0,
      ...derived,
    },
    isLoading,
    reload,
  };
}
