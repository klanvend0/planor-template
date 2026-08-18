/**
 * Bundled course content.
 *
 * The question bank ships inside the app so a lesson starts instantly and works
 * on the subway. Postgres stores only what the learner *did* (progress, XP,
 * attempts) plus the grading rubrics the AI edge function needs.
 *
 * The JSON is validated at build time by `npm run content:check`, so the casts
 * below are safe: a file that does not match `unitSchema` never reaches a commit.
 *
 * @module content
 */

import type { Course, CourseId, Unit } from '@/lib/content_schema';

import javascriptUnit01 from './javascript/unit_01.json';
import javascriptUnit02 from './javascript/unit_02.json';
import javascriptUnit03 from './javascript/unit_03.json';
import javascriptUnit04 from './javascript/unit_04.json';
import javascriptUnit05 from './javascript/unit_05.json';
import javascriptUnit06 from './javascript/unit_06.json';
import pythonUnit01 from './python/unit_01.json';
import pythonUnit02 from './python/unit_02.json';
import pythonUnit03 from './python/unit_03.json';
import pythonUnit04 from './python/unit_04.json';
import pythonUnit05 from './python/unit_05.json';
import pythonUnit06 from './python/unit_06.json';
import pythonUnit07 from './python/unit_07.json';
import pythonUnit08 from './python/unit_08.json';

const pythonUnits = [
  pythonUnit01,
  pythonUnit02,
  pythonUnit03,
  pythonUnit04,
  pythonUnit05,
  pythonUnit06,
  pythonUnit07,
  pythonUnit08,
] as unknown as Unit[];

const javascriptUnits = [
  javascriptUnit01,
  javascriptUnit02,
  javascriptUnit03,
  javascriptUnit04,
  javascriptUnit05,
  javascriptUnit06,
] as unknown as Unit[];

/** Every course the app ships, in the order they appear on the course picker. */
export const COURSES: Course[] = [
  {
    id: 'python',
    language: 'python',
    title: { en: 'Python', tr: 'Python' },
    tagline: {
      en: 'The friendliest way into programming',
      tr: 'Programlamaya en tatlı giriş',
    },
    accent: 'hsl(var(--course-python))',
    units: pythonUnits,
  },
  {
    id: 'javascript',
    language: 'javascript',
    title: { en: 'JavaScript', tr: 'JavaScript' },
    tagline: {
      en: 'The language every browser speaks',
      tr: 'Her tarayıcının konuştuğu dil',
    },
    accent: 'hsl(var(--course-javascript))',
    units: javascriptUnits,
  },
];

export const COURSE_BY_ID: Record<CourseId, Course> = {
  python: COURSES[0],
  javascript: COURSES[1],
};
