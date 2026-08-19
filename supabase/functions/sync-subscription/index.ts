/**
 * Pull the learner's entitlement from RevenueCat, now.
 *
 * The mirror in `public.subscriptions` is what every server-side rule reads —
 * hearts, the AI grader's entitlement check, how much of a lesson counts — and
 * it is normally written by the RevenueCat webhook. Webhooks are fast but not
 * instant, and a customer who has just paid is the worst possible audience for
 * "nothing unlocked yet": the app would still be reading the old row.
 *
 * So the client calls this immediately after a purchase or a restore. It asks
 * RevenueCat what the caller owns and writes that, closing the gap rather than
 * hoping the webhook wins the race. The webhook remains the authority for
 * everything afterwards (renewals, expirations, refunds); this only ever writes
 * what RevenueCat says at the moment it is asked.
 *
 * The caller proves who they are with their own JWT and the id is taken from
 * that token, never from the request body, so nobody can sync somebody else's
 * entitlement onto their account.
 *
 * Secret: REVENUECAT_API_KEY (a v1 secret key, not the public SDK key).
 *
 * @module supabase/functions/sync-subscription
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const ENTITLEMENT = Deno.env.get('REVENUECAT_ENTITLEMENT') ?? 'pro';
const REVENUECAT_API_KEY = Deno.env.get('REVENUECAT_API_KEY') ?? '';
/**
 * Sandbox purchases are free to make — a TestFlight tester or anyone with a
 * sandbox Apple ID can "buy" Pro. The webhook refuses them for that reason, and
 * so must this: reading the same entitlement over REST would otherwise be a way
 * around the guard. Set `REVENUECAT_ALLOW_SANDBOX=true` on a staging project.
 */
const ALLOW_SANDBOX = (Deno.env.get('REVENUECAT_ALLOW_SANDBOX') ?? '') === 'true';

type SubscriptionStatus = 'trialing' | 'active' | 'expired';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

/** What RevenueCat currently says this learner owns. */
async function fetchEntitlement(appUserId: string): Promise<
  | {
      status: SubscriptionStatus;
      productId: string | null;
      expiresAt: string | null;
      periodType: string | null;
      store: string | null;
      environment: 'PRODUCTION' | 'SANDBOX';
    }
  | 'unavailable'
> {
  const response = await fetch(
    `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(appUserId)}`,
    { headers: { Authorization: `Bearer ${REVENUECAT_API_KEY}` } }
  );

  // A 404 means RevenueCat has never seen this id, which is a real answer:
  // the learner owns nothing. Anything else is an outage, not an answer.
  if (response.status === 404) {
    return {
      status: 'expired',
      productId: null,
      expiresAt: null,
      periodType: null,
      store: null,
      environment: 'PRODUCTION',
    };
  }
  if (!response.ok) {
    console.error('[sync-subscription] lookup failed', response.status, await response.text());
    return 'unavailable';
  }

  const payload = await response.json();
  const entitlement = payload?.subscriber?.entitlements?.[ENTITLEMENT];
  const nothing = {
    status: 'expired' as const,
    productId: null,
    expiresAt: null,
    periodType: null,
    store: null,
    environment: 'PRODUCTION' as const,
  };
  if (!entitlement) return nothing;

  const expiresAt: string | null = entitlement.expires_date ?? null;
  const active = !expiresAt || new Date(expiresAt).getTime() > Date.now();
  const productId: string | null = entitlement.product_identifier ?? null;

  // A renewing product is under `subscriptions`; a lifetime or consumable one is
  // under `non_subscriptions`, as an array. Both carry `is_sandbox`, and missing
  // that on the second kind would fail open on the purchase that never expires.
  const subscription = payload?.subscriber?.subscriptions?.[productId ?? ''];
  const purchases = payload?.subscriber?.non_subscriptions?.[productId ?? ''];
  const lastPurchase = Array.isArray(purchases) ? purchases[purchases.length - 1] : null;
  const source = subscription ?? lastPurchase ?? null;

  const sandbox = source?.is_sandbox === true;
  if (sandbox && !ALLOW_SANDBOX) {
    console.warn('[sync-subscription] sandbox entitlement ignored', { productId });
    return nothing;
  }

  const periodType: string | null = source?.period_type ?? null;

  return {
    status: active ? (periodType === 'trial' ? 'trialing' : 'active') : 'expired',
    productId,
    expiresAt,
    periodType,
    store: source?.store ?? null,
    environment: sandbox ? 'SANDBOX' : 'PRODUCTION',
  };
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  // Without the key there is nothing to ask. The client treats this as "wait
  // for the webhook" rather than as a failed purchase.
  if (!REVENUECAT_API_KEY) return json({ error: 'sync_unconfigured' }, 503);

  const authHeader = request.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return json({ error: 'unauthorized' }, 401);

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } }
  );

  const { data, error } = await admin.auth.getUser(authHeader.replace('Bearer ', ''));
  const user = data?.user;
  if (error || !user) return json({ error: 'unauthorized' }, 401);

  let entitlement;
  try {
    entitlement = await fetchEntitlement(user.id);
  } catch (caught) {
    console.error('[sync-subscription] lookup threw', caught);
    return json({ error: 'store_unreachable' }, 502);
  }
  if (entitlement === 'unavailable') return json({ error: 'store_unreachable' }, 502);

  // `rc_event_id` and `last_event_at` are deliberately not written: they belong
  // to the webhook's ordering, and a sync must not make a later real event look
  // like a duplicate.
  const { error: writeError } = await admin.from('subscriptions').upsert(
    {
      user_id: user.id,
      rc_app_user_id: user.id,
      entitlement: ENTITLEMENT,
      product_id: entitlement.productId,
      store: entitlement.store,
      status: entitlement.status,
      period_type: entitlement.periodType,
      current_period_end: entitlement.expiresAt,
      trial_end: entitlement.periodType === 'trial' ? entitlement.expiresAt : null,
      will_renew: entitlement.status === 'active' || entitlement.status === 'trialing',
      environment: entitlement.environment,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' }
  );

  if (writeError) {
    // The account is gone; there is nothing to mirror onto.
    if (writeError.code === '23503') return json({ ok: true, ignored: 'user_deleted' });
    console.error('[sync-subscription] persist failed', writeError);
    return json({ error: 'persist_failed' }, 500);
  }

  return json({ ok: true, status: entitlement.status, expires_at: entitlement.expiresAt });
});
