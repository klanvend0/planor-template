/**
 * Course content schema.
 *
 * Single source of truth for the shape of the question bank. The same schema
 * validates the bundled JSON at build time (`npm run content:check`) and any
 * content pulled from Supabase at runtime, so a malformed remote payload can
 * never reach a screen.
 *
 * Constraints:
 * - Every learner-facing string is localized to every entry in {@link LOCALES}.
 * - Question ids are stable: progress rows in Postgres reference them.
 * - Keep this file free of React/Expo imports; it runs in Node scripts too.
 *
 * @module lib/content_schema
 */

import { z } from 'zod';

/** Locales the app ships with. Adding one here makes it required in content. */
export const LOCALES = ['en', 'tr'] as const;

export type Locale = (typeof LOCALES)[number];

/** A string that exists in every supported locale. */
export const localizedSchema = z.object({
  en: z.string().min(1),
  tr: z.string().min(1),
});

export type Localized = z.infer<typeof localizedSchema>;

/** A list of strings per locale, used for AI grading rubrics. */
export const localizedListSchema = z.object({
  en: z.array(z.string().min(1)).min(1),
  tr: z.array(z.string().min(1)).min(1),
});

export type LocalizedList = z.infer<typeof localizedListSchema>;

export const difficultySchema = z.enum(['easy', 'medium', 'hard']);

export type Difficulty = z.infer<typeof difficultySchema>;

/** XP awarded for a first-time correct answer, by difficulty. */
export const XP_BY_DIFFICULTY: Record<Difficulty, number> = {
  easy: 10,
  medium: 15,
  hard: 25,
};

/**
 * Optional executable assertion for a snippet.
 *
 * `npm run content:check` really runs the code with `python3` / `node`:
 * `stdout` asserts the printed output, `raises` asserts the snippet fails with
 * that error name (used by `spot_bug`).
 */
export const verifySchema = z.object({
  stdout: z.string().optional(),
  raises: z.string().optional(),
});

export type Verify = z.infer<typeof verifySchema>;

const questionBase = {
  id: z.string().min(1),
  difficulty: difficultySchema,
  prompt: localizedSchema,
  explanation: localizedSchema,
};

/** Pick the correct value out of four options. */
export const multipleChoiceQuestionSchema = z
  .object({
    ...questionBase,
    type: z.literal('multiple_choice'),
    code: z.string().nullish(),
    options: z.array(z.object({ id: z.string().min(1), text: localizedSchema })).length(4),
    answerId: z.string().min(1),
  })
  .refine((q) => q.options.some((o) => o.id === q.answerId), {
    message: 'answerId must match one of the option ids',
    path: ['answerId'],
  })
  .refine((q) => new Set(q.options.map((o) => o.id)).size === q.options.length, {
    message: 'option ids must be unique',
    path: ['options'],
  });

/** Drop tokens from a shuffled bank into `___` placeholders. */
export const fillBlankQuestionSchema = z
  .object({
    ...questionBase,
    type: z.literal('fill_blank'),
    codeTemplate: z.string().min(1),
    blanks: z
      .array(
        z.object({
          id: z.string().min(1),
          answer: z.string().min(1),
          distractors: z.array(z.string().min(1)).min(1).max(4),
        })
      )
      .min(1)
      .max(2),
    verify: verifySchema.optional(),
  })
  .refine((q) => (q.codeTemplate.match(/___/g) ?? []).length === q.blanks.length, {
    message: 'codeTemplate must contain exactly one ___ per blank',
    path: ['codeTemplate'],
  });

/** Type the missing line of code on a keyboard. */
export const typeCodeQuestionSchema = z.object({
  ...questionBase,
  type: z.literal('type_code'),
  code: z.string().nullish(),
  expected: z.string().min(1),
  acceptable: z.array(z.string().min(1)).optional(),
  verify: verifySchema.optional(),
});

/** Tap the line that is wrong — typo'd names, missing colons, wrong operators. */
export const spotBugQuestionSchema = z
  .object({
    ...questionBase,
    type: z.literal('spot_bug'),
    codeLines: z.array(z.string()).min(2).max(6),
    buggyLineIndex: z.number().int().min(0),
    fix: z.string().min(1),
    verify: verifySchema.optional(),
  })
  .refine((q) => q.buggyLineIndex < q.codeLines.length, {
    message: 'buggyLineIndex is out of range',
    path: ['buggyLineIndex'],
  });

/** Reassemble shuffled lines into a working snippet. */
export const orderLinesQuestionSchema = z.object({
  ...questionBase,
  type: z.literal('order_lines'),
  lines: z.array(z.string().min(1)).min(3).max(6),
  verify: verifySchema.optional(),
});

/**
 * Premium question: the learner writes 100-200 characters explaining a snippet
 * and a cheap LLM grades it against `keyPoints`.
 *
 * `code` is localized because the comments inside the snippet are written in the
 * learner's language while identifiers and keywords stay in English.
 */
export const explainCodeQuestionSchema = z.object({
  ...questionBase,
  type: z.literal('explain_code'),
  code: localizedSchema,
  keyPoints: localizedListSchema,
  sampleAnswer: localizedSchema,
});

export const questionSchema = z.discriminatedUnion('type', [
  multipleChoiceQuestionSchema,
  fillBlankQuestionSchema,
  typeCodeQuestionSchema,
  spotBugQuestionSchema,
  orderLinesQuestionSchema,
  explainCodeQuestionSchema,
]);

export type Question = z.infer<typeof questionSchema>;
export type QuestionType = Question['type'];
export type MultipleChoiceQuestion = z.infer<typeof multipleChoiceQuestionSchema>;
export type FillBlankQuestion = z.infer<typeof fillBlankQuestionSchema>;
export type TypeCodeQuestion = z.infer<typeof typeCodeQuestionSchema>;
export type SpotBugQuestion = z.infer<typeof spotBugQuestionSchema>;
export type OrderLinesQuestion = z.infer<typeof orderLinesQuestionSchema>;
export type ExplainCodeQuestion = z.infer<typeof explainCodeQuestionSchema>;

export const lessonSchema = z.object({
  id: z.string().min(1),
  index: z.number().int().min(1),
  title: localizedSchema,
  concept: z.object({
    headline: localizedSchema,
    body: localizedSchema,
    example: z.object({
      code: z.string().min(1),
      caption: localizedSchema,
    }),
  }),
  questions: z.array(questionSchema).min(4).max(8),
});

export type Lesson = z.infer<typeof lessonSchema>;

export const courseIdSchema = z.enum(['python', 'javascript']);

export type CourseId = z.infer<typeof courseIdSchema>;

export const unitSchema = z.object({
  id: z.string().min(1),
  courseId: courseIdSchema,
  index: z.number().int().min(1),
  title: localizedSchema,
  description: localizedSchema,
  lessons: z.array(lessonSchema).min(1).max(6),
});

export type Unit = z.infer<typeof unitSchema>;

/** Static metadata about a course; the units themselves live in JSON files. */
export type Course = {
  id: CourseId;
  /** Language slug used for syntax highlighting and code execution. */
  language: 'python' | 'javascript';
  title: Localized;
  tagline: Localized;
  /** Brand accent for the course, as a NativeWind-compatible hsl() string. */
  accent: string;
  units: Unit[];
};

/** Questions that cost an AI call and are therefore reserved for subscribers. */
export function isPremiumQuestion(question: Question): boolean {
  return question.type === 'explain_code';
}

/** XP a question is worth when answered correctly for the first time. */
export function questionXp(question: Question): number {
  return XP_BY_DIFFICULTY[question.difficulty];
}

/** Total XP obtainable from a lesson, used for progress rings and goals. */
export function lessonXp(lesson: Lesson): number {
  return lesson.questions.reduce((total, question) => total + questionXp(question), 0);
}

/** Read a localized value with a guaranteed English fallback. */
export function localized(value: Localized, locale: Locale): string {
  return value[locale] ?? value.en;
}
