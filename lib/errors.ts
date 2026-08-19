/**
 * Error normalization.
 *
 * Every service failure is funnelled into an {@link AppError} with a code the UI
 * can map to a translated message, so no screen ever shows a raw Postgres or
 * fetch error to a learner.
 *
 * @module lib/errors
 */

import type { TranslationKeys } from '@/lib/i18n';

export type AppErrorCode =
  | 'network'
  | 'auth'
  | 'rate_limited'
  | 'subscription_required'
  | 'store_unavailable'
  | 'storage_unavailable'
  | 'answer_too_short'
  | 'unknown';

/** A failure that already knows how it should be shown to the learner. */
export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly cause?: unknown;

  constructor(code: AppErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.cause = cause;
  }
}

const NETWORK_HINTS = [
  'network request failed',
  'failed to fetch',
  'timeout',
  'econnrefused',
  'offline',
];

/**
 * Turn anything thrown by Supabase, fetch or RevenueCat into an {@link AppError}.
 *
 * @param error - The caught value.
 * @param fallback - Code to use when nothing more specific can be detected.
 */
export function toAppError(error: unknown, fallback: AppErrorCode = 'unknown'): AppError {
  if (error instanceof AppError) return error;

  const message = error instanceof Error ? error.message : String(error ?? 'Unknown error');
  const lower = message.toLowerCase();

  if (NETWORK_HINTS.some((hint) => lower.includes(hint))) {
    return new AppError('network', message, error);
  }

  const status =
    (error as { status?: number; statusCode?: number } | null)?.status ??
    (error as { statusCode?: number } | null)?.statusCode;
  if (status === 401 || status === 403) return new AppError('auth', message, error);
  if (status === 429) return new AppError('rate_limited', message, error);
  if (status === 402) return new AppError('subscription_required', message, error);

  const pgCode = (error as { code?: string } | null)?.code;
  if (pgCode === '28000' || pgCode === 'PGRST301') return new AppError('auth', message, error);

  return new AppError(fallback, message, error);
}

/** The translation key that explains an error code to the learner. */
export function errorMessageKey(code: AppErrorCode): TranslationKeys {
  switch (code) {
    case 'network':
      return 'errors.network';
    case 'auth':
      return 'errors.sign_in_required';
    case 'rate_limited':
      return 'errors.rate_limited';
    case 'subscription_required':
      return 'errors.subscription_required';
    case 'store_unavailable':
      return 'paywall.unavailable';
    case 'storage_unavailable':
      return 'errors.storage_unavailable';
    case 'answer_too_short':
      return 'errors.answer_too_short';
    default:
      return 'errors.generic';
  }
}
