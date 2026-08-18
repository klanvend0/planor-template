/**
 * Answer checking.
 *
 * Pure grading rules for every question type except `explain_code`, which needs
 * the AI edge function. Kept free of React and Supabase so the rules can be unit
 * tested — they decide whether a learner loses a heart, so they have to be right.
 *
 * @module lib/answer_check
 */

import type { Question } from '@/lib/content_schema';

/** What the learner produced, discriminated by question type. */
export type AnswerInput =
  | { type: 'multiple_choice'; optionId: string | null }
  | { type: 'fill_blank'; tokens: (string | null)[] }
  | { type: 'type_code'; text: string }
  | { type: 'spot_bug'; lineIndex: number | null }
  | { type: 'order_lines'; lines: string[] }
  | { type: 'explain_code'; verdict: 'correct' | 'partial' | 'incorrect' | null };

export type CheckResult = {
  isCorrect: boolean;
  /** The right answer, rendered for the feedback sheet. */
  expected: string;
  /** What the learner submitted, for the attempts log. */
  submitted: string;
};

/**
 * Split a line into code fragments and string literals.
 *
 * String contents are never normalized: `print("a, b")` and `print("a,b")` print
 * different things, so treating them as equal would teach the wrong lesson.
 * Literals come back with `"` delimiters so `'hi'` and `"hi"` compare equal.
 */
function splitLiterals(input: string): { code: string; literals: string[] } {
  const literals: string[] = [];
  let code = '';
  let index = 0;

  while (index < input.length) {
    const char = input[index];
    if (char === '"' || char === "'" || char === '`') {
      const quote = char;
      let literal = '';
      index += 1;
      while (index < input.length) {
        const current = input[index];
        if (current === '\\' && index + 1 < input.length) {
          literal += current + input[index + 1];
          index += 2;
          continue;
        }
        if (current === quote) {
          index += 1;
          break;
        }
        literal += current;
        index += 1;
      }
      code += `\u0001${literals.length}\u0001`;
      literals.push(literal);
      continue;
    }
    code += char;
    index += 1;
  }

  return { code, literals };
}

/**
 * Normalize a line of code so cosmetic differences do not fail a correct answer.
 *
 * Collapses runs of whitespace, unifies quote style, drops a trailing semicolon
 * (optional in JavaScript) and removes spaces that carry no meaning around
 * brackets, commas and operators. Two things are deliberately preserved:
 * leading indentation, because in Python it changes what the code means, and
 * the inside of string literals, because it changes what the code prints.
 */
export function normalizeCode(input: string): string {
  if (input.includes('\n')) {
    return input
      .split('\n')
      .map((line) => normalizeCode(line))
      .join('\n');
  }

  const indent = input.match(/^[ \t]*/)?.[0].replace(/\t/g, '    ') ?? '';
  const { code, literals } = splitLiterals(input.trim());

  const normalized = code
    .replace(/\s+/g, ' ')
    .replace(/;+$/, '')
    .replace(/\s*([(),:[\]{}])\s*/g, '$1')
    .replace(/\s*(\+|-|\*|\/|%|==|!=|<=|>=|<|>|=)\s*/g, '$1')
    .trim();

  const restored = normalized.replace(/\u0001(\d+)\u0001/g, (_match, id: string) => {
    return `"${literals[Number(id)] ?? ''}"`;
  });

  return `${indent}${restored}`;
}

/** Compare two code fragments the way a forgiving-but-honest grader would. */
export function codeMatches(actual: string, expected: string): boolean {
  return normalizeCode(actual) === normalizeCode(expected);
}

/** Human-readable form of the correct answer, used in the feedback sheet. */
export function expectedAnswerText(question: Question): string {
  switch (question.type) {
    case 'multiple_choice': {
      const option = question.options.find((entry) => entry.id === question.answerId);
      return option ? option.text.en : '';
    }
    case 'fill_blank': {
      let filled = question.codeTemplate;
      for (const blank of question.blanks) filled = filled.replace('___', blank.answer);
      return filled;
    }
    case 'type_code':
      return question.expected;
    case 'spot_bug':
      return question.fix;
    case 'order_lines':
      return question.lines.join('\n');
    case 'explain_code':
      return question.sampleAnswer.en;
  }
}

/**
 * Grade one answer.
 *
 * @param question - The question as authored.
 * @param input - What the learner produced; its `type` must match the question.
 * @returns Whether it was right, plus both answers for logging and feedback.
 */
export function checkAnswer(question: Question, input: AnswerInput): CheckResult {
  if (question.type !== input.type) {
    throw new Error(`answer type ${input.type} does not match question type ${question.type}`);
  }

  switch (question.type) {
    case 'multiple_choice': {
      const answer = input as Extract<AnswerInput, { type: 'multiple_choice' }>;
      return {
        isCorrect: answer.optionId === question.answerId,
        expected: expectedAnswerText(question),
        submitted: answer.optionId ?? '',
      };
    }

    case 'fill_blank': {
      const answer = input as Extract<AnswerInput, { type: 'fill_blank' }>;
      const isCorrect =
        answer.tokens.length === question.blanks.length &&
        question.blanks.every((blank, index) => {
          const token = answer.tokens[index];
          return typeof token === 'string' && codeMatches(token, blank.answer);
        });
      return {
        isCorrect,
        expected: expectedAnswerText(question),
        submitted: answer.tokens.map((token) => token ?? '_').join(' | '),
      };
    }

    case 'type_code': {
      const answer = input as Extract<AnswerInput, { type: 'type_code' }>;
      const candidates = [question.expected, ...(question.acceptable ?? [])];
      // A single-line answer is typed into a plain input with the surrounding
      // code shown above it, so leading spaces are a slip of the thumb rather
      // than meaningful indentation. Multi-line answers keep their indentation.
      const isCorrect = candidates.some((candidate) =>
        candidate.includes('\n')
          ? codeMatches(answer.text, candidate)
          : codeMatches(answer.text.trim(), candidate.trim())
      );
      return {
        isCorrect,
        expected: question.expected,
        submitted: answer.text,
      };
    }

    case 'spot_bug': {
      const answer = input as Extract<AnswerInput, { type: 'spot_bug' }>;
      return {
        isCorrect: answer.lineIndex === question.buggyLineIndex,
        expected: question.fix,
        submitted: answer.lineIndex === null ? '' : (question.codeLines[answer.lineIndex] ?? ''),
      };
    }

    case 'order_lines': {
      const answer = input as Extract<AnswerInput, { type: 'order_lines' }>;
      const isCorrect =
        answer.lines.length === question.lines.length &&
        question.lines.every((line, index) => line === answer.lines[index]);
      return {
        isCorrect,
        expected: question.lines.join('\n'),
        submitted: answer.lines.join('\n'),
      };
    }

    case 'explain_code': {
      const answer = input as Extract<AnswerInput, { type: 'explain_code' }>;
      // A partially right explanation still moves the learner forward; only a
      // wrong reading of the code costs a heart.
      return {
        isCorrect: answer.verdict === 'correct' || answer.verdict === 'partial',
        expected: question.sampleAnswer.en,
        submitted: answer.verdict ?? '',
      };
    }
  }
}

/**
 * Deterministic shuffle.
 *
 * Seeded by the question id so a learner sees the same arrangement if they leave
 * and come back, but a different one from question to question.
 */
export function seededShuffle<T>(items: T[], seed: string): T[] {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    hash = (Math.imul(hash, 48271) + 1) % 2147483647;
    const swapWith = Math.abs(hash) % (index + 1);
    [result[index], result[swapWith]] = [result[swapWith], result[index]];
  }
  return result;
}

/** Token bank for a fill-in-the-blank question: answers plus every distractor. */
export function tokenBank(question: Extract<Question, { type: 'fill_blank' }>): string[] {
  const tokens = question.blanks.flatMap((blank) => [blank.answer, ...blank.distractors]);
  return seededShuffle([...new Set(tokens)], question.id);
}
