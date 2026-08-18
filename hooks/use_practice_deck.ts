/**
 * Practice decks.
 *
 * Two ways to practise: the mistakes deck (questions the learner got wrong and
 * has not since fixed, straight from Postgres) and quick review (a spread of
 * questions from lessons they have already completed).
 *
 * @module hooks/use_practice_deck
 */

import { useCallback, useEffect, useState } from 'react';

import { seededShuffle } from '@/lib/answer_check';
import { PRACTICE_SESSION_SIZE } from '@/lib/constants';
import { toAppError, type AppError } from '@/lib/errors';
import type { CourseId, Question } from '@/lib/content_schema';
import { getCourseLessons, getQuestion } from '@/services/content_service';
import { fetchMistakeQuestionIds } from '@/services/progress_service';
import { isLessonCompleted, useProgressStore } from '@/stores/progress_store';

export type PracticeDeck = {
  /** Questions to play, already trimmed to the session size. */
  questions: Question[];
  isLoading: boolean;
  error: AppError | null;
  reload: () => Promise<void>;
};

/**
 * Questions the learner has answered wrong and not yet fixed.
 *
 * `explain_code` questions are left out: they cost an AI call, and practice
 * should stay free-flowing.
 */
export function useMistakesDeck(courseId: CourseId): PracticeDeck {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<AppError | null>(null);

  const reload = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const ids = await fetchMistakeQuestionIds(courseId, PRACTICE_SESSION_SIZE * 2);
      const resolved = ids
        .map((id) => getQuestion(id))
        .filter((question): question is Question => !!question && question.type !== 'explain_code')
        .slice(0, PRACTICE_SESSION_SIZE);
      setQuestions(resolved);
    } catch (caught) {
      setError(toAppError(caught));
      setQuestions([]);
    } finally {
      setIsLoading(false);
    }
  }, [courseId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { questions, isLoading, error, reload };
}

/**
 * A spread of questions from finished lessons, for a warm-up that does not cost
 * hearts progress. Deterministic per day so the deck does not reshuffle under
 * the learner's thumb.
 */
export function useQuickReviewDeck(courseId: CourseId): PracticeDeck {
  const byLesson = useProgressStore((state) => state.byLesson);
  const [questions, setQuestions] = useState<Question[]>([]);

  const build = useCallback(() => {
    const completed = getCourseLessons(courseId).filter((entry) =>
      isLessonCompleted(byLesson, entry.lesson.id)
    );

    const pool = completed.flatMap((entry) =>
      entry.lesson.questions.filter((question) => question.type !== 'explain_code')
    );

    const today = new Date().toISOString().slice(0, 10);
    setQuestions(seededShuffle(pool, `${courseId}-${today}`).slice(0, PRACTICE_SESSION_SIZE));
  }, [byLesson, courseId]);

  useEffect(() => {
    build();
  }, [build]);

  return {
    questions,
    isLoading: false,
    error: null,
    reload: async () => build(),
  };
}
