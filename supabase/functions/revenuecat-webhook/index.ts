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
 *   REVENUECAT_API_KEY        - v1 secret key, only needed to resolve TRANSFER
 *
 * Deployment note: RevenueCat sends its shared secret in the `Authorization`
 * header, which Supabase would otherwise try to parse as a Supabase JWT and
 * reject before this code runs. The function is therefore declared
 * `verify_jwt = false` in supabase/config.toml (deploy with `--no-verify-jwt`)
 * and checks the secret itself.
 *
 * @module supabase/functions/revenuecat-webhook
 */

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';

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
  'trialing' | 'active' | 'grace' | 'expired' | 'cancelled' | 'billing_issue' | 'paused';

const WEBHOOK_SECRET = Deno.env.get('REVENUECAT_WEBHOOK_SECRET') ?? '';
const ENTITLEMENT = Deno.env.get('REVENUECAT_ENTITLEMENT') ?? 'pro';
const REVENUECAT_API_KEY = Deno.env.get('REVENUECAT_API_KEY') ?? '';
/**
 * Whether to throw sandbox entitlements away.
 *
 * Off by default, and that is deliberate: App Store review buys in the sandbox,
 * and so does every TestFlight tester. Refusing those events would leave the
 * reviewer looking at a subscription they just paid for and an app that still
 * says "Free plan" — a rejection, not a saving. A sandbox purchase also cannot
 * be made from an App Store build, so accepting them gives nothing away.
 *
 * Set `REVENUECAT_IGNORE_SANDBOX=true` on a project where only production
 * purchases should ever count.
 */
const IGNORE_SANDBOX = (Deno.env.get('REVENUECAT_IGNORE_SANDBOX') ?? '') === 'true';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Constant-time comparison of two SHA-256 digests.
 *
 * Hashing first means the comparison is always over 32 bytes, so neither the
 * secret's length nor an early mismatch is observable in the response time.
 */
async function secretMatches(header: string | null): Promise<boolean> {
  if (!WEBHOOK_SECRET) return false;
  const provided = (header ?? '').replace(/^Bearer\s+/i, '');

  const digest = async (value: string) =>
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));

  const [a, b] = await Promise.all([digest(provided), digest(WEBHOOK_SECRET)]);

  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

/**
 * Map an event type onto a status.
 *
 * CANCELLATION deliberately does NOT revoke access: the store keeps serving the
 * subscription until it expires, so only EXPIRATION flips a learner back to
 * free. BILLING_ISSUE maps to `grace` for the same reason — the retry window is
 * still paid time, and RevenueCat sends EXPIRATION if the retries fail.
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
      // Auto-renew was turned off (or a refund was issued); access continues
      // until the period ends.
      return expired ? 'cancelled' : isTrial ? 'trialing' : 'active';
    case 'BILLING_ISSUE':
      return expired ? 'expired' : 'grace';
    case 'SUBSCRIPTION_PAUSED':
      // A pause takes effect at the end of the paid period, not immediately.
      return expired ? 'paused' : isTrial ? 'trialing' : 'active';
    case 'EXPIRATION':
      return 'expired';
    default:
      return null;
  }
}

/** Candidate Supabase user ids carried by an event, most specific first. */
function candidateUserIds(event: RevenueCatEvent): string[] {
  const ids = [event.app_user_id, event.original_app_user_id, ...(event.aliases ?? [])];
  return [...new Set(ids.filter((id): id is string => !!id && UUID_PATTERN.test(id)))];
}

/**
 * Read a subscriber's live entitlement state from the RevenueCat REST API.
 *
 * TRANSFER events carry no entitlement data at all — only the ids involved — so
 * the receiving account's state has to be fetched rather than guessed.
 */
async function fetchSubscriberState(appUserId: string): Promise<{
  status: SubscriptionStatus;
  productId: string | null;
  expiresAt: string | null;
  periodType: string | null;
} | null> {
  if (!REVENUECAT_API_KEY) return null;

  try {
    const response = await fetch(
      `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(appUserId)}`,
      { headers: { Authorization: `Bearer ${REVENUECAT_API_KEY}` } }
    );
    if (!response.ok) return null;

    const payload = await response.json();
    const entitlement = payload?.subscriber?.entitlements?.[ENTITLEMENT];
    if (!entitlement) {
      return { status: 'expired', productId: null, expiresAt: null, periodType: null };
    }

    const expiresAt: string | null = entitlement.expires_date ?? null;
    const active = !expiresAt || new Date(expiresAt).getTime() > Date.now();
    const productId: string | null = entitlement.product_identifier ?? null;
    const periodType: string | null =
      payload?.subscriber?.subscriptions?.[productId ?? '']?.period_type ?? null;

    return {
      status: active ? (periodType === 'trial' ? 'trialing' : 'active') : 'expired',
      productId,
      expiresAt,
      periodType,
    };
  } catch (error) {
    console.error('[revenuecat-webhook] subscriber lookup failed', error);
    return null;
  }
}

/**
 * Decide whether an event should be applied.
 *
 * Events are retried and can arrive out of order, so a duplicate is dropped and
 * a late event never overwrites a newer one.
 */
async function shouldApply(
  client: SupabaseClient,
  userId: string,
  event: RevenueCatEvent
): Promise<{ apply: boolean; reason?: string }> {
  const { data } = await client
    .from('subscriptions')
    .select('rc_event_id, last_event_at')
    .eq('user_id', userId)
    .maybeSingle();

  if (!data) return { apply: true };
  if (event.id && data.rc_event_id === event.id) return { apply: false, reason: 'duplicate_event' };

  if (event.event_timestamp_ms && data.last_event_at) {
    const incoming = new Date(event.event_timestamp_ms).getTime();
    const applied = new Date(data.last_event_at).getTime();
    if (incoming < applied) return { apply: false, reason: 'stale_event' };
  }

  return { apply: true };
}

/**
 * The function itself. Exported so `supabase/functions/_tests` can call it
 * directly; the runtime reaches it through `Deno.serve` below.
 */
export async function handleRevenueCatWebhook(request: Request): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  if (!WEBHOOK_SECRET) {
    console.error('[revenuecat-webhook] REVENUECAT_WEBHOOK_SECRET is not set');
    return json({ error: 'not_configured' }, 503);
  }
  if (!(await secretMatches(request.headers.get('Authorization')))) {
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

  const entitlements =
    event.entitlement_ids ?? (event.entitlement_id ? [event.entitlement_id] : []);
  // Events for other entitlements (or none, e.g. TEST) are acknowledged and
  // ignored: a non-2xx would make RevenueCat retry them forever.
  if (entitlements.length > 0 && !entitlements.includes(ENTITLEMENT)) {
    return json({ ok: true, ignored: 'other_entitlement' });
  }

  const client = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } }
  );

  // Kept, unless this project is configured to count production purchases only.
  const environment = (event.environment ?? '').toUpperCase();
  if (IGNORE_SANDBOX && environment && environment !== 'PRODUCTION') {
    return json({ ok: true, ignored: 'sandbox_event' });
  }

  const eventAt = event.event_timestamp_ms
    ? new Date(event.event_timestamp_ms).toISOString()
    : new Date().toISOString();
  const eventType = (event.type ?? '').toUpperCase();

  // A transfer moves the entitlement between accounts and carries no state of
  // its own, so the winning id has to be granted from somewhere else and the
  // losing ids revoked.
  //
  // Order matters more than anything else here. Revoking first and granting
  // second means any failure in between leaves the paying customer with access
  // on neither account, silently, because a 200 stops RevenueCat retrying. So
  // the grant is committed first: the worst case becomes a customer briefly
  // entitled on both accounts, which `current_period_end` ends on its own.
  if (eventType === 'TRANSFER') {
    const from = (event.transferred_from ?? []).filter((id) => UUID_PATTERN.test(id));
    const to = (event.transferred_to ?? []).filter((id) => UUID_PATTERN.test(id));

    // The same duplicate/stale guard the ordinary path uses; a retried transfer
    // must not revoke an account that has since been granted again.
    if (to.length > 0) {
      const decision = await shouldApply(client, to[0], event);
      if (!decision.apply) return json({ ok: true, ignored: decision.reason });
    }

    // What is being moved. The REST API is the better source when a key is
    // configured, but the mirror already holds the subscription being
    // transferred, so a missing key is not a reason to strand anyone.
    const { data: sourceRows } = await client
      .from('subscriptions')
      .select(
        'product_id, store, status, period_type, current_period_end, trial_end, will_renew, environment'
      )
      .in('user_id', from.length > 0 ? from : ['00000000-0000-0000-0000-000000000000'])
      .order('updated_at', { ascending: false })
      .limit(1);
    const source = sourceRows?.[0] ?? null;

    let granted = 0;
    for (const userId of to) {
      const state = await fetchSubscriberState(userId);

      const row = state
        ? {
            product_id: state.productId,
            store: source?.store ?? null,
            status: state.status,
            period_type: state.periodType,
            current_period_end: state.expiresAt,
            trial_end: state.periodType === 'trial' ? state.expiresAt : null,
            will_renew: state.status === 'active' || state.status === 'trialing',
            environment: event.environment ?? source?.environment ?? null,
          }
        : source
          ? {
              product_id: source.product_id,
              store: source.store,
              status: source.status,
              period_type: source.period_type,
              current_period_end: source.current_period_end,
              trial_end: source.trial_end,
              will_renew: source.will_renew,
              environment: event.environment ?? source.environment,
            }
          : null;

      if (!row) {
        // Neither the API nor the mirror can say what this account should own.
        // Granting nothing and revoking nothing leaves the customer with access
        // on the account that already had it, which is the safe side.
        console.error(
          '[revenuecat-webhook] transfer target unresolvable; both accounts left as they were',
          { event: event.id, to: userId }
        );
        return json({ ok: true, ignored: 'transfer_unresolvable' });
      }

      const { error: grantError } = await client.from('subscriptions').upsert(
        {
          user_id: userId,
          rc_app_user_id: userId,
          entitlement: ENTITLEMENT,
          ...row,
          rc_event_id: event.id ?? null,
          last_event_at: eventAt,
          updated_at: new Date().toISOString(),
          raw_event: event as unknown as Record<string, unknown>,
        },
        { onConflict: 'user_id' }
      );

      if (grantError) {
        // A deleted account cannot be granted anything; every other failure is
        // worth a retry, and must not revoke the source in the meantime.
        if (grantError.code === '23503') continue;
        console.error('[revenuecat-webhook] transfer grant failed', grantError);
        return json({ error: 'persist_failed' }, 500);
      }
      granted += 1;
    }

    if (from.length > 0 && (granted > 0 || to.length === 0)) {
      const { error: revokeError } = await client
        .from('subscriptions')
        .update({
          status: 'expired',
          will_renew: false,
          rc_event_id: event.id ?? null,
          last_event_at: eventAt,
          updated_at: new Date().toISOString(),
        })
        .in('user_id', from);

      if (revokeError) {
        console.error('[revenuecat-webhook] transfer revoke failed', revokeError);
        return json({ error: 'persist_failed' }, 500);
      }
    }

    return json({ ok: true, handled: 'transfer', from: from.length, to: granted });
  }

  const status = statusForEvent(event);
  if (!status) return json({ ok: true, ignored: 'no_status_change' });

  const userIds = candidateUserIds(event);
  if (userIds.length === 0) {
    // Anonymous RevenueCat ids belong to a learner who has not signed in yet.
    return json({ ok: true, ignored: 'anonymous_app_user_id' });
  }

  const userId = userIds[0];
  const decision = await shouldApply(client, userId, event);
  if (!decision.apply) return json({ ok: true, ignored: decision.reason });

  const expiresAt = event.expiration_at_ms ? new Date(event.expiration_at_ms).toISOString() : null;
  const isTrial = (event.period_type ?? '').toUpperCase() === 'TRIAL';

  const { error } = await client.from('subscriptions').upsert(
    {
      user_id: userId,
      rc_app_user_id: event.app_user_id ?? userId,
      entitlement: ENTITLEMENT,
      product_id: event.product_id ?? null,
      store: event.store ?? null,
      status,
      period_type: event.period_type ?? null,
      current_period_end: expiresAt,
      trial_end: isTrial ? expiresAt : null,
      will_renew: !['EXPIRATION', 'CANCELLATION', 'SUBSCRIPTION_PAUSED'].includes(eventType),
      environment: event.environment ?? null,
      rc_event_id: event.id ?? null,
      last_event_at: eventAt,
      updated_at: new Date().toISOString(),
      raw_event: event as unknown as Record<string, unknown>,
    },
    { onConflict: 'user_id' }
  );

  if (error) {
    // A foreign-key violation means the learner deleted their account: there is
    // nothing to mirror, and retrying forever would only fill the logs.
    if (error.code === '23503') {
      return json({ ok: true, ignored: 'user_deleted' });
    }
    console.error('[revenuecat-webhook] upsert failed', error);
    // 500 makes RevenueCat retry, which is what a transient failure needs.
    return json({ error: 'persist_failed' }, 500);
  }

  return json({ ok: true, status, user_id: userId });
}

Deno.serve(handleRevenueCatWebhook);
