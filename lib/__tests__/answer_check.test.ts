/**
 * Grading rules are what cost a learner a heart, so they get real coverage.
 */

import { checkAnswer, codeMatches, normalizeCode, seededShuffle } from '@/lib/answer_check';
import type { Question } from '@/lib/content_schema';

const localized = (value: string) => ({ en: value, tr: value });

describe('normalizeCode', () => {
  it('ignores cosmetic spacing', () => {
    expect(codeMatches('print( name )', 'print(name)')).toBe(true);
    expect(codeMatches('x = 5', 'x=5')).toBe(true);
    expect(codeMatches('total  +=  1', 'total += 1')).toBe(true);
  });

  it('treats single and double quotes as the same', () => {
    expect(codeMatches("print('Merhaba')", 'print("Merhaba")')).toBe(true);
  });

  it('ignores an optional JavaScript semicolon', () => {
    expect(codeMatches('console.log(x);', 'console.log(x)')).toBe(true);
  });

  it('does not rewrite the inside of a string literal', () => {
    expect(codeMatches('print("Hello,world")', 'print("Hello, world")')).toBe(false);
    expect(normalizeCode('print("a  b")')).toContain('a  b');
  });

  it('keeps Python indentation significant', () => {
    expect(codeMatches('    print(x)', 'print(x)')).toBe(false);
  });
});

describe('checkAnswer', () => {
  it('grades multiple choice by option id', () => {
    const question: Question = {
      id: 'q1',
      type: 'multiple_choice',
      difficulty: 'easy',
      prompt: localized('What prints?'),
      explanation: localized('Because.'),
      options: [
        { id: 'a', text: localized('5') },
        { id: 'b', text: localized('23') },
        { id: 'c', text: localized('2 + 3') },
        { id: 'd', text: localized('error') },
      ],
      answerId: 'a',
    };

    expect(checkAnswer(question, { type: 'multiple_choice', optionId: 'a' }).isCorrect).toBe(true);
    expect(checkAnswer(question, { type: 'multiple_choice', optionId: 'b' }).isCorrect).toBe(false);
    expect(checkAnswer(question, { type: 'multiple_choice', optionId: null }).isCorrect).toBe(
      false
    );
  });

  it('grades a filled blank token by token', () => {
    const question: Question = {
      id: 'q2',
      type: 'fill_blank',
      difficulty: 'easy',
      prompt: localized('Fill it in.'),
      explanation: localized('Because.'),
      codeTemplate: 'print(___)',
      blanks: [{ id: '1', answer: '"Merhaba"', distractors: ['Merhaba'] }],
    };

    expect(checkAnswer(question, { type: 'fill_blank', tokens: ['"Merhaba"'] }).isCorrect).toBe(
      true
    );
    expect(checkAnswer(question, { type: 'fill_blank', tokens: ["'Merhaba'"] }).isCorrect).toBe(
      true
    );
    expect(checkAnswer(question, { type: 'fill_blank', tokens: ['Merhaba'] }).isCorrect).toBe(
      false
    );
    expect(checkAnswer(question, { type: 'fill_blank', tokens: [null] }).isCorrect).toBe(false);
  });

  it('accepts the listed alternatives for typed code', () => {
    const question: Question = {
      id: 'q3',
      type: 'type_code',
      difficulty: 'medium',
      prompt: localized('Print the name.'),
      explanation: localized('Because.'),
      code: 'name = "Ada"',
      expected: 'print(name)',
      acceptable: ['print( name )'],
    };

    expect(checkAnswer(question, { type: 'type_code', text: 'print(name)' }).isCorrect).toBe(true);
    expect(checkAnswer(question, { type: 'type_code', text: '  print(name)  ' }).isCorrect).toBe(
      true
    );
    expect(checkAnswer(question, { type: 'type_code', text: 'print("name")' }).isCorrect).toBe(
      false
    );
  });

  it('grades a spotted bug by line', () => {
    const question: Question = {
      id: 'q4',
      type: 'spot_bug',
      difficulty: 'medium',
      prompt: localized('Which line?'),
      explanation: localized('Because.'),
      codeLines: ['age = 20', 'print(agee)'],
      buggyLineIndex: 1,
      fix: 'print(age)',
    };

    expect(checkAnswer(question, { type: 'spot_bug', lineIndex: 1 }).isCorrect).toBe(true);
    expect(checkAnswer(question, { type: 'spot_bug', lineIndex: 0 }).isCorrect).toBe(false);
  });

  it('grades reordered lines by exact order', () => {
    const question: Question = {
      id: 'q5',
      type: 'order_lines',
      difficulty: 'medium',
      prompt: localized('Order them.'),
      explanation: localized('Because.'),
      lines: ['total = 0', 'total += 1', 'print(total)'],
    };

    expect(
      checkAnswer(question, {
        type: 'order_lines',
        lines: ['total = 0', 'total += 1', 'print(total)'],
      }).isCorrect
    ).toBe(true);

    expect(
      checkAnswer(question, {
        type: 'order_lines',
        lines: ['total += 1', 'total = 0', 'print(total)'],
      }).isCorrect
    ).toBe(false);
  });

  it('lets a partially correct explanation pass', () => {
    const question: Question = {
      id: 'q6',
      type: 'explain_code',
      difficulty: 'medium',
      prompt: localized('Explain.'),
      explanation: localized('Because.'),
      code: localized('print(1)'),
      keyPoints: { en: ['prints one'], tr: ['bir yazdırır'] },
      sampleAnswer: localized('It prints the number one to the screen and then finishes running.'),
    };

    expect(checkAnswer(question, { type: 'explain_code', verdict: 'correct' }).isCorrect).toBe(
      true
    );
    expect(checkAnswer(question, { type: 'explain_code', verdict: 'partial' }).isCorrect).toBe(
      true
    );
    expect(checkAnswer(question, { type: 'explain_code', verdict: 'incorrect' }).isCorrect).toBe(
      false
    );
  });

  it('refuses to grade an answer of the wrong type', () => {
    const question: Question = {
      id: 'q7',
      type: 'type_code',
      difficulty: 'easy',
      prompt: localized('Type it.'),
      explanation: localized('Because.'),
      expected: 'print(1)',
    };

    expect(() => checkAnswer(question, { type: 'spot_bug', lineIndex: 0 })).toThrow();
  });
});

describe('seededShuffle', () => {
  it('is stable for the same seed and different across seeds', () => {
    const items = ['a', 'b', 'c', 'd', 'e', 'f'];
    expect(seededShuffle(items, 'q1')).toEqual(seededShuffle(items, 'q1'));
    expect(seededShuffle(items, 'q1')).not.toEqual(seededShuffle(items, 'q2'));
    expect([...seededShuffle(items, 'q1')].sort()).toEqual(items);
  });
});
