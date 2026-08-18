/**
 * Product analytics.
 *
 * A thin, typed wrapper over PostHog so events are named in one place and the
 * app keeps working when analytics is not configured (no key in `.env` means
 * every call here is a no-op).
 *
 * Privacy: only the Supabase user id and behavioural counters are ever sent —
 * never a learner's written answer, email or name.
 *
 * @module lib/analytics
 */

import { posthog } from '@/lib/posthog';

/** Every event the app emits, with the properties it carries. */
export type AnalyticsEvents = {
  onboarding_completed: { locale: string; course: string; daily_goal: number };
  lesson_started: { lesson_id: string; course: string; unit: string };
  lesson_completed: {
    lesson_id: string;
    course: string;
    score: number;
    stars: number;
    xp: number;
    duration_ms: number;
  };
  question_answered: { question_type: string; difficulty: string; correct: boolean };
  hearts_depleted: { lesson_id: string };
  practice_started: { deck: 'mistakes' | 'review'; size: number };
  ai_review_requested: { question_id: string; locale: string };
  ai_review_returned: { verdict: string; score: number };
  paywall_viewed: { source: string };
  purchase_started: { product_id: string; trial: boolean };
  purchase_completed: { product_id: string; trial: boolean };
  purchase_restored: { restored: boolean };
};

/**
 * Record an event.
 *
 * @param event - Event name from {@link AnalyticsEvents}.
 * @param properties - The event's payload.
 */
export function track<Event extends keyof AnalyticsEvents>(
  event: Event,
  properties: AnalyticsEvents[Event]
): void {
  posthog?.capture(event, properties as unknown as Record<string, string | number | boolean>);
}

/** Associate everything that follows with a signed-in learner. */
export function identify(userId: string, traits?: Record<string, string | number | boolean>): void {
  posthog?.identify(userId, traits);
}

/** Drop the association on sign-out. */
export function resetAnalytics(): void {
  posthog?.reset();
}
