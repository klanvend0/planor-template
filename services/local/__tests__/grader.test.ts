/**
 * Marking without a model.
 *
 * The grader is only useful if a real answer to a real bundled question is
 * marked the way a person would mark it, so the cases below use the question
 * bank rather than fixtures, in both shipped languages.
 */

import { EXPLANATION_MIN_CHARS } from '@/lib/constants';
import { getQuestion } from '@/services/content_service';
import { gradeLocally } from '@/services/local/grader';
import { listExplainQuestions } from '@/services/content_service';

const question = getQuestion('py-u01-l1-q6');

function keyPoints(locale: 'en' | 'tr'): string[] {
  if (!question || question.type !== 'explain_code') throw new Error('fixture question missing');
  return question.keyPoints[locale];
}

describe('gradeLocally', () => {
  /**
   * The calibration guard.
   *
   * The grader is a coverage check, so what matters is that it separates two
   * populations: the bundle's own model answers, which are what understanding
   * looks like, and answers that say nothing about the code. Both are measured
   * over every explain_code question in both languages, which is 112 cases.
   */
  it('separates the model answers from answers that say nothing', () => {
    const OFF_TOPIC = {
      en:
        'I am not really sure what this does but I think it might be about computers and ' +
        'screens, and perhaps it saves something somewhere for later use in the program.',
      tr:
        'Bunun ne yaptığından tam emin değilim ama sanırım bilgisayarlarla ilgili bir şey ve ' +
        'belki bir yerlere bir şeyler kaydediyor, sonra da bunu kullanıyor olabilir.',
    };

    let understood = 0;
    let cases = 0;

    for (const { question: entry } of listExplainQuestions()) {
      if (entry.type !== 'explain_code') continue;
      for (const locale of ['en', 'tr'] as const) {
        cases += 1;
        const points = entry.keyPoints[locale];

        if (gradeLocally(entry.sampleAnswer[locale], points, locale).verdict === 'correct') {
          understood += 1;
        }

        // An answer about nothing is never given the benefit of the doubt.
        expect(gradeLocally(OFF_TOPIC[locale], points, locale).verdict).toBe('incorrect');
      }
    }

    expect(cases).toBeGreaterThan(100);
    expect(understood / cases).toBeGreaterThan(0.95);
  });

  it('names what was left out rather than inventing a correction', () => {
    const points = keyPoints('en');
    const review = gradeLocally(
      'This program prints a greeting to the screen so the person running it can read something, ' +
        'and that is the whole thing it does from top to bottom.',
      points,
      'en'
    );

    expect(review.corrections).toEqual([]);
    expect(review.missedPoints.every((point) => points.includes(point))).toBe(true);
    expect(review.score).toBe(
      Math.round(((points.length - review.missedPoints.length) / points.length) * 100)
    );
  });

  it('rejects an answer that says nothing about the code', () => {
    const review = gradeLocally(
      'I am not sure what is happening here at all, but I think it is probably something to do ' +
        'with computers and maybe it shows things somewhere.',
      keyPoints('en'),
      'en'
    );

    expect(review.verdict).toBe('incorrect');
    expect(review.missedPoints.length).toBeGreaterThan(0);
  });

  it('reads Turkish suffixes rather than demanding the bare word', () => {
    const points = ['dizi oluşturur', 'ilk öğeye erişir'];
    const covered = gradeLocally(
      'Kod önce üç elemanlı bir diziyi oluşturuyor, sonra o dizinin ilk öğesine erişip ekrana ' +
        'yazdırıyor, yani sıfırıncı indeksteki değeri gösteriyor.',
      points,
      'tr'
    );

    expect(covered.verdict).toBe('correct');
    expect(covered.missedPoints).toEqual([]);
  });

  it('refuses an answer shorter than the prompt asks for', () => {
    expect(() => gradeLocally('Too short.', keyPoints('en'), 'en')).toThrow();
    expect('Too short.'.length).toBeLessThan(EXPLANATION_MIN_CHARS);
  });

  it('is honest when the question has nothing to mark against', () => {
    expect(() =>
      gradeLocally(
        'A long enough answer that still cannot be marked because the question ships no key ' +
          'points at all, which is a content bug rather than a learner mistake.',
        [],
        'en'
      )
    ).toThrow();
  });
});
