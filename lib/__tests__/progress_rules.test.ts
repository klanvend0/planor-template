/**
 * Unlock and gating rules.
 *
 * These decide what a learner can open and what the paywall hides, so they are
 * tested against the real bundled content rather than fixtures.
 */

import { unitSchema } from '@/lib/content_schema';
import { FREE_UNIT_LIMIT } from '@/lib/constants';
import {
  countLessons,
  getCourseLessons,
  getLesson,
  getNextLesson,
  getQuestion,
  listCourses,
  listExplainQuestions,
} from '@/services/content_service';
import {
  completedUnitCount,
  lessonStatus,
  nextLessonId,
  unitProgress,
} from '@/stores/progress_store';
import type { LessonProgress } from '@/services/progress_service';

const completed = (lessonId: string, unitId: string): LessonProgress => ({
  lessonId,
  unitId,
  courseId: 'python',
  status: 'completed',
  bestScore: 100,
  stars: 3,
  attempts: 1,
  xpEarned: 90,
  firstCompletedAt: '2026-08-18T00:00:00Z',
});

describe('bundled content', () => {
  it('ships both courses with units and lessons', () => {
    const courses = listCourses();
    expect(courses.map((course) => course.id)).toEqual(['python', 'javascript']);
    for (const course of courses) {
      expect(course.units.length).toBeGreaterThan(0);
      expect(countLessons(course.id)).toBeGreaterThan(0);
    }
  });

  it('matches the schema it is validated against', () => {
    for (const course of listCourses()) {
      for (const unit of course.units) {
        expect(unitSchema.safeParse(unit).success).toBe(true);
      }
    }
  });

  it('has unique, resolvable lesson and question ids', () => {
    const lessonIds = new Set<string>();
    const questionIds = new Set<string>();

    for (const course of listCourses()) {
      for (const unit of course.units) {
        for (const lesson of unit.lessons) {
          expect(lessonIds.has(lesson.id)).toBe(false);
          lessonIds.add(lesson.id);
          expect(getLesson(lesson.id)).not.toBeNull();

          for (const question of lesson.questions) {
            expect(questionIds.has(question.id)).toBe(false);
            questionIds.add(question.id);
            expect(getQuestion(question.id)).not.toBeNull();
          }
        }
      }
    }
  });

  it('gives every lesson exactly one AI-graded question', () => {
    const explain = listExplainQuestions();
    const lessonCount = listCourses().reduce((total, course) => total + countLessons(course.id), 0);
    expect(explain).toHaveLength(lessonCount);
  });

  it('walks the course in order', () => {
    const lessons = getCourseLessons('python');
    expect(getNextLesson(lessons[0].lesson.id)?.lesson.id).toBe(lessons[1].lesson.id);
    expect(getNextLesson(lessons[lessons.length - 1].lesson.id)).toBeNull();
  });
});

describe('lessonStatus', () => {
  const lessons = getCourseLessons('python');

  it('opens the very first lesson and locks the rest', () => {
    expect(
      lessonStatus({ byLesson: {}, courseId: 'python', lessonId: lessons[0].lesson.id, hasSubscription: false })
    ).toBe('available');

    expect(
      lessonStatus({ byLesson: {}, courseId: 'python', lessonId: lessons[1].lesson.id, hasSubscription: false })
    ).toBe('locked');
  });

  it('unlocks the next lesson once the previous one is completed', () => {
    const byLesson = {
      [lessons[0].lesson.id]: completed(lessons[0].lesson.id, lessons[0].unit.id),
    };

    expect(
      lessonStatus({ byLesson, courseId: 'python', lessonId: lessons[0].lesson.id, hasSubscription: false })
    ).toBe('completed');
    expect(
      lessonStatus({ byLesson, courseId: 'python', lessonId: lessons[1].lesson.id, hasSubscription: false })
    ).toBe('available');
  });

  it('hides units past the free limit behind the paywall', () => {
    const gated = lessons.find((entry) => entry.unit.index === FREE_UNIT_LIMIT + 1);
    expect(gated).toBeDefined();

    expect(
      lessonStatus({
        byLesson: {},
        courseId: 'python',
        lessonId: gated!.lesson.id,
        hasSubscription: false,
      })
    ).toBe('premium_locked');

    // With a subscription the same lesson falls back to the ordinary rules.
    expect(
      lessonStatus({
        byLesson: {},
        courseId: 'python',
        lessonId: gated!.lesson.id,
        hasSubscription: true,
      })
    ).toBe('locked');
  });

  it('treats an unknown lesson id as locked rather than throwing', () => {
    expect(
      lessonStatus({ byLesson: {}, courseId: 'python', lessonId: 'nope', hasSubscription: true })
    ).toBe('locked');
  });
});

describe('nextLessonId', () => {
  const lessons = getCourseLessons('python');

  it('points at the first lesson for a new learner', () => {
    expect(nextLessonId({}, 'python', false)).toBe(lessons[0].lesson.id);
  });

  it('advances as lessons are completed', () => {
    const byLesson = {
      [lessons[0].lesson.id]: completed(lessons[0].lesson.id, lessons[0].unit.id),
      [lessons[1].lesson.id]: completed(lessons[1].lesson.id, lessons[1].unit.id),
    };
    expect(nextLessonId(byLesson, 'python', false)).toBe(lessons[2].lesson.id);
  });

  it('returns null when the next lesson needs a subscription', () => {
    const byLesson: Record<string, LessonProgress> = {};
    for (const entry of lessons.filter((lesson) => lesson.unit.index <= FREE_UNIT_LIMIT)) {
      byLesson[entry.lesson.id] = completed(entry.lesson.id, entry.unit.id);
    }
    expect(nextLessonId(byLesson, 'python', false)).toBeNull();
    expect(nextLessonId(byLesson, 'python', true)).not.toBeNull();
  });
});

describe('unit aggregates', () => {
  it('counts progress within a unit', () => {
    const unit = listCourses()[0].units[0];
    const byLesson = {
      [unit.lessons[0].id]: completed(unit.lessons[0].id, unit.id),
    };

    expect(unitProgress(byLesson, unit.id, 'python')).toEqual({
      done: 1,
      total: unit.lessons.length,
    });
    expect(completedUnitCount(byLesson, 'python')).toBe(0);
  });

  it('counts a unit as complete only when every lesson is', () => {
    const unit = listCourses()[0].units[0];
    const byLesson: Record<string, LessonProgress> = {};
    for (const lesson of unit.lessons) byLesson[lesson.id] = completed(lesson.id, unit.id);

    expect(completedUnitCount(byLesson, 'python')).toBe(1);
  });
});
