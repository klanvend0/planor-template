/**
 * Course content access.
 *
 * The single door onto the bundled question bank: screens ask this module for
 * courses, units, lessons and questions instead of importing JSON themselves, so
 * the indexes are built once and lookups stay O(1).
 *
 * @module services/content_service
 */

import { COURSES, COURSE_BY_ID } from '@/content';
import {
  lessonXp,
  type Course,
  type CourseId,
  type Lesson,
  type Question,
  type Unit,
} from '@/lib/content_schema';

export type LessonLocation = {
  course: Course;
  unit: Unit;
  lesson: Lesson;
  /** 0-based position of the lesson across the whole course. */
  courseIndex: number;
};

const lessonIndex = new Map<string, LessonLocation>();
const questionIndex = new Map<string, { location: LessonLocation; question: Question }>();
const unitIndex = new Map<string, { course: Course; unit: Unit }>();

for (const course of COURSES) {
  let courseIndexCounter = 0;
  for (const unit of course.units) {
    unitIndex.set(unit.id, { course, unit });
    for (const lesson of unit.lessons) {
      const location: LessonLocation = { course, unit, lesson, courseIndex: courseIndexCounter };
      courseIndexCounter += 1;
      lessonIndex.set(lesson.id, location);
      for (const question of lesson.questions) {
        questionIndex.set(question.id, { location, question });
      }
    }
  }
}

/** Every course, in display order. */
export function listCourses(): Course[] {
  return COURSES;
}

/** A course by id. Ids come from the schema union, so this never returns null. */
export function getCourse(courseId: CourseId): Course {
  return COURSE_BY_ID[courseId];
}

/** All units of a course, ordered. */
export function getUnits(courseId: CourseId): Unit[] {
  return COURSE_BY_ID[courseId].units;
}

/** A unit by id, or null when the id is stale (e.g. content shrank). */
export function getUnit(unitId: string): Unit | null {
  return unitIndex.get(unitId)?.unit ?? null;
}

/** A lesson with its unit and course, or null for an unknown id. */
export function getLessonLocation(lessonId: string): LessonLocation | null {
  return lessonIndex.get(lessonId) ?? null;
}

/** A lesson by id, or null for an unknown id. */
export function getLesson(lessonId: string): Lesson | null {
  return lessonIndex.get(lessonId)?.lesson ?? null;
}

/** A question by id, or null for an unknown id. */
export function getQuestion(questionId: string): Question | null {
  return questionIndex.get(questionId)?.question ?? null;
}

/** The lesson a question belongs to, for practice sessions built from ids. */
export function getQuestionLocation(questionId: string): LessonLocation | null {
  return questionIndex.get(questionId)?.location ?? null;
}

/** Lessons of a course in learning order, flattened across units. */
export function getCourseLessons(courseId: CourseId): LessonLocation[] {
  const locations: LessonLocation[] = [];
  for (const unit of COURSE_BY_ID[courseId].units) {
    for (const lesson of unit.lessons) {
      const location = lessonIndex.get(lesson.id);
      if (location) locations.push(location);
    }
  }
  return locations;
}

/** The lesson right after this one in course order, or null at the end. */
export function getNextLesson(lessonId: string): LessonLocation | null {
  const current = lessonIndex.get(lessonId);
  if (!current) return null;
  const lessons = getCourseLessons(current.course.id);
  return lessons[current.courseIndex + 1] ?? null;
}

/** Total XP a lesson can pay out, used for the RPC's base_xp argument. */
export function getLessonBaseXp(lesson: Lesson): number {
  return lessonXp(lesson);
}

/** Total lesson count of a course, for progress rings. */
export function countLessons(courseId: CourseId): number {
  return COURSE_BY_ID[courseId].units.reduce((total, unit) => total + unit.lessons.length, 0);
}

/** Every explain_code question, used when seeding grading rubrics. */
export function listExplainQuestions(): { location: LessonLocation; question: Question }[] {
  return [...questionIndex.values()].filter((entry) => entry.question.type === 'explain_code');
}
