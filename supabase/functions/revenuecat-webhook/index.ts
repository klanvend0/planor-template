/**
 * RevenueCat webhook receiver.
 *
 * Keeps `public.subscriptions` in step with the store so the backend can answer
 * "is this learner Pro?" without trusting the client. The app still reads
 * entitlements from the RevenueCat SDK for instant UI; this mirror is what the
 * AI grading function checks before spending tokens.
 *
 * Configure in the RevenueCat dashboard:
 *   URL     https://<project>.functions.supabase.co/revenuecat-webhook
 *   Header  Authorization: Bearer <REVENUECAT_WEBHOOK_SECRET>
 *
 * Secrets:
 *   REVENUECAT_WEBHOOK_SECRET - shared secret, required
 *   REVENUECAT_ENTITLEMENT    - entitlement id to track, default "pro"
 *
 * The function is deployed with `verify_jwt = false` (see supabase/config.toml)
 * because RevenueCat authenticates with the shared secret, not a Supabase JWT.
 *
 * @module supabase/functions/revenuecat-webhook
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';

type RevenueCatEvent = {
  type?: string;
  id?: string;
  app_user_id?: string;
  original_app_user_id?: string;
  aliases?: string[];
  transferred_from?: string[];
  transferred_to?: string[];
  product_id?: string;
  period_type?: string;
  store?: string;
  environment?: string;
  entitlement_ids?: string[] | null;
  entitlement_id?: string | null;
  expiration_at_ms?: number | null;
  purchased_at_ms?: number | null;
  event_timestamp_ms?: number | null;
};

type SubscriptionStatus =
  | 'trialing'
  | 'active'
  | 'grace'
  | 'expired'
  | 'cancelled'
  | 'billing_issue'
  | 'paused';

const WEBHOOK_SECRET = Deno.env.get('REVENUECAT_WEBHOOK_SECRET') ?? '';
const ENTITLEMENT = Deno.env.get('REVENUECAT_ENTITLEMENT') ?? 'pro';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Constant-time-ish comparison so the secret cannot be probed byte by byte. */
function secretMatches(header: string | null): boolean {
  if (!WEBHOOK_SECRET) return false;
  const provided = (header ?? '').replace(/^Bearer\s+/i, '');
  if (provided.length !== WEBHOOK_SECRET.length) return false;
  let diff = 0;
  for (let i = 0; i < provided.length; i += 1) {
    diff |= provided.charCodeAt(i) ^ WEBHOOK_SECRET.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Map an event type onto a status.
 *
 * CANCELLATION deliberately does NOT revoke access: the store keeps serving the
 * subscription until it expires, so only EXPIRATION flips a learner back to free.
 * BILLING_ISSUE maps to `grace` for the same reason — the retry window is still
 * paid time.
 *
 * @returns The new status, or null when the event carries no status change.
 */
function statusForEvent(event: RevenueCatEvent): SubscriptionStatus | null {
  const isTrial = (event.period_type ?? '').toUpperCase() === 'TRIAL';
  const expiresAt = event.expiration_at_ms ?? null;
  const expired = typeof expiresAt === 'number' && expiresAt <= Date.now();

  switch ((event.type ?? '').toUpperCase()) {
    case 'INITIAL_PURCHASE':
    case 'RENEWAL':
    case 'UNCANCELLATION':
    case 'PRODUCT_CHANGE':
    case 'NON_RENEWING_PURCHASE':
    case 'TEMPORARY_ENTITLEMENT_GRANT':
      return isTrial ? 'trialing' : 'active';
    case 'CANCELLATION':
      // Auto-renew was turned off; access continues until the period ends.
      return expired ? 'cancelled' : isTrial ? 'trialing' : 'active';
    case 'BILLING_ISSUE':
      return expired ? 'expired' : 'grace';
    case 'SUBSCRIPTION_PAUSED':
      return 'paused';
    case 'EXPIRATION':
      return 'expired';
    case 'TRANSFER':
      return null;
    default:
      return null;
  }
}

/** Candidate Supabase user ids carried by an event, most specific first. */
function candidateUserIds(event: RevenueCatEvent): string[] {
  const ids = [event.app_user_id, event.original_app_user_id, ...(event.aliases ?? [])];
  return [...new Set(ids.filter((id): id is string => !!id && UUID_PATTERN.test(id)))];
}

Deno.serve(async (request: Request) => {
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  if (!WEBHOOK_SECRET) {
    console.error('[revenuecat-webhook] REVENUECAT_WEBHOOK_SECRET is not set');
    return json({ error: 'not_configured' }, 503);
  }
  if (!secretMatches(request.headers.get('Authorization'))) {
    return json({ error: 'unauthorized' }, 401);
  }

  let payload: { event?: RevenueCatEvent };
  try {
    payload = await request.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  const event = payload.event;
  if (!event?.type) return json({ error: 'missing_event' }, 400);

  const entitlements = event.entitlement_ids ?? (event.entitlement_id ? [event.entitlement_id] : []);
  // Events for other entitlements (or none at all, e.g. TEST) are acknowledged
  // and ignored: returning non-2xx would make RevenueCat retry them forever.
  if (entitlements.length > 0 && !entitlements.includes(ENTITLEMENT)) {
    return json({ ok: true, ignored: 'other_entitlement' });
  }

  const client = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } }
  );

  // A transfer moves the entitlement between accounts: revoke, then grant.
  if ((event.type ?? '').toUpperCase() === 'TRANSFER') {
    const from = (event.transferred_from ?? []).filter((id) => UUID_PATTERN.test(id));
    const to = (event.transferred_to ?? []).filter((id) => UUID_PATTERN.test(id));

    if (from.length > 0) {
      await client
        .from('subscriptions')
        .update({ status: 'expired', will_renew: false, updated_at: new Date().toISOString() })
        .in('user_id', from);
    }
    if (to.length > 0) {
      await client.from('subscriptions').upsert(
        to.map((userId) => ({
          user_id: userId,
          rc_app_user_id: userId,
          entitlement: ENTITLEMENT,
          status: 'active' as SubscriptionStatus,
          product_id: event.product_id ?? null,
          store: event.store ?? null,
          environment: event.environment ?? null,
          will_renew: true,
          updated_at: new Date().toISOString(),
          raw_event: event as unknown as Record<string, unknown>,
        })),
        { onConflict: 'user_id' }
      );
    }
    return json({ ok: true, handled: 'transfer' });
  }

  const status = statusForEvent(event);
  if (!status) return json({ ok: true, ignored: 'no_status_change' });

  const userIds = candidateUserIds(event);
  if (userIds.length === 0) {
    // Anonymous RevenueCat ids belong to a learner who has not signed in yet.
    return json({ ok: true, ignored: 'anonymous_app_user_id' });
  }

  const expiresAt = event.expiration_at_ms ? new Date(event.expiration_at_ms).toISOString() : null;
  const isTrial = (event.period_type ?? '').toUpperCase() === 'TRIAL';

  const { error } = await client.from('subscriptions').upsert(
    {
      user_id: userIds[0],
      rc_app_user_id: event.app_user_id ?? userIds[0],
      entitlement: ENTITLEMENT,
      product_id: event.product_id ?? null,
      store: event.store ?? null,
      status,
      period_type: event.period_type ?? null,
      current_period_end: expiresAt,
      trial_end: isTrial ? expiresAt : null,
      will_renew: !['EXPIRATION', 'CANCELLATION', 'SUBSCRIPTION_PAUSED'].includes(
        (event.type ?? '').toUpperCase()
      ),
      environment: event.environment ?? null,
      updated_at: new Date().toISOString(),
      raw_event: event as unknown as Record<string, unknown>,
    },
    { onConflict: 'user_id' }
  );

  if (error) {
    console.error('[revenuecat-webhook] upsert failed', error);
    // 500 makes RevenueCat retry, which is what we want for a transient failure.
    return json({ error: 'persist_failed' }, 500);
  }

  return json({ ok: true, status, user_id: userIds[0] });
});
