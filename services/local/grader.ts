/**
 * Marking an explanation without a model.
 *
 * The premium loop asks the learner to say what a snippet does in their own
 * words, and a model decides whether they understood it. With no provider
 * configured there is no model, but there is something almost as good sitting
 * in the bundle already: every `explain_code` question ships the key points its
 * answer has to cover, in both languages. So the local grader checks coverage
 * of those points and says which ones are missing.
 *
 * What it cannot do, and does not pretend to: spot a confident, fluent answer
 * that is wrong about something it never mentions. It reports what was covered
 * and what was not, and the screen says the check ran on the device.
 *
 * @module services/local/grader
 */

import { EXPLANATION_MIN_CHARS } from '@/lib/constants';
import { AppError } from '@/lib/errors';
import { t, type SupportedLocale } from '@/lib/i18n';
import type { ExplanationReview, ExplanationVerdict } from '@/services/grading_service';

/** Words that carry no meaning for coverage, in both shipped languages. */
const STOPWORDS = new Set([
  // English
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'but',
  'by',
  'can',
  'do',
  'does',
  'each',
  'for',
  'from',
  'has',
  'have',
  'how',
  'in',
  'into',
  'is',
  'it',
  'its',
  'of',
  'on',
  'or',
  'out',
  'so',
  'that',
  'the',
  'then',
  'they',
  'this',
  'to',
  'up',
  'was',
  'what',
  'when',
  'which',
  'with',
  'you',
  'your',
  'will',
  'we',
  'if',
  'not',
  'all',
  'any',
  'one',
  'two',
  'first',
  'after',
  'before',
  'also',
  'just',
  'only',
  'over',
  'more',
  'than',
  'there',
  'their',
  'them',
  'these',
  'those',
  'value',
  'values',
  // Turkish
  've',
  'ile',
  'bir',
  'bu',
  'şu',
  'o',
  'da',
  'de',
  'ki',
  'mi',
  'mı',
  'mu',
  'mü',
  'için',
  'gibi',
  'olarak',
  'sonra',
  'önce',
  'her',
  'çok',
  'daha',
  'en',
  'ama',
  'veya',
  'ya',
  'ise',
  'olan',
  'olur',
  'oluyor',
  'yapar',
  'yapıyor',
  'eder',
  'ediyor',
  'ne',
  'nasıl',
  'kadar',
  'sadece',
  'ancak',
  'yani',
  'ise',
  'şey',
  'değer',
  'değeri',
]);

/** Lowercase the way the language expects; Turkish has its own casing rules. */
function fold(value: string, locale: SupportedLocale): string {
  return value.toLocaleLowerCase(locale === 'tr' ? 'tr-TR' : 'en-US');
}

/**
 * The meaningful words of a phrase.
 *
 * Punctuation and code syntax are stripped rather than kept, so `print(name)`
 * and `print name` are the same three-word claim.
 */
function words(text: string, locale: SupportedLocale): string[] {
  return fold(text, locale)
    .replace(/[^\p{L}\p{N}_]+/gu, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 1 && !STOPWORDS.has(word));
}

/**
 * Whether two words are the same claim.
 *
 * A prefix match covers both English plurals and Turkish suffixes — "dizi" in
 * the key point against "dizide" in the answer — without shipping a stemmer for
 * either language.
 */
function sameWord(a: string, b: string): boolean {
  if (a === b) return true;

  // Compare stems rather than whole words: Turkish inflects heavily
  // ("oluşturur" / "oluşturuyor"), and four shared leading characters is short
  // enough to catch that while long enough that "değer" and "değişken" stay
  // different words.
  const limit = Math.min(a.length, b.length);
  let shared = 0;
  while (shared < limit && a[shared] === b[shared]) shared += 1;
  return shared >= 4;
}

function isCovered(point: string, answerWords: string[], locale: SupportedLocale): boolean {
  const needed = words(point, locale);
  if (needed.length === 0) return false;

  const hits = needed.filter((word) => answerWords.some((said) => sameWord(word, said))).length;
  // A third of the point's own words. Half was too strict against the bundle's
  // own model answers, which say the same thing in different words; a third
  // still needs the learner to have named something specific about it.
  return hits / needed.length >= 1 / 3;
}

/**
 * Where the lines sit.
 *
 * Calibrated against the bundle: the sample answers — which are what a good
 * answer looks like — cover a median of 100% of their key points but paraphrase
 * enough that a tenth of them land near 50, while answers that say nothing
 * about the code top out at 33. Sixty and forty separate those two populations
 * with room on both sides.
 */
const CORRECT_AT = 60;
const PARTIAL_AT = 40;

function verdictFor(score: number): ExplanationVerdict {
  if (score >= CORRECT_AT) return 'correct';
  if (score >= PARTIAL_AT) return 'partial';
  return 'incorrect';
}

/**
 * Mark one explanation.
 *
 * @param answer - The learner's own words.
 * @param keyPoints - The question's key points, already in `locale`.
 * @throws {AppError} `answer_too_short` below the length the prompt asks for.
 */
export function gradeLocally(
  answer: string,
  keyPoints: string[],
  locale: SupportedLocale
): ExplanationReview {
  const trimmed = answer.trim();
  if (trimmed.length < EXPLANATION_MIN_CHARS) {
    throw new AppError('answer_too_short', 'Explanation below the minimum length');
  }
  if (keyPoints.length === 0) {
    throw new AppError('unknown', 'The question ships no key points to mark against');
  }

  const answerWords = words(trimmed, locale);
  const missed = keyPoints.filter((point) => !isCovered(point, answerWords, locale));
  const covered = keyPoints.length - missed.length;
  const score = Math.round((covered / keyPoints.length) * 100);
  const verdict = verdictFor(score);

  const summaryKey =
    verdict === 'correct'
      ? 'explain.local_correct'
      : verdict === 'partial'
        ? 'explain.local_partial'
        : 'explain.local_incorrect';

  return {
    verdict,
    score,
    summary: t(summaryKey, { locale, covered, total: keyPoints.length }),
    // Only a model can tell the learner they said something wrong; coverage can
    // only tell them what they left out, so nothing is invented here.
    corrections: [],
    missedPoints: missed,
  };
}
