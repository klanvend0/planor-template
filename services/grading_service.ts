/**
 * AI grading of free-text explanations.
 *
 * Thin client over the `grade-explanation` edge function. The rubric lives in
 * Postgres, so the app sends only the question id, the learner's words and the
 * locale to answer in.
 *
 * @module services/grading_service
 */

import { FunctionsHttpError } from '@supabase/supabase-js';

import { AppError } from '@/lib/errors';
import type { SupportedLocale } from '@/lib/i18n';
import { supabase } from '@/lib/supabase';

export type ExplanationVerdict = 'correct' | 'partial' | 'incorrect';

export type ExplanationReview = {
  verdict: ExplanationVerdict;
  /** 0-100 understanding score. */
  score: number;
  /** One or two sentences addressed to the learner. */
  summary: string;
  /** Things the learner got wrong, with the correction. */
  corrections: string[];
  /** Rubric points the learner never mentioned. */
  missedPoints: string[];
};

/** Map an edge function error body onto an {@link AppError} code. */
function errorFromStatus(status: number, code: string | undefined): AppError {
  if (status === 402 || code === 'subscription_required') {
    return new AppError('subscription_required', 'Pro subscription required');
  }
  if (status === 429 || code === 'rate_limited') {
    return new AppError('rate_limited', 'Too many gradings, slow down');
  }
  if (status === 401) return new AppError('auth', 'Session expired');
  return new AppError('unknown', code ?? `grading failed (${status})`);
}

/**
 * Grade one explanation.
 *
 * @param params.questionId - Id of the `explain_code` question being answered.
 * @param params.answer - The learner's own words, 100-200 characters.
 * @param params.locale - Language the feedback should be written in.
 * @throws {AppError} `subscription_required` for free users, `rate_limited`
 * when the per-user cap is hit, `network` when offline.
 */
export async function gradeExplanation(params: {
  questionId: string;
  answer: string;
  locale: SupportedLocale;
}): Promise<ExplanationReview> {
  const { data, error } = await supabase.functions.invoke('grade-explanation', {
    body: {
      questionId: params.questionId,
      answer: params.answer,
      locale: params.locale,
    },
  });

  if (error) {
    if (error instanceof FunctionsHttpError) {
      let code: string | undefined;
      try {
        const body = await error.context.json();
        code = typeof body?.error === 'string' ? body.error : undefined;
      } catch {
        // Body was not JSON; the status alone decides.
      }
      throw errorFromStatus(error.context.status, code);
    }
    throw new AppError('network', error.message ?? 'Could not reach the grader', error);
  }

  const payload = data as Partial<ExplanationReview> | null;
  if (!payload?.verdict) throw new AppError('unknown', 'Grader returned an empty result');

  return {
    verdict: payload.verdict,
    score: Math.max(0, Math.min(100, Math.round(payload.score ?? 0))),
    summary: payload.summary ?? '',
    corrections: Array.isArray(payload.corrections) ? payload.corrections : [],
    missedPoints: Array.isArray(payload.missedPoints) ? payload.missedPoints : [],
  };
}
