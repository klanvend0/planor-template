/**
 * `sync-subscription`, run for real.
 *
 * @module supabase/functions/_tests/sync_subscription_test
 */

import { assertEquals, loadFunction, startSupabaseStub, stubFetch } from './harness.ts';

const LEARNER = '11111111-1111-1111-1111-111111111111';
const REVENUECAT = 'https://api.revenuecat.com';

type Module = { handleSyncSubscription: (request: Request) => Promise<Response> };

function post(token = 'learner-jwt'): Request {
  return new Request('http://localhost/sync-subscription', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
}

async function withWorld(
  environment: Record<string, string>,
  revenuecat: Parameters<typeof stubFetch>[1],
  run: (module: Module, harness: Awaited<ReturnType<typeof startSupabaseStub>>) => Promise<void>
) {
  const harness = await startSupabaseStub({
    'GET /auth/v1/user': { body: { id: LEARNER, aud: 'authenticated', email: 'a@example.com' } },
    'POST /rest/v1/subscriptions': { status: 201, body: [] },
  });
  const restore = stubFetch(harness, revenuecat);
  try {
    const module = await loadFunction<Module>('../sync-subscription/index.ts', {
      SUPABASE_URL: harness.url,
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
      REVENUECAT_ENTITLEMENT: 'pro',
      ...environment,
    });
    await run(module, harness);
  } finally {
    restore();
    await harness.stop();
  }
}

Deno.test('writes the mirror from what RevenueCat says the learner owns', async () => {
  await withWorld(
    { REVENUECAT_API_KEY: 'sk_test' },
    {
      [`GET ${REVENUECAT}/v1/subscribers/*`]: {
        body: {
          subscriber: {
            entitlements: {
              pro: {
                expires_date: '2099-01-01T00:00:00Z',
                product_identifier: 'codeling_pro_monthly',
              },
            },
            subscriptions: {
              codeling_pro_monthly: { is_sandbox: false, period_type: 'trial', store: 'app_store' },
            },
          },
        },
      },
    },
    async (module, harness) => {
      const response = await module.handleSyncSubscription(post());
      assertEquals(response.status, 200);
      assertEquals(await response.json(), {
        ok: true,
        status: 'trialing',
        expires_at: '2099-01-01T00:00:00Z',
      });

      const write = harness.requests.find((request) => request.path === '/rest/v1/subscriptions');
      // supabase-js upserts as `on_conflict=user_id` with merge-duplicates.
      assertEquals(write?.search, '?on_conflict=user_id');
      assertEquals(write?.headers.prefer, 'resolution=merge-duplicates');
      const row = write?.body as Record<string, unknown>;
      assertEquals(row.user_id, LEARNER);
      assertEquals(row.status, 'trialing');
      assertEquals(row.product_id, 'codeling_pro_monthly');
      assertEquals(row.trial_end, '2099-01-01T00:00:00Z');
      assertEquals(row.environment, 'PRODUCTION');
      // The webhook owns event ordering; a sync must not touch it.
      assertEquals('rc_event_id' in row, false);
      assertEquals('last_event_at' in row, false);
    }
  );
});

Deno.test('counts a sandbox purchase, which is what App Store review makes', async () => {
  await withWorld(
    { REVENUECAT_API_KEY: 'sk_test' },
    {
      [`GET ${REVENUECAT}/v1/subscribers/*`]: {
        body: {
          subscriber: {
            entitlements: {
              pro: { expires_date: '2099-01-01T00:00:00Z', product_identifier: 'p' },
            },
            subscriptions: { p: { is_sandbox: true, period_type: 'normal', store: 'app_store' } },
          },
        },
      },
    },
    async (module, harness) => {
      const response = await module.handleSyncSubscription(post());
      assertEquals(await response.json(), {
        ok: true,
        status: 'active',
        expires_at: '2099-01-01T00:00:00Z',
      });
      const write = harness.requests.find((request) => request.path === '/rest/v1/subscriptions');
      assertEquals((write?.body as Record<string, unknown>).environment, 'SANDBOX');
    }
  );
});

Deno.test('ignores one when the project says production purchases only', async () => {
  await withWorld(
    { REVENUECAT_API_KEY: 'sk_test', REVENUECAT_IGNORE_SANDBOX: 'true' },
    {
      [`GET ${REVENUECAT}/v1/subscribers/*`]: {
        body: {
          subscriber: {
            entitlements: {
              pro: { expires_date: '2099-01-01T00:00:00Z', product_identifier: 'p' },
            },
            // A lifetime purchase is under non_subscriptions, as an array.
            non_subscriptions: { p: [{ is_sandbox: true, store: 'app_store' }] },
          },
        },
      },
    },
    async (module, harness) => {
      const response = await module.handleSyncSubscription(post());
      assertEquals(await response.json(), { ok: true, status: 'expired', expires_at: null });
      const write = harness.requests.find((request) => request.path === '/rest/v1/subscriptions');
      assertEquals((write?.body as Record<string, unknown>).status, 'expired');
    }
  );
});

Deno.test('refuses a caller without a token, and one the store cannot be reached for', async () => {
  await withWorld(
    { REVENUECAT_API_KEY: 'sk_test' },
    { [`GET ${REVENUECAT}/v1/subscribers/*`]: { status: 500 } },
    async (module) => {
      const anonymous = await module.handleSyncSubscription(
        new Request('http://localhost/sync-subscription', { method: 'POST' })
      );
      assertEquals(anonymous.status, 401);

      const unreachable = await module.handleSyncSubscription(post());
      assertEquals(unreachable.status, 502);
      assertEquals(await unreachable.json(), { error: 'store_unreachable' });
    }
  );
});

Deno.test(
  'says so plainly when no key is configured, rather than failing the purchase',
  async () => {
    await withWorld({ REVENUECAT_API_KEY: '' }, {}, async (module) => {
      const response = await module.handleSyncSubscription(post());
      assertEquals(response.status, 503);
      assertEquals(await response.json(), { error: 'sync_unconfigured' });
    });
  }
);

Deno.test('treats a learner RevenueCat has never seen as owning nothing', async () => {
  await withWorld(
    { REVENUECAT_API_KEY: 'sk_test' },
    { [`GET ${REVENUECAT}/v1/subscribers/*`]: { status: 404, body: { message: 'not found' } } },
    async (module) => {
      const response = await module.handleSyncSubscription(post());
      assertEquals(await response.json(), { ok: true, status: 'expired', expires_at: null });
    }
  );
});
