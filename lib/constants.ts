/**
 * Product constants.
 *
 * Values that several modules must agree on: what "free" includes, how the
 * paywall identifies an entitlement, and the legal links App Store review
 * requires on the subscription screen.
 *
 * @module lib/constants
 */

/** Units of every course that are playable without a subscription. */
export const FREE_UNIT_LIMIT = 2;

/** Entitlement identifier configured in RevenueCat. */
export const ENTITLEMENT_ID = 'pro';

/** Offering identifier RevenueCat serves the paywall from. */
export const DEFAULT_OFFERING_ID = 'default';

/** Free trial length advertised on the paywall, in days. */
export const TRIAL_DAYS = 3;

/** Answer length bounds for the AI-graded explanation questions. */
export const EXPLANATION_MIN_CHARS = 100;
export const EXPLANATION_MAX_CHARS = 200;

/** Questions in a generated practice session. */
export const PRACTICE_SESSION_SIZE = 10;

/**
 * Legal and support links.
 *
 * Apple requires functional Terms of Use (EULA) and Privacy Policy links on any
 * screen that sells a subscription (Guideline 3.1.2). Point these at the real
 * pages before submitting; the placeholders below are deliberately obvious.
 */
export const LINKS = {
  terms: process.env.EXPO_PUBLIC_TERMS_URL ?? 'https://codeling.app/terms',
  privacy: process.env.EXPO_PUBLIC_PRIVACY_URL ?? 'https://codeling.app/privacy',
  support: process.env.EXPO_PUBLIC_SUPPORT_URL ?? 'mailto:support@codeling.app',
  manageSubscription: 'https://apps.apple.com/account/subscriptions',
} as const;

/** App Store id, used by the "rate this app" action. Fill in after first submit. */
export const APP_STORE_ID = process.env.EXPO_PUBLIC_APP_STORE_ID ?? '';
