/**
 * Content validator.
 *
 * Validates every bundled unit file against the Zod schema in
 * `lib/content_schema.ts` and then *really runs* the code snippets with
 * `python3` / `node`, so a question whose "correct" answer does not actually
 * work can never ship.
 *
 * Usage:
 *   node scripts/check_content.mts                      # every unit
 *   node scripts/check_content.mts content/python/unit_01.json ...
 *
 * Exits non-zero with a per-file report when anything fails.
 *
 * @module scripts/check_content
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { unitSchema, type Lesson, type Question, type Unit } from '../lib/content_schema.ts';

type Problem = { file: string; where: string; message: string };

const ROOT = resolve(import.meta.dirname, '..');
const CONTENT_DIR = join(ROOT, 'content');
const COURSES = ['python', 'javascript'] as const;
const COURSE_PREFIX: Record<string, string> = { python: 'py', javascript: 'js' };
const RUN_DIR = mkdtempSync(join(tmpdir(), 'codeling-content-'));

/** Characters that must never appear in learner-facing copy. */
const EMOJI = /\p{Extended_Pictographic}/u;
const MARKDOWN = /(\*\*|`|^\s*[-*]\s|^#{1,6}\s|<\/?[a-z]+>)/im;

const problems: Problem[] = [];

function fail(file: string, where: string, message: string): void {
  problems.push({ file, where, message });
}

function listUnitFiles(): string[] {
  const explicit = process.argv.slice(2).filter((arg) => !arg.startsWith('-'));
  if (explicit.length > 0) return explicit.map((p) => resolve(process.cwd(), p));

  const files: string[] = [];
  for (const course of COURSES) {
    const dir = join(CONTENT_DIR, course);
    let entries: string[] = [];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const entry of entries.sort()) {
      if (/^unit_\d{2}\.json$/.test(entry)) files.push(join(dir, entry));
    }
  }
  // The authoring reference is checked with everything else: an example that
  // does not pass the rules it documents is worse than no example.
  files.push(join(CONTENT_DIR, 'example_unit.json'));
  return files;
}

/** Run a snippet and return its stdout/stderr/exit status. */
function runSnippet(
  language: 'python' | 'javascript',
  code: string
): { ok: boolean; stdout: string; stderr: string } {
  const file = join(
    RUN_DIR,
    `snippet_${Math.random().toString(36).slice(2)}.${language === 'python' ? 'py' : 'js'}`
  );
  writeFileSync(file, code.endsWith('\n') ? code : `${code}\n`);
  try {
    const stdout = execFileSync(language === 'python' ? 'python3' : 'node', [file], {
      encoding: 'utf8',
      timeout: 10_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { ok: true, stdout, stderr: '' };
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; message?: string };
    return { ok: false, stdout: err.stdout ?? '', stderr: err.stderr ?? err.message ?? '' };
  }
}

/** Parse-only check: catches syntax errors without executing side effects. */
function checkSyntax(language: 'python' | 'javascript', code: string): string | null {
  const file = join(
    RUN_DIR,
    `syntax_${Math.random().toString(36).slice(2)}.${language === 'python' ? 'py' : 'js'}`
  );
  writeFileSync(file, code.endsWith('\n') ? code : `${code}\n`);
  try {
    if (language === 'python') {
      execFileSync(
        'python3',
        ['-c', `import ast,sys; ast.parse(open(${JSON.stringify(file)}).read())`],
        {
          encoding: 'utf8',
          timeout: 10_000,
          stdio: ['ignore', 'pipe', 'pipe'],
        }
      );
    } else {
      execFileSync('node', ['--check', file], {
        encoding: 'utf8',
        timeout: 10_000,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    }
    return null;
  } catch (error) {
    const err = error as { stderr?: string; message?: string };
    return (err.stderr || err.message || 'syntax error').trim().split('\n').slice(-3).join(' ');
  }
}

function checkCopy(
  file: string,
  where: string,
  value: { en: string; tr: string },
  sentence: boolean
): void {
  for (const [locale, text] of Object.entries(value)) {
    if (EMOJI.test(text)) fail(file, `${where}.${locale}`, 'contains an emoji');
    if (sentence && MARKDOWN.test(text)) fail(file, `${where}.${locale}`, 'contains markdown/HTML');
  }
  if (sentence && value.en.trim() === value.tr.trim() && value.en.trim().split(/\s+/).length > 2) {
    fail(file, where, 'en and tr are identical — the Turkish copy is missing');
  }
}

/**
 * Enforce a copy budget from content/AUTHORING.md.
 *
 * These are the numbers the authoring guide hands to whoever writes a unit, and
 * they exist for layout: a title that runs to three lines on an iPhone SE, or a
 * concept body nobody scrolls, is a defect the schema cannot see.
 */
function checkLength(
  file: string,
  where: string,
  value: { en: string; tr: string },
  min: number,
  max: number
): void {
  for (const [locale, text] of Object.entries(value)) {
    if (text.length < min || text.length > max) {
      fail(file, `${where}.${locale}`, `must be ${min}-${max} chars, got ${text.length}`);
    }
  }
}

function checkQuestion(
  file: string,
  language: 'python' | 'javascript',
  lesson: Lesson,
  question: Question
): void {
  const where = `${lesson.id} / ${question.id} (${question.type})`;

  checkCopy(file, `${where}.prompt`, question.prompt, true);
  checkCopy(file, `${where}.explanation`, question.explanation, true);
  checkLength(file, `${where}.explanation`, question.explanation, 80, 220);

  const syntaxTargets: { label: string; code: string }[] = [];
  let runnable: { code: string; expectStdout?: string; expectRaises?: string } | null = null;

  switch (question.type) {
    case 'multiple_choice': {
      if (question.code) syntaxTargets.push({ label: 'code', code: question.code });
      for (const option of question.options)
        checkCopy(file, `${where}.option:${option.id}`, option.text, false);
      break;
    }
    case 'fill_blank': {
      let filled = question.codeTemplate;
      for (const blank of question.blanks) filled = filled.replace('___', blank.answer);
      syntaxTargets.push({ label: 'filled template', code: filled });
      for (const blank of question.blanks) {
        for (const distractor of blank.distractors) {
          // A distractor is a token, not a sentence: the chips have to fit the
          // token bank without wrapping.
          if (distractor.length > 32) {
            fail(
              file,
              `${where}.blanks.${blank.id}`,
              `distractor "${distractor}" is ${distractor.length} chars, max 32`
            );
          }
        }
        if (blank.distractors.includes(blank.answer)) {
          fail(file, `${where}.blanks.${blank.id}`, 'a distractor duplicates the answer');
        }
      }
      if (question.verify?.stdout !== undefined) {
        runnable = { code: filled, expectStdout: question.verify.stdout };
      }
      break;
    }
    case 'type_code': {
      const full = [question.code, question.expected].filter(Boolean).join('\n');
      syntaxTargets.push({ label: 'expected answer', code: full });
      if (question.verify?.stdout !== undefined) {
        runnable = { code: full, expectStdout: question.verify.stdout };
      }
      break;
    }
    case 'spot_bug': {
      const joined = question.codeLines.join('\n');
      const fixed = question.codeLines
        .map((line, index) => (index === question.buggyLineIndex ? question.fix : line))
        .join('\n');
      const fixedSyntax = checkSyntax(language, fixed);
      if (fixedSyntax) fail(file, `${where}.fix`, `fixed code does not parse: ${fixedSyntax}`);
      if (question.verify?.raises) {
        runnable = { code: joined, expectRaises: question.verify.raises };
      }
      break;
    }
    case 'order_lines': {
      const joined = question.lines.join('\n');
      syntaxTargets.push({ label: 'ordered lines', code: joined });
      if (question.verify?.stdout !== undefined) {
        runnable = { code: joined, expectStdout: question.verify.stdout };
      }
      break;
    }
    case 'explain_code': {
      syntaxTargets.push({ label: 'code.en', code: question.code.en });
      syntaxTargets.push({ label: 'code.tr', code: question.code.tr });
      checkCopy(file, `${where}.sampleAnswer`, question.sampleAnswer, true);
      // The prompt asks the learner for 100-200 characters, so the model answer
      // has to be an example of exactly that.
      checkLength(file, `${where}.sampleAnswer`, question.sampleAnswer, 100, 200);
      const stripComments = (code: string) =>
        code
          .split('\n')
          .map((line) => line.replace(/(#|\/\/).*$/, '').trimEnd())
          .join('\n');
      if (stripComments(question.code.en) !== stripComments(question.code.tr)) {
        fail(file, `${where}.code`, 'only the comments may differ between en and tr');
      }
      break;
    }
  }

  for (const target of syntaxTargets) {
    const error = checkSyntax(language, target.code);
    if (error) fail(file, `${where}.${target.label}`, `does not parse: ${error}`);
  }

  if (runnable) {
    const result = runSnippet(language, runnable.code);
    if (runnable.expectStdout !== undefined) {
      if (!result.ok) {
        fail(
          file,
          `${where}.verify`,
          `snippet crashed: ${result.stderr.trim().split('\n').slice(-2).join(' ')}`
        );
      } else if (result.stdout !== runnable.expectStdout) {
        fail(
          file,
          `${where}.verify.stdout`,
          `expected ${JSON.stringify(runnable.expectStdout)}, actually printed ${JSON.stringify(result.stdout)}`
        );
      }
    }
    if (runnable.expectRaises) {
      if (result.ok) {
        fail(
          file,
          `${where}.verify.raises`,
          `expected ${runnable.expectRaises} but the snippet ran fine`
        );
      } else if (!result.stderr.includes(runnable.expectRaises)) {
        fail(
          file,
          `${where}.verify.raises`,
          `expected ${runnable.expectRaises}, got: ${result.stderr.trim().split('\n').slice(-1)[0]}`
        );
      }
    }
  }
}

function checkUnit(file: string, unit: Unit, seenIds: Set<string>): void {
  const language = unit.courseId === 'python' ? 'python' : 'javascript';
  const prefix = COURSE_PREFIX[unit.courseId];
  const expectedId = `${prefix}-u${String(unit.index).padStart(2, '0')}`;

  if (unit.id !== expectedId) fail(file, unit.id, `unit id should be "${expectedId}"`);
  // The authoring reference (content/example_unit.json) lives outside the course
  // folders and is exempt from the shipped-unit naming convention.
  const isShippedUnit = /content\/(python|javascript)\/unit_\d{2}\.json$/.test(file);
  if (isShippedUnit && !file.endsWith(`unit_${String(unit.index).padStart(2, '0')}.json`)) {
    fail(file, unit.id, `filename does not match index ${unit.index}`);
  }
  checkCopy(file, `${unit.id}.title`, unit.title, true);
  checkCopy(file, `${unit.id}.description`, unit.description, true);
  checkLength(file, `${unit.id}.title`, unit.title, 1, 40);
  checkLength(file, `${unit.id}.description`, unit.description, 60, 120);

  unit.lessons.forEach((lesson, lessonIndex) => {
    if (lesson.index !== lessonIndex + 1)
      fail(file, lesson.id, `lesson index should be ${lessonIndex + 1}`);
    if (lesson.id !== `${unit.id}-l${lesson.index}`) {
      fail(file, lesson.id, `lesson id should be "${unit.id}-l${lesson.index}"`);
    }
    if (seenIds.has(lesson.id)) fail(file, lesson.id, 'duplicate lesson id');
    seenIds.add(lesson.id);

    checkCopy(file, `${lesson.id}.title`, lesson.title, true);
    checkCopy(file, `${lesson.id}.concept.headline`, lesson.concept.headline, true);
    checkCopy(file, `${lesson.id}.concept.body`, lesson.concept.body, true);
    checkCopy(file, `${lesson.id}.concept.example.caption`, lesson.concept.example.caption, true);

    checkLength(file, `${lesson.id}.title`, lesson.title, 1, 32);
    checkLength(file, `${lesson.id}.concept.headline`, lesson.concept.headline, 1, 60);
    checkLength(file, `${lesson.id}.concept.body`, lesson.concept.body, 180, 420);
    checkLength(
      file,
      `${lesson.id}.concept.example.caption`,
      lesson.concept.example.caption,
      1,
      90
    );

    const exampleError = checkSyntax(language, lesson.concept.example.code);
    if (exampleError) fail(file, `${lesson.id}.concept.example`, `does not parse: ${exampleError}`);

    lesson.questions.forEach((question, questionIndex) => {
      if (question.id !== `${lesson.id}-q${questionIndex + 1}`) {
        fail(file, question.id, `question id should be "${lesson.id}-q${questionIndex + 1}"`);
      }
      if (seenIds.has(question.id)) fail(file, question.id, 'duplicate question id');
      seenIds.add(question.id);
      checkQuestion(file, language, lesson, question);
    });

    const types = new Set(lesson.questions.map((q) => q.type));
    if (!types.has('explain_code')) {
      fail(file, lesson.id, 'every lesson needs one explain_code question (the premium hook)');
    }
    if (types.size < 4) {
      fail(file, lesson.id, `only ${types.size} distinct question types — vary them`);
    }
  });
}

function main(): void {
  const files = listUnitFiles();
  if (files.length === 0) {
    console.error('No unit files found under content/. Nothing to check.');
    process.exit(1);
  }

  const seenIds = new Set<string>();
  let questionCount = 0;
  let lessonCount = 0;

  for (const file of files) {
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(file, 'utf8'));
    } catch (error) {
      fail(file, 'json', `not valid JSON: ${(error as Error).message}`);
      continue;
    }

    const parsed = unitSchema.safeParse(raw);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        fail(file, issue.path.join('.') || 'root', issue.message);
      }
      continue;
    }

    lessonCount += parsed.data.lessons.length;
    questionCount += parsed.data.lessons.reduce((n, lesson) => n + lesson.questions.length, 0);
    checkUnit(file, parsed.data, seenIds);
  }

  const byFile = new Map<string, Problem[]>();
  for (const problem of problems) {
    const list = byFile.get(problem.file) ?? [];
    list.push(problem);
    byFile.set(problem.file, list);
  }

  for (const [file, list] of byFile) {
    console.error(
      `\n${file.replace(`${ROOT}/`, '')}  (${list.length} problem${list.length === 1 ? '' : 's'})`
    );
    for (const problem of list) console.error(`  - ${problem.where}: ${problem.message}`);
  }

  console.log(
    `\nChecked ${files.length} unit file(s), ${lessonCount} lessons, ${questionCount} questions.`
  );

  if (problems.length > 0) {
    console.error(`FAILED with ${problems.length} problem(s).`);
    process.exit(1);
  }
  console.log('All content valid.');
}

main();
