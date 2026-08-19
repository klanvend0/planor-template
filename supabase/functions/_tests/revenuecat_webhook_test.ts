/**
 * `revenuecat-webhook`, run for real.
 *
 * Every test drives the exported handler against the Supabase stub, so what is
 * asserted is the row PostgREST would have been sent, not a hand-written idea
 * of one. The RevenueCat REST API is stubbed at `fetch`, which is the only
 * other host the function talks to.
 *
 * @module supabase/functions/_tests/revenuecat_webhook_test
 */

import { assert, assertEquals, loadFunction, startSupabaseStub, stubFetch } from './harness.ts';

const SECRET = 'shared-secret';
const LEARNER = '11111111-1111-1111-1111-111111111111';
const PREVIOUS_OWNER = '22222222-2222-2222-2222-222222222222';
const REVENUECAT = 'https://api.revenuecat.com';

const EXPIRES_MS = Date.parse('2099-01-01T00:00:00Z');
const EXPIRES_AT = '2099-01-01T00:00:00.000Z';
const ENDED_MS = Date.parse('2020-01-01T00:00:00Z');
const EVENT_MS = Date.parse('2026-01-01T00:00:00Z');
const EVENT_AT = '2026-01-01T00:00:00.000Z';

type Module = { handleRevenueCatWebhook: (request: Request) => Promise<Response> };
type Harness = Awaited<ReturnType<typeof startSupabaseStub>>;
type Row = Record<string, unknown>;

type World = {
  /** Rows the duplicate/stale lookup finds for the user the event names. */
  existing?: Row[];
  /** Rows the transfer's source lookup finds for the accounts being left. */
  source?: Row[];
  /** What PostgREST answers the upsert with, for the failure paths. */
  upsert?: { status?: number; body?: unknown };
  environment?: Record<string, string>;
  revenuecat?: Parameters<typeof stubFetch>[1];
};

function purchase(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'INITIAL_PURCHASE',
    id: 'evt-initial',
    app_user_id: LEARNER,
    product_id: 'codeling_pro_monthly',
    period_type: 'NORMAL',
    store: 'APP_STORE',
    environment: 'PRODUCTION',
    entitlement_ids: ['pro'],
    expiration_at_ms: EXPIRES_MS,
    event_timestamp_ms: EVENT_MS,
    ...overrides,
  };
}

function transfer(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'TRANSFER',
    id: 'evt-transfer',
    // RevenueCat sends a transfer with no entitlement data of its own.
    entitlement_ids: null,
    transferred_from: [PREVIOUS_OWNER],
    transferred_to: [LEARNER],
    store: 'APP_STORE',
    environment: 'PRODUCTION',
    event_timestamp_ms: EVENT_MS,
    ...overrides,
  };
}

function delivery(event: unknown, secret: string | null = SECRET): Request {
  return new Request('http://localhost/revenuecat-webhook', {
    method: 'POST',
    headers: secret === null ? {} : { Authorization: `Bearer ${secret}` },
    body: JSON.stringify({ event }),
  });
}

/** Rows the function upserted, in the order it sent them. */
function writes(harness: Harness): Row[] {
  return harness.requests
    .filter((request) => request.method === 'POST' && request.path === '/rest/v1/subscriptions')
    .map((request) => request.body as Row);
}

/** Revocations the function sent, in the order it sent them. */
function revokes(harness: Harness) {
  return harness.requests.filter(
    (request) => request.method === 'PATCH' && request.path === '/rest/v1/subscriptions'
  );
}

async function withWorld(world: World, run: (module: Module, harness: Harness) => Promise<void>) {
  const harness = await startSupabaseStub({
    // Both reads hit the same route; the filter is what tells them apart.
    'GET /rest/v1/subscriptions': (request) =>
      request.search.includes('user_id=in.')
        ? { body: world.source ?? [] }
        : { body: world.existing ?? [] },
    'POST /rest/v1/subscriptions': world.upsert ?? { status: 201, body: [] },
    'PATCH /rest/v1/subscriptions': { status: 200, body: [] },
  });
  const restore = stubFetch(harness, world.revenuecat ?? {});
  try {
    // Every secret is named, so a value one test sets cannot survive into the
    // next: `Deno.env` outlives the module that read it.
    const module = await loadFunction<Module>('../revenuecat-webhook/index.ts', {
      SUPABASE_URL: harness.url,
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
      REVENUECAT_WEBHOOK_SECRET: SECRET,
      REVENUECAT_ENTITLEMENT: 'pro',
      REVENUECAT_API_KEY: '',
      REVENUECAT_IGNORE_SANDBOX: '',
      ...world.environment,
    });
    await run(module, harness);
  } finally {
    restore();
    await harness.stop();
  }
}

Deno.test('refuses a delivery with no shared secret, and one that gets it wrong', async () => {
  await withWorld({}, async (module, harness) => {
    const missing = await module.handleRevenueCatWebhook(delivery(purchase(), null));
    assertEquals(missing.status, 401);
    assertEquals(await missing.json(), { error: 'unauthorized' });

    const wrong = await module.handleRevenueCatWebhook(delivery(purchase(), 'guessed-secret'));
    assertEquals(wrong.status, 401);
    assertEquals(await wrong.json(), { error: 'unauthorized' });

    // A prefix of the real secret is still the wrong secret.
    const partial = await module.handleRevenueCatWebhook(delivery(purchase(), SECRET.slice(0, -1)));
    assertEquals(partial.status, 401);

    assertEquals(harness.requests.length, 0, 'a refused delivery must not touch the mirror');
  });
});

Deno.test('refuses a GET, and every delivery at all when no secret is configured', async () => {
  await withWorld({ environment: { REVENUECAT_WEBHOOK_SECRET: '' } }, async (module, harness) => {
    const read = await module.handleRevenueCatWebhook(
      new Request('http://localhost/revenuecat-webhook')
    );
    assertEquals(read.status, 405);
    assertEquals(await read.json(), { error: 'method_not_allowed' });

    const unconfigured = await module.handleRevenueCatWebhook(delivery(purchase()));
    assertEquals(unconfigured.status, 503);
    assertEquals(await unconfigured.json(), { error: 'not_configured' });

    assertEquals(harness.requests.length, 0);
  });
});

Deno.test('turns down a body that is not json, and one carrying no event', async () => {
  await withWorld({}, async (module, harness) => {
    const malformed = await module.handleRevenueCatWebhook(
      new Request('http://localhost/revenuecat-webhook', {
        method: 'POST',
        headers: { Authorization: `Bearer ${SECRET}` },
        body: 'not json at all',
      })
    );
    assertEquals(malformed.status, 400);
    assertEquals(await malformed.json(), { error: 'invalid_json' });

    const empty = await module.handleRevenueCatWebhook(delivery({ id: 'evt-typeless' }));
    assertEquals(empty.status, 400);
    assertEquals(await empty.json(), { error: 'missing_event' });

    assertEquals(harness.requests.length, 0);
  });
});

Deno.test('writes what an initial purchase says, and nothing it does not', async () => {
  await withWorld({}, async (module, harness) => {
    const event = purchase();
    const response = await module.handleRevenueCatWebhook(delivery(event));

    assertEquals(response.status, 200);
    assertEquals(await response.json(), { ok: true, status: 'active', user_id: LEARNER });

    const lookup = harness.requests[0];
    assertEquals(lookup.method, 'GET');
    assertEquals(
      decodeURIComponent(lookup.search),
      `?select=rc_event_id,last_event_at&user_id=eq.${LEARNER}`
    );

    const write = harness.requests[1];
    // supabase-js upserts as `on_conflict=user_id` with merge-duplicates.
    assertEquals(write.search, '?on_conflict=user_id');
    assertEquals(write.headers.prefer, 'resolution=merge-duplicates');

    const row = write.body as Row;
    assertEquals(row.user_id, LEARNER);
    assertEquals(row.rc_app_user_id, LEARNER);
    assertEquals(row.entitlement, 'pro');
    assertEquals(row.status, 'active');
    assertEquals(row.product_id, 'codeling_pro_monthly');
    assertEquals(row.store, 'APP_STORE');
    assertEquals(row.period_type, 'NORMAL');
    assertEquals(row.current_period_end, EXPIRES_AT);
    assertEquals(row.trial_end, null);
    assertEquals(row.will_renew, true);
    assertEquals(row.environment, 'PRODUCTION');
    assertEquals(row.rc_event_id, 'evt-initial');
    assertEquals(row.last_event_at, EVENT_AT);
    assertEquals(row.raw_event, event, 'the delivery is kept verbatim for support');
    assert(typeof row.updated_at === 'string', 'updated_at is stamped');
  });
});

Deno.test('reads a trial purchase as trialing, with the trial end filled in', async () => {
  await withWorld({}, async (module, harness) => {
    const response = await module.handleRevenueCatWebhook(
      delivery(purchase({ period_type: 'TRIAL' }))
    );

    assertEquals(await response.json(), { ok: true, status: 'trialing', user_id: LEARNER });
    const row = writes(harness)[0];
    assertEquals(row.status, 'trialing');
    assertEquals(row.trial_end, EXPIRES_AT);
    assertEquals(row.current_period_end, EXPIRES_AT);
    assertEquals(row.will_renew, true);
  });
});

Deno.test('drops a second delivery of an event it has already applied', async () => {
  await withWorld(
    { existing: [{ rc_event_id: 'evt-initial', last_event_at: EVENT_AT }] },
    async (module, harness) => {
      const response = await module.handleRevenueCatWebhook(delivery(purchase()));

      assertEquals(response.status, 200);
      assertEquals(await response.json(), { ok: true, ignored: 'duplicate_event' });
      assertEquals(writes(harness).length, 0, 'the row must be left exactly as it was');
    }
  );
});

Deno.test('never lets an event older than the applied one overwrite it', async () => {
  const applied = '2026-02-01T00:00:00.000Z';
  await withWorld(
    { existing: [{ rc_event_id: 'evt-renewal', last_event_at: applied }] },
    async (module, harness) => {
      const late = await module.handleRevenueCatWebhook(
        delivery(purchase({ id: 'evt-late', event_timestamp_ms: EVENT_MS }))
      );
      assertEquals(await late.json(), { ok: true, ignored: 'stale_event' });
      assertEquals(writes(harness).length, 0);

      // Only strictly older is stale: a second event stamped at the same
      // moment as the applied one still counts.
      const together = await module.handleRevenueCatWebhook(
        delivery(purchase({ id: 'evt-same-moment', event_timestamp_ms: Date.parse(applied) }))
      );
      assertEquals(await together.json(), { ok: true, status: 'active', user_id: LEARNER });
      assertEquals(writes(harness).length, 1);
    }
  );
});

Deno.test('leaves a cancellation entitled until its period ends, an expiration not', async () => {
  await withWorld({}, async (module, harness) => {
    const cancelled = await module.handleRevenueCatWebhook(
      delivery(purchase({ type: 'CANCELLATION', id: 'evt-cancel' }))
    );
    assertEquals(await cancelled.json(), { ok: true, status: 'active', user_id: LEARNER });
    assertEquals(writes(harness)[0].status, 'active');
    assertEquals(writes(harness)[0].will_renew, false, 'auto-renew is off from now on');

    // The same event once the paid period has run out — a refund, say.
    const refunded = await module.handleRevenueCatWebhook(
      delivery(purchase({ type: 'CANCELLATION', id: 'evt-refund', expiration_at_ms: ENDED_MS }))
    );
    assertEquals(await refunded.json(), { ok: true, status: 'cancelled', user_id: LEARNER });
    assertEquals(writes(harness)[1].status, 'cancelled');

    const expired = await module.handleRevenueCatWebhook(
      delivery(purchase({ type: 'EXPIRATION', id: 'evt-expire', expiration_at_ms: ENDED_MS }))
    );
    assertEquals(await expired.json(), { ok: true, status: 'expired', user_id: LEARNER });
    assertEquals(writes(harness)[2].status, 'expired');
    assertEquals(writes(harness)[2].will_renew, false);
  });
});

Deno.test('holds a billing issue in grace, since the retry window is still paid time', async () => {
  await withWorld({}, async (module, harness) => {
    const response = await module.handleRevenueCatWebhook(
      delivery(purchase({ type: 'BILLING_ISSUE', id: 'evt-billing' }))
    );

    assertEquals(await response.json(), { ok: true, status: 'grace', user_id: LEARNER });
    assertEquals(writes(harness)[0].will_renew, true, 'the store is still trying to charge');
  });
});

Deno.test('takes a pause only once the paid period it was asked for has run out', async () => {
  await withWorld({}, async (module, harness) => {
    const announced = await module.handleRevenueCatWebhook(
      delivery(purchase({ type: 'SUBSCRIPTION_PAUSED', id: 'evt-pause' }))
    );
    assertEquals(await announced.json(), { ok: true, status: 'active', user_id: LEARNER });
    assertEquals(writes(harness)[0].will_renew, false);

    const taken = await module.handleRevenueCatWebhook(
      delivery(
        purchase({ type: 'SUBSCRIPTION_PAUSED', id: 'evt-paused', expiration_at_ms: ENDED_MS })
      )
    );
    assertEquals(await taken.json(), { ok: true, status: 'paused', user_id: LEARNER });
    assertEquals(writes(harness)[1].status, 'paused');
  });
});

Deno.test('acknowledges an event that carries no status change without writing', async () => {
  await withWorld({}, async (module, harness) => {
    const unknown = await module.handleRevenueCatWebhook(
      delivery(purchase({ type: 'SUBSCRIBER_ALIAS', id: 'evt-alias' }))
    );
    assertEquals(unknown.status, 200, 'anything but 2xx and revenuecat retries it forever');
    assertEquals(await unknown.json(), { ok: true, ignored: 'no_status_change' });

    const elsewhere = await module.handleRevenueCatWebhook(
      delivery(purchase({ id: 'evt-other', entitlement_ids: ['coach'] }))
    );
    assertEquals(elsewhere.status, 200);
    assertEquals(await elsewhere.json(), { ok: true, ignored: 'other_entitlement' });

    // Older deliveries name a single entitlement instead of a list.
    const singular = await module.handleRevenueCatWebhook(
      delivery(purchase({ id: 'evt-singular', entitlement_ids: null, entitlement_id: 'coach' }))
    );
    assertEquals(await singular.json(), { ok: true, ignored: 'other_entitlement' });

    const ours = await module.handleRevenueCatWebhook(
      delivery(purchase({ id: 'evt-singular-pro', entitlement_ids: null, entitlement_id: 'pro' }))
    );
    assertEquals(await ours.json(), { ok: true, status: 'active', user_id: LEARNER });

    assertEquals(writes(harness).length, 1, 'only the delivery about our entitlement is kept');
  });
});

Deno.test('counts a sandbox purchase, which is what app store review makes', async () => {
  await withWorld({}, async (module, harness) => {
    const response = await module.handleRevenueCatWebhook(
      delivery(purchase({ environment: 'SANDBOX' }))
    );

    assertEquals(await response.json(), { ok: true, status: 'active', user_id: LEARNER });
    assertEquals(writes(harness)[0].environment, 'SANDBOX');
  });
});

Deno.test('ignores one where the project counts production purchases only', async () => {
  await withWorld(
    { environment: { REVENUECAT_IGNORE_SANDBOX: 'true' } },
    async (module, harness) => {
      const sandbox = await module.handleRevenueCatWebhook(
        delivery(purchase({ environment: 'SANDBOX' }))
      );
      assertEquals(sandbox.status, 200);
      assertEquals(await sandbox.json(), { ok: true, ignored: 'sandbox_event' });
      assertEquals(harness.requests.length, 0, 'it is dropped before the mirror is even read');

      // The same project still takes production purchases.
      const production = await module.handleRevenueCatWebhook(delivery(purchase()));
      assertEquals(await production.json(), { ok: true, status: 'active', user_id: LEARNER });
      assertEquals(writes(harness)[0].environment, 'PRODUCTION');
    }
  );
});

Deno.test('ignores an app user id that is not a supabase user, and finds one that is', async () => {
  await withWorld({}, async (module, harness) => {
    const anonymous = await module.handleRevenueCatWebhook(
      delivery(purchase({ app_user_id: '$RCAnonymousID:8f3a1c', aliases: ['not-a-uuid'] }))
    );
    assertEquals(anonymous.status, 200);
    assertEquals(await anonymous.json(), { ok: true, ignored: 'anonymous_app_user_id' });
    assertEquals(harness.requests.length, 0);

    // Once the learner signs in, the same purchase arrives with their id as an
    // alias, and that is the row to write.
    const aliased = await module.handleRevenueCatWebhook(
      delivery(
        purchase({ id: 'evt-aliased', app_user_id: '$RCAnonymousID:8f3a1c', aliases: [LEARNER] })
      )
    );
    assertEquals(await aliased.json(), { ok: true, status: 'active', user_id: LEARNER });

    const row = writes(harness)[0];
    assertEquals(row.user_id, LEARNER);
    assertEquals(row.rc_app_user_id, '$RCAnonymousID:8f3a1c', "revenuecat's own id is kept");
  });
});

Deno.test(
  'moves the entitlement on a transfer: the winner granted, the loser revoked',
  async () => {
    await withWorld(
      {
        environment: { REVENUECAT_API_KEY: 'sk_test' },
        source: [
          {
            product_id: 'codeling_pro_annual',
            store: 'APP_STORE',
            status: 'active',
            period_type: 'NORMAL',
            current_period_end: EXPIRES_AT,
            trial_end: null,
            will_renew: true,
            environment: 'PRODUCTION',
          },
        ],
        revenuecat: {
          [`GET ${REVENUECAT}/v1/subscribers/*`]: {
            body: {
              subscriber: {
                entitlements: {
                  pro: {
                    expires_date: '2099-01-01T00:00:00Z',
                    product_identifier: 'codeling_pro_monthly',
                  },
                },
                subscriptions: { codeling_pro_monthly: { period_type: 'normal' } },
              },
            },
          },
        },
      },
      async (module, harness) => {
        const response = await module.handleRevenueCatWebhook(delivery(transfer()));

        assertEquals(response.status, 200);
        assertEquals(await response.json(), { ok: true, handled: 'transfer', from: 1, to: 1 });

        // A transfer says only which ids moved, so the winner's state comes from
        // the store rather than from the event.
        assertEquals(harness.outbound.length, 1);
        assertEquals(harness.outbound[0].path, `${REVENUECAT}/v1/subscribers/${LEARNER}`);
        assertEquals(harness.outbound[0].headers.authorization, 'Bearer sk_test');

        const granted = writes(harness)[0];
        assertEquals(granted.user_id, LEARNER);
        assertEquals(granted.entitlement, 'pro');
        assertEquals(granted.status, 'active');
        assertEquals(granted.product_id, 'codeling_pro_monthly');
        assertEquals(granted.current_period_end, '2099-01-01T00:00:00Z');
        assertEquals(granted.trial_end, null);
        assertEquals(granted.will_renew, true);
        assertEquals(granted.environment, 'PRODUCTION');
        assertEquals(granted.store, 'APP_STORE', 'the store comes from the row being moved');
        assertEquals(granted.rc_event_id, 'evt-transfer');
        assertEquals(granted.last_event_at, EVENT_AT);

        const revoke = revokes(harness)[0];
        assertEquals(decodeURIComponent(revoke.search), `?user_id=in.(${PREVIOUS_OWNER})`);
        assertEquals((revoke.body as Row).status, 'expired');
        assertEquals((revoke.body as Row).will_renew, false);
        assertEquals((revoke.body as Row).rc_event_id, 'evt-transfer');

        // Granting first is the whole point: a failure between the two leaves the
        // customer entitled twice over rather than not at all.
        const order = harness.requests.map((request) => request.method);
        assert(
          order.indexOf('POST') < order.indexOf('PATCH'),
          'the grant must be committed before the revocation'
        );
      }
    );
  }
);

Deno.test('moves what the mirror already holds when no api key is configured', async () => {
  await withWorld(
    {
      source: [
        {
          product_id: 'codeling_pro_annual',
          store: 'PLAY_STORE',
          status: 'trialing',
          period_type: 'TRIAL',
          current_period_end: EXPIRES_AT,
          trial_end: EXPIRES_AT,
          will_renew: true,
          environment: 'PRODUCTION',
        },
      ],
    },
    async (module, harness) => {
      const response = await module.handleRevenueCatWebhook(delivery(transfer()));

      assertEquals(await response.json(), { ok: true, handled: 'transfer', from: 1, to: 1 });
      assertEquals(harness.outbound.length, 0, 'with no key there is nothing to ask');

      const granted = writes(harness)[0];
      assertEquals(granted.user_id, LEARNER);
      assertEquals(granted.status, 'trialing');
      assertEquals(granted.product_id, 'codeling_pro_annual');
      assertEquals(granted.store, 'PLAY_STORE');
      assertEquals(granted.period_type, 'TRIAL');
      assertEquals(granted.trial_end, EXPIRES_AT);
      assertEquals(granted.will_renew, true);
      assertEquals(revokes(harness).length, 1);
    }
  );
});

Deno.test('leaves both accounts alone when nothing can say what the winner owns', async () => {
  await withWorld({ source: [] }, async (module, harness) => {
    const response = await module.handleRevenueCatWebhook(delivery(transfer()));

    assertEquals(response.status, 200);
    assertEquals(await response.json(), { ok: true, ignored: 'transfer_unresolvable' });
    assertEquals(writes(harness).length, 0);
    assertEquals(revokes(harness).length, 0, 'the paying account keeps what it has');
  });
});

Deno.test('revokes the source of a transfer whose target has not signed in yet', async () => {
  await withWorld(
    {
      source: [
        {
          product_id: 'codeling_pro_annual',
          store: 'APP_STORE',
          status: 'active',
          period_type: 'NORMAL',
          current_period_end: EXPIRES_AT,
          trial_end: null,
          will_renew: true,
          environment: 'PRODUCTION',
        },
      ],
    },
    async (module, harness) => {
      const response = await module.handleRevenueCatWebhook(
        delivery(transfer({ transferred_to: ['$RCAnonymousID:8f3a1c'] }))
      );

      assertEquals(await response.json(), { ok: true, handled: 'transfer', from: 1, to: 0 });
      assertEquals(writes(harness).length, 0, 'there is no supabase account to grant');
      assertEquals(revokes(harness).length, 1);
      assertEquals((revokes(harness)[0].body as Row).status, 'expired');
    }
  );
});

Deno.test('keeps the source entitled when the account it moves to no longer exists', async () => {
  await withWorld(
    {
      source: [
        {
          product_id: 'codeling_pro_annual',
          store: 'APP_STORE',
          status: 'active',
          period_type: 'NORMAL',
          current_period_end: EXPIRES_AT,
          trial_end: null,
          will_renew: true,
          environment: 'PRODUCTION',
        },
      ],
      upsert: {
        status: 409,
        body: {
          code: '23503',
          message: 'insert or update on table "subscriptions" violates foreign key constraint',
          details: null,
          hint: null,
        },
      },
    },
    async (module, harness) => {
      const response = await module.handleRevenueCatWebhook(delivery(transfer()));

      assertEquals(await response.json(), { ok: true, handled: 'transfer', from: 1, to: 0 });
      assertEquals(revokes(harness).length, 0, 'nothing was granted, so nothing may be taken away');
    }
  );
});

Deno.test('asks for a retry, and revokes nothing, when a transfer grant fails', async () => {
  await withWorld(
    {
      source: [
        {
          product_id: 'codeling_pro_annual',
          store: 'APP_STORE',
          status: 'active',
          period_type: 'NORMAL',
          current_period_end: EXPIRES_AT,
          trial_end: null,
          will_renew: true,
          environment: 'PRODUCTION',
        },
      ],
      upsert: { status: 500, body: { message: 'upstream is down' } },
    },
    async (module, harness) => {
      const response = await module.handleRevenueCatWebhook(delivery(transfer()));

      assertEquals(response.status, 500);
      assertEquals(await response.json(), { error: 'persist_failed' });
      assertEquals(revokes(harness).length, 0);
    }
  );
});

Deno.test('drops a retried transfer rather than revoking a re-granted account', async () => {
  await withWorld(
    { existing: [{ rc_event_id: 'evt-transfer', last_event_at: EVENT_AT }] },
    async (module, harness) => {
      const response = await module.handleRevenueCatWebhook(delivery(transfer()));

      assertEquals(await response.json(), { ok: true, ignored: 'duplicate_event' });
      assertEquals(writes(harness).length, 0);
      assertEquals(revokes(harness).length, 0);
    }
  );
});

Deno.test(
  'moves the mirror\u2019s subscription when the store says the winner owns nothing',
  async () => {
    await withWorld(
      {
        environment: { REVENUECAT_API_KEY: 'sk_test' },
        source: [
          {
            product_id: 'codeling_pro_annual',
            store: 'APP_STORE',
            status: 'active',
            period_type: 'NORMAL',
            current_period_end: EXPIRES_AT,
            trial_end: null,
            will_renew: true,
            environment: 'PRODUCTION',
          },
        ],
        // The subscriber exists but carries no entitlement, which is what a read
        // taken before the transfer has propagated looks like.
        revenuecat: {
          [`GET ${REVENUECAT}/v1/subscribers/*`]: {
            body: { subscriber: { entitlements: {}, subscriptions: {} } },
          },
        },
      },
      async (module, harness) => {
        const response = await module.handleRevenueCatWebhook(delivery(transfer()));

        assertEquals(await response.json(), { ok: true, handled: 'transfer', from: 1, to: 1 });

        // The read lost the race, not the customer: what the mirror still shows
        // on the losing account is what moves, and only then is it revoked there.
        const granted = writes(harness)[0];
        assertEquals(granted.status, 'active');
        assertEquals(granted.product_id, 'codeling_pro_annual');
        assertEquals(granted.current_period_end, EXPIRES_AT);
        assertEquals(granted.will_renew, true);
        assertEquals((revokes(harness)[0].body as Row).status, 'expired');
      }
    );
  }
);

Deno.test('leaves both accounts alone when the winner is genuinely expired', async () => {
  await withWorld(
    {
      environment: { REVENUECAT_API_KEY: 'sk_test' },
      // The losing account has nothing live either, so there is nothing to move
      // and nothing worth taking away.
      source: [
        {
          product_id: 'codeling_pro_annual',
          store: 'APP_STORE',
          status: 'expired',
          period_type: 'NORMAL',
          current_period_end: '2020-01-01T00:00:00.000Z',
          trial_end: null,
          will_renew: false,
          environment: 'PRODUCTION',
        },
      ],
      revenuecat: {
        [`GET ${REVENUECAT}/v1/subscribers/*`]: {
          body: { subscriber: { entitlements: {}, subscriptions: {} } },
        },
      },
    },
    async (module, harness) => {
      const response = await module.handleRevenueCatWebhook(delivery(transfer()));

      assertEquals(await response.json(), { ok: true, handled: 'transfer', from: 1, to: 0 });
      assertEquals(writes(harness)[0].status, 'expired');
      // Nothing moved, so nothing is revoked: a revoke here would be the only
      // write that could take a live subscription away by accident.
      assertEquals(revokes(harness).length, 0);
    }
  );
});

Deno.test('grants from the mirror when the store cannot be reached at all', async () => {
  await withWorld(
    {
      environment: { REVENUECAT_API_KEY: 'sk_test' },
      source: [
        {
          product_id: 'codeling_pro_annual',
          store: 'APP_STORE',
          status: 'active',
          period_type: 'NORMAL',
          current_period_end: EXPIRES_AT,
          trial_end: null,
          will_renew: true,
          environment: 'PRODUCTION',
        },
      ],
      revenuecat: { [`GET ${REVENUECAT}/v1/subscribers/*`]: { status: 500 } },
    },
    async (module, harness) => {
      const response = await module.handleRevenueCatWebhook(delivery(transfer()));

      assertEquals(await response.json(), { ok: true, handled: 'transfer', from: 1, to: 1 });
      assertEquals(writes(harness)[0].status, 'active');
      assertEquals(writes(harness)[0].product_id, 'codeling_pro_annual');
    }
  );
});

Deno.test('asks revenuecat to try again when the mirror cannot be written', async () => {
  await withWorld(
    { upsert: { status: 500, body: { message: 'upstream is down' } } },
    async (module) => {
      const response = await module.handleRevenueCatWebhook(delivery(purchase()));

      assertEquals(response.status, 500);
      assertEquals(await response.json(), { error: 'persist_failed' });
    }
  );
});

Deno.test(
  'accepts, and stops retrying, a purchase whose learner deleted their account',
  async () => {
    await withWorld(
      {
        upsert: {
          status: 409,
          body: {
            code: '23503',
            message: 'insert or update on table "subscriptions" violates foreign key constraint',
            details: null,
            hint: null,
          },
        },
      },
      async (module) => {
        const response = await module.handleRevenueCatWebhook(delivery(purchase()));

        assertEquals(response.status, 200);
        assertEquals(await response.json(), { ok: true, ignored: 'user_deleted' });
      }
    );
  }
);
