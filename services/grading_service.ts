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

import { USES_LOCAL_BACKEND } from '@/lib/backend_mode';
import { AppError } from '@/lib/errors';
import type { SupportedLocale } from '@/lib/i18n';
import { supabase } from '@/lib/supabase';
import { getQuestion } from '@/services/content_service';
import { recordAiReview, readSubscription } from '@/services/local/backend';
import { gradeLocally } from '@/services/local/grader';

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
  // The screen counts characters too, but the server is the one that decides,
  // and "Something went wrong" would be a lie about a fixable answer.
  if (code === 'answer_too_short') {
    return new AppError('answer_too_short', 'Explanation below the minimum length');
  }
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
  if (USES_LOCAL_BACKEND) return gradeOnDevice(params);

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

/**
 * Mark the explanation here, against the key points the question ships.
 *
 * The entitlement is checked for the same reason the edge function checks it:
 * this is the paid feature, and the screen that offers it has to behave the
 * same way in both builds.
 */
async function gradeOnDevice(params: {
  questionId: string;
  answer: string;
  locale: SupportedLocale;
}): Promise<ExplanationReview> {
  if (!(await readSubscription())) {
    throw new AppError('subscription_required', 'Pro subscription required');
  }

  const question = getQuestion(params.questionId);
  if (!question || question.type !== 'explain_code') {
    throw new AppError('unknown', `no rubric for ${params.questionId}`);
  }

  const review = gradeLocally(params.answer, question.keyPoints[params.locale], params.locale);
  await recordAiReview(params.questionId, review.verdict);
  return review;
}
