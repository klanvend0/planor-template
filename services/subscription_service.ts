/**
 * Making the server agree that the learner just paid.
 *
 * Every server-side rule reads `public.subscriptions`, which the RevenueCat
 * webhook writes. The webhook is quick but not instantaneous, and in the gap a
 * customer who has just bought Pro is still refused by the grader and still
 * loses hearts — the one moment where "wait a few seconds" is unacceptable.
 *
 * So after a purchase or a restore the app asks the backend to read the
 * entitlement from RevenueCat directly. Failure is never fatal: the webhook is
 * still coming, and the local snapshot already unlocked the UI.
 *
 * @module services/subscription_service
 */

import { USES_LOCAL_BACKEND } from '@/lib/backend_mode';
import { supabase } from '@/lib/supabase';

/**
 * Pull the entitlement into the mirror now.
 *
 * @returns True when the backend confirmed it wrote something.
 */
export async function syncSubscription(): Promise<boolean> {
  // There is no mirror on a device-only build: the entitlement is the document.
  if (USES_LOCAL_BACKEND) return true;

  try {
    const { data, error } = await supabase.functions.invoke('sync-subscription', { body: {} });
    if (error) {
      // A missing REVENUECAT_API_KEY answers 503; the webhook still lands.
      console.warn('[subscription] sync failed, waiting for the webhook', error.message);
      return false;
    }
    return (data as { ok?: boolean } | null)?.ok === true;
  } catch (error) {
    console.warn('[subscription] sync threw, waiting for the webhook', error);
    return false;
  }
}
