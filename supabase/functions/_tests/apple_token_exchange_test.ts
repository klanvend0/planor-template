/**
 * `apple-token-exchange`, run for real.
 *
 * Every test drives the exported handler against the Supabase stub, so what is
 * asserted is the row PostgREST would have been sent and the form Apple would
 * have received, not a hand-written idea of either. Apple's token endpoint is
 * stubbed at `fetch`, which is the only other host the function talks to.
 *
 * @module supabase/functions/_tests/apple_token_exchange_test
 */

import {
  assert,
  assertEquals,
  loadFunction,
  startSupabaseStub,
  stubFetch,
  type RecordedRequest,
  type Reply,
} from './harness.ts';

const LEARNER = '11111111-1111-1111-1111-111111111111';
const OTHER_LEARNER = '22222222-2222-2222-2222-222222222222';

/**
 * Apple's `sub` is per-app and per-user; it is what an identity row stores.
 *
 * The three are deliberately different lengths. Base64 of the payload they sit
 * in lands on a different multiple-of-four boundary for each, so between them
 * the id_tokens the tests decode cover a payload that needed two pad characters
 * put back, one that needed one, and one that needed none.
 */
const APPLE_SUB = '000123.9f8e7d6c5b4af.1200';
const LINKED_APPLE_SUB = '000456.3c2b1a0f9e8d.1600';
const OTHER_APPLE_SUB = '000987.1a2b3c4d5e6f.080';

const APPLE = 'https://appleid.apple.com';
const CLIENT_ID = 'com.planor.codeling';
const CLIENT_SECRET = 'signed.client.secret';
const REFRESH_TOKEN = 'rt_apple_9d1c';

/** Expo web reads these responses cross-origin, so every one of them needs this. */
const ANY_ORIGIN = '*';

type Module = { handleAppleTokenExchange: (request: Request) => Promise<Response> };
type Harness = Awaited<ReturnType<typeof startSupabaseStub>>;
type Row = Record<string, unknown>;

type World = {
  /** The GoTrue user behind the caller's token; `status` stands in for a bad one. */
  user?: Row;
  userStatus?: number;
  /** What Apple's token endpoint answers, replacing the successful default. */
  apple?: Parameters<typeof stubFetch>[1];
  /** What PostgREST answers the upsert with, for the failure path. */
  upsert?: Reply;
  environment?: Record<string, string>;
};

/**
 * An id_token as Apple sends one: three dots' worth of base64url, of which the
 * function only ever reads the middle. A JWT travels with its `=` padding
 * stripped, so the fixture strips it too and the claims come back off whatever
 * length that leaves.
 */
function idToken(sub: string): string {
  const payload = btoa(JSON.stringify({ iss: APPLE, aud: CLIENT_ID, sub }))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `eyJhbGciOiJSUzI1NiJ9.${payload}.signature`;
}

function learner(overrides: Row = {}): Row {
  return {
    id: LEARNER,
    aud: 'authenticated',
    email: 'learner@example.com',
    identities: [{ provider: 'apple', id: APPLE_SUB, user_id: LEARNER }],
    ...overrides,
  };
}

function appleTokens(overrides: Row = {}): Row {
  return {
    access_token: 'at_apple',
    expires_in: 3600,
    id_token: idToken(APPLE_SUB),
    refresh_token: REFRESH_TOKEN,
    token_type: 'Bearer',
    ...overrides,
  };
}

/** A string body is passed through, so a test can send something that is not JSON. */
function post(body: unknown = { authorizationCode: 'c_abc123' }, token = 'learner-jwt'): Request {
  return withHeaders({ Authorization: `Bearer ${token}` }, body);
}

/** Sends the headers verbatim, for the callers whose credential is not a Bearer token. */
function withHeaders(
  headers: Record<string, string>,
  body: unknown = { authorizationCode: 'c_abc123' }
): Request {
  return new Request('http://localhost/apple-token-exchange', {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function anonymous(body: unknown = { authorizationCode: 'c_abc123' }): Request {
  return withHeaders({}, body);
}

/** Rows the function sent to `apple_credentials`, in the order it sent them. */
function writes(harness: Harness): Row[] {
  return harness.requests
    .filter((request) => request.path === '/rest/v1/apple_credentials')
    .map((request) => request.body as Row);
}

/** Every time the function asked GoTrue who the caller is. */
function lookups(harness: Harness): RecordedRequest[] {
  return harness.requests.filter((request) => request.path === '/auth/v1/user');
}

function exchange(harness: Harness): RecordedRequest | undefined {
  return harness.outbound.find((request) => request.path === `${APPLE}/auth/token`);
}

/** Apple's endpoint takes a form, so the recorded body is a string, not JSON. */
function form(request: RecordedRequest): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(String(request.body)));
}

async function withWorld(world: World, run: (module: Module, harness: Harness) => Promise<void>) {
  const harness = await startSupabaseStub({
    'GET /auth/v1/user': world.userStatus
      ? { status: world.userStatus, body: { message: 'invalid claim: missing sub' } }
      : { body: world.user ?? learner() },
    'POST /rest/v1/apple_credentials': world.upsert ?? { status: 201, body: [] },
  });
  const restore = stubFetch(
    harness,
    world.apple ?? { [`POST ${APPLE}/auth/token`]: { body: appleTokens() } }
  );
  try {
    const module = await loadFunction<Module>('../apple-token-exchange/index.ts', {
      SUPABASE_URL: harness.url,
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
      APPLE_CLIENT_ID: CLIENT_ID,
      APPLE_CLIENT_SECRET: CLIENT_SECRET,
      ...world.environment,
    });
    await run(module, harness);
  } finally {
    restore();
    await harness.stop();
  }
}

Deno.test('exchanges the code with Apple and files the refresh token for the caller', async () => {
  await withWorld({}, async (module, harness) => {
    const response = await module.handleAppleTokenExchange(post());

    assertEquals(response.status, 200);
    assertEquals(await response.json(), { ok: true });
    assertEquals(response.headers.get('access-control-allow-origin'), ANY_ORIGIN);

    const sent = exchange(harness);
    assert(sent, 'apple was never asked to exchange the code');
    assertEquals(sent.method, 'POST');
    assert(
      sent.headers['content-type']?.startsWith('application/x-www-form-urlencoded'),
      `apple was sent ${sent.headers['content-type']}, which its token endpoint does not take`
    );
    // Field by field, so reordering the form leaves the suite green but a wrong
    // or missing value does not.
    const fields = form(sent);
    assertEquals(fields.client_id, CLIENT_ID);
    assertEquals(fields.client_secret, CLIENT_SECRET);
    assertEquals(fields.code, 'c_abc123');
    assertEquals(fields.grant_type, 'authorization_code');
    assertEquals(Object.keys(fields).sort(), ['client_id', 'client_secret', 'code', 'grant_type']);

    const write = harness.requests.find((request) => request.path === '/rest/v1/apple_credentials');
    // supabase-js upserts as `on_conflict=user_id` with merge-duplicates, so a
    // second sign-in replaces the token rather than failing on the primary key.
    assertEquals(write?.search, '?on_conflict=user_id');
    assertEquals(write?.headers.prefer, 'resolution=merge-duplicates');

    const row = write?.body as Row;
    assertEquals(row.user_id, LEARNER);
    assertEquals(row.refresh_token, REFRESH_TOKEN);
    assert(
      typeof row.updated_at === 'string' && !Number.isNaN(Date.parse(row.updated_at)),
      `updated_at was ${JSON.stringify(row.updated_at)}, which timestamptz will not take`
    );
    // Nothing but the three columns the table has, or PostgREST would reject it.
    assertEquals(Object.keys(row).sort(), ['refresh_token', 'updated_at', 'user_id']);
  });
});

Deno.test('picks the Apple identity out of a learner who has linked other providers', async () => {
  await withWorld(
    {
      // Signed up with Google, added Apple later: the Apple identity is not the
      // first one, and the Google one carries an id that is not an Apple sub.
      user: learner({
        identities: [
          { provider: 'google', id: 'g-987654321', user_id: LEARNER },
          { provider: 'apple', id: LINKED_APPLE_SUB, user_id: LEARNER },
        ],
      }),
      apple: {
        [`POST ${APPLE}/auth/token`]: {
          body: appleTokens({ id_token: idToken(LINKED_APPLE_SUB) }),
        },
      },
    },
    async (module, harness) => {
      const response = await module.handleAppleTokenExchange(post());

      assertEquals(response.status, 200);
      assertEquals(await response.json(), { ok: true });

      const rows = writes(harness);
      assertEquals(rows.length, 1);
      assertEquals(rows[0].user_id, LEARNER);
      assertEquals(rows[0].refresh_token, REFRESH_TOKEN);
    }
  );
});

Deno.test('refuses a credential that is missing, not a Bearer token, or not a user', async () => {
  await withWorld({}, async (module, harness) => {
    const missing = await module.handleAppleTokenExchange(anonymous());

    assertEquals(missing.status, 401);
    assertEquals(await missing.json(), { error: 'unauthorized' });
    assertEquals(exchange(harness), undefined);
    assertEquals(writes(harness), []);
  });

  await withWorld({}, async (module, harness) => {
    // A scheme the function does not accept: the value behind it is a token
    // GoTrue would honour, so only the scheme check can turn this away.
    const wrongScheme = await module.handleAppleTokenExchange(
      withHeaders({ Authorization: 'Basic learner-jwt' })
    );

    assertEquals(wrongScheme.status, 401);
    assertEquals(await wrongScheme.json(), { error: 'unauthorized' });
    assertEquals(wrongScheme.headers.get('access-control-allow-origin'), ANY_ORIGIN);
    // Refused outright, rather than handed to GoTrue to see what it makes of it.
    assertEquals(lookups(harness), []);
    assertEquals(exchange(harness), undefined);
    assertEquals(writes(harness), []);
  });

  await withWorld({ userStatus: 401 }, async (module, harness) => {
    const rejected = await module.handleAppleTokenExchange(post());

    assertEquals(rejected.status, 401);
    assertEquals(await rejected.json(), { error: 'unauthorized' });
    assertEquals(exchange(harness), undefined);
    assertEquals(writes(harness), []);
  });
});

Deno.test('refuses a request that carries no authorization code', async () => {
  await withWorld({}, async (module, harness) => {
    const empty = await module.handleAppleTokenExchange(post({}));

    assertEquals(empty.status, 400);
    assertEquals(await empty.json(), { error: 'code_required' });

    const blank = await module.handleAppleTokenExchange(post({ authorizationCode: '' }));
    assertEquals(blank.status, 400);
    assertEquals(await blank.json(), { error: 'code_required' });

    // A device that sent the wrong shape is refused rather than having its
    // value coerced into a code Apple would reject anyway.
    const wrongType = await module.handleAppleTokenExchange(post({ authorizationCode: 12345 }));
    assertEquals(wrongType.status, 400);
    assertEquals(await wrongType.json(), { error: 'code_required' });

    const notJson = await module.handleAppleTokenExchange(post('not json at all'));
    assertEquals(notJson.status, 400);
    assertEquals(await notJson.json(), { error: 'invalid_json' });

    assertEquals(exchange(harness), undefined);
    assertEquals(writes(harness), []);
  });
});

Deno.test('reports Apple rejecting the code, and stores nothing', async () => {
  await withWorld(
    {
      apple: {
        [`POST ${APPLE}/auth/token`]: {
          status: 400,
          body: { error: 'invalid_grant', error_description: 'the code has expired' },
        },
      },
    },
    async (module, harness) => {
      const response = await module.handleAppleTokenExchange(post());

      assertEquals(response.status, 502);
      // Apple's own wording never reaches the device; it only goes to the log.
      assertEquals(await response.json(), { error: 'exchange_failed' });
      assertEquals(response.headers.get('access-control-allow-origin'), ANY_ORIGIN);
      assert(exchange(harness), 'the code was never offered to apple');
      assertEquals(writes(harness), []);
    }
  );
});

Deno.test('says so when Apple answers without a refresh token, and stores nothing', async () => {
  await withWorld(
    {
      // Apple withholds the refresh token when the code has already been spent.
      apple: {
        [`POST ${APPLE}/auth/token`]: { body: appleTokens({ refresh_token: undefined }) },
      },
    },
    async (module, harness) => {
      const response = await module.handleAppleTokenExchange(post());

      assertEquals(response.status, 502);
      assertEquals(await response.json(), { error: 'no_refresh_token' });
      assert(exchange(harness), 'the code was never offered to apple');
      assertEquals(writes(harness), []);
    }
  );
});

Deno.test('files the token under the caller from the token, never a body user id', async () => {
  await withWorld({}, async (module, harness) => {
    const response = await module.handleAppleTokenExchange(
      post({
        authorizationCode: 'c_abc123',
        user_id: OTHER_LEARNER,
        userId: OTHER_LEARNER,
        refresh_token: 'rt_planted_by_the_caller',
      })
    );

    assertEquals(response.status, 200);

    const rows = writes(harness);
    assertEquals(rows.length, 1);
    assertEquals(rows[0].user_id, LEARNER);
    assertEquals(rows[0].refresh_token, REFRESH_TOKEN);

    // The id can only have come from the token, because the token is the only
    // thing the function asked GoTrue about.
    assertEquals(lookups(harness)[0]?.headers.authorization, 'Bearer learner-jwt');

    // Not one byte of the caller's suggestion left the function, in any request.
    const traffic = JSON.stringify([...harness.requests, ...harness.outbound]);
    assertEquals(traffic.includes(OTHER_LEARNER), false);
    assertEquals(traffic.includes('rt_planted_by_the_caller'), false);
  });
});

Deno.test("refuses an authorization code that belongs to another learner's Apple id", async () => {
  await withWorld(
    // The caller holds a valid token of their own; only the code is someone else's.
    {
      apple: {
        [`POST ${APPLE}/auth/token`]: { body: appleTokens({ id_token: idToken(OTHER_APPLE_SUB) }) },
      },
    },
    async (module, harness) => {
      const response = await module.handleAppleTokenExchange(post());

      assertEquals(response.status, 403);
      assertEquals(await response.json(), { error: 'identity_mismatch' });
      // Storing it would hand the caller the means to revoke the other
      // learner's Apple sign-in when they later delete their own account.
      assertEquals(writes(harness), []);
    }
  );
});

Deno.test(
  'refuses a caller who has no Apple identity, whatever id their other identities carry',
  async () => {
    await withWorld(
      // The id is the Apple sub itself, so a comparison that ignores which
      // provider the identity came from would let this caller through.
      { user: learner({ identities: [{ provider: 'email', id: APPLE_SUB, user_id: LEARNER }] }) },
      async (module, harness) => {
        const response = await module.handleAppleTokenExchange(post());

        assertEquals(response.status, 403);
        assertEquals(await response.json(), { error: 'identity_mismatch' });
        assertEquals(writes(harness), []);
      }
    );

    await withWorld({ user: learner({ identities: [] }) }, async (module, harness) => {
      const response = await module.handleAppleTokenExchange(post());

      assertEquals(response.status, 403);
      assertEquals(await response.json(), { error: 'identity_mismatch' });
      assertEquals(writes(harness), []);
    });
  }
);

Deno.test('refuses a code whose claims it cannot read', async () => {
  await withWorld(
    { apple: { [`POST ${APPLE}/auth/token`]: { body: appleTokens({ id_token: undefined }) } } },
    async (module, harness) => {
      const response = await module.handleAppleTokenExchange(post());

      assertEquals(response.status, 403);
      assertEquals(await response.json(), { error: 'identity_mismatch' });
      assertEquals(writes(harness), []);
    }
  );

  await withWorld(
    { apple: { [`POST ${APPLE}/auth/token`]: { body: appleTokens({ id_token: 'not.a.jwt' }) } } },
    async (module, harness) => {
      const response = await module.handleAppleTokenExchange(post());

      assertEquals(response.status, 403);
      assertEquals(await response.json(), { error: 'identity_mismatch' });
      assertEquals(writes(harness), []);
    }
  );

  await withWorld(
    // Readable base64, but no `sub` to compare the caller's identity against.
    {
      apple: {
        [`POST ${APPLE}/auth/token`]: {
          body: appleTokens({ id_token: `eyJhbGciOiJSUzI1NiJ9.${btoa('{"iss":"x"}')}.signature` }),
        },
      },
    },
    async (module, harness) => {
      const response = await module.handleAppleTokenExchange(post());

      assertEquals(response.status, 403);
      assertEquals(await response.json(), { error: 'identity_mismatch' });
      assertEquals(writes(harness), []);
    }
  );
});

Deno.test('tells the device the token was not filed when the write fails', async () => {
  await withWorld(
    { upsert: { status: 500, body: { message: 'upstream is down' } } },
    async (module, harness) => {
      const response = await module.handleAppleTokenExchange(post());

      assertEquals(response.status, 500);
      assertEquals(await response.json(), { error: 'persist_failed' });
      // The 500 has to be the write failing, not something giving up earlier.
      assert(exchange(harness), 'the code was never offered to apple');
      assertEquals(writes(harness).length, 1);
    }
  );
});

Deno.test('stands down when the Apple secrets are not configured', async () => {
  await withWorld({ environment: { APPLE_CLIENT_SECRET: '' } }, async (module, harness) => {
    const response = await module.handleAppleTokenExchange(post());

    assertEquals(response.status, 503);
    assertEquals(await response.json(), { error: 'not_configured' });
    assertEquals(exchange(harness), undefined);
    assertEquals(writes(harness), []);
  });

  await withWorld({ environment: { APPLE_CLIENT_ID: '' } }, async (module, harness) => {
    const response = await module.handleAppleTokenExchange(post());

    assertEquals(response.status, 503);
    assertEquals(await response.json(), { error: 'not_configured' });
    // Apple would refuse an empty client_id anyway, so it is never asked.
    assertEquals(exchange(harness), undefined);
    assertEquals(writes(harness), []);
  });
});

Deno.test('answers the browser preflight and turns away any method but POST', async () => {
  await withWorld({}, async (module, harness) => {
    const preflight = await module.handleAppleTokenExchange(
      new Request('http://localhost/apple-token-exchange', { method: 'OPTIONS' })
    );

    assertEquals(preflight.status, 200);
    assertEquals(preflight.headers.get('access-control-allow-methods'), 'POST, OPTIONS');
    assertEquals(preflight.headers.get('access-control-allow-origin'), ANY_ORIGIN);

    const read = await module.handleAppleTokenExchange(
      new Request('http://localhost/apple-token-exchange', { method: 'GET' })
    );

    assertEquals(read.status, 405);
    assertEquals(await read.json(), { error: 'method_not_allowed' });
    assertEquals(read.headers.get('access-control-allow-origin'), ANY_ORIGIN);
    assertEquals(writes(harness), []);
  });
});
