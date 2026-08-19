/**
 * `delete-account`, run for real.
 *
 * This is the one function that has to destroy something: App Store Review
 * 5.1.1(v) is not satisfied by a handler that answers `ok` while the row lives
 * on. So no test here trusts the response body on its own — each one drives the
 * exported handler and then asserts on the admin call that reached the stub,
 * and on the revoke request that reached Apple.
 *
 * @module supabase/functions/_tests/delete_account_test
 */

import { assert, assertEquals, loadFunction, startSupabaseStub, stubFetch } from './harness.ts';

const LEARNER = '11111111-1111-1111-1111-111111111111';
const APPLE = 'https://appleid.apple.com';
const REVOKE = `POST ${APPLE}/auth/revoke`;
const CLIENT_ID = 'com.planor.codeling';
const CLIENT_SECRET = 'signed-client-secret';
const REFRESH_TOKEN = 'apple-refresh-token';

/** supabase-js sends the admin delete to `/auth/v1/admin/users/{id}`. */
const DELETE_USER = 'DELETE /auth/v1/admin/users/*';

type Module = { handleDeleteAccount: (request: Request) => Promise<Response> };
type Harness = Awaited<ReturnType<typeof startSupabaseStub>>;
type Routes = Parameters<typeof startSupabaseStub>[0];
type Route = Routes[string];

type World = {
  /** What the refresh-token lookup finds. Default: a learner with no Apple row. */
  credential?: Route;
  /** What GoTrue answers the admin delete with. */
  deleted?: Route;
  /** Hosts the stub does not serve — only ever Apple here. */
  apple?: Parameters<typeof stubFetch>[1];
  /** Overrides for the default routes, for the paths where auth itself fails. */
  routes?: Routes;
  environment?: Record<string, string>;
};

function post(token: string | null = 'learner-jwt'): Request {
  return new Request('http://localhost/delete-account', {
    method: 'POST',
    headers: token === null ? {} : { Authorization: `Bearer ${token}` },
  });
}

/** The admin delete, if the function sent one. */
function deletion(harness: Harness) {
  return harness.requests.find((request) => request.method === 'DELETE');
}

async function withWorld(
  world: World,
  run: (module: Module, harness: Harness) => Promise<void>
): Promise<void> {
  const harness = await startSupabaseStub({
    'GET /auth/v1/user': { body: { id: LEARNER, aud: 'authenticated', email: 'a@example.com' } },
    'GET /rest/v1/apple_credentials': world.credential ?? { body: [] },
    [DELETE_USER]: world.deleted ?? { body: { id: LEARNER } },
    ...world.routes,
  });
  const restore = stubFetch(harness, world.apple ?? {});
  try {
    const module = await loadFunction<Module>('../delete-account/index.ts', {
      SUPABASE_URL: harness.url,
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
      // Always spelled out: the function reads these once at import, and an
      // omitted key would leave the previous test's value in the environment.
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

Deno.test('refuses a caller without a token, and touches nothing at all', async () => {
  await withWorld({}, async (module, harness) => {
    const response = await module.handleDeleteAccount(post(null));
    assertEquals(response.status, 401);
    assertEquals(await response.json(), { error: 'unauthorized' });
    assertEquals(harness.requests.length, 0, 'an anonymous caller should reach no backend at all');
  });
});

Deno.test('refuses a token the auth server does not recognise', async () => {
  await withWorld(
    { routes: { 'GET /auth/v1/user': { status: 401, body: { message: 'invalid jwt' } } } },
    async (module, harness) => {
      const response = await module.handleDeleteAccount(post('forged-jwt'));
      assertEquals(response.status, 401);
      assertEquals(await response.json(), { error: 'unauthorized' });
      assertEquals(deletion(harness), undefined, 'a rejected token must delete nobody');
    }
  );
});

Deno.test('deletes the auth user outright, which is what the guideline asks for', async () => {
  await withWorld(
    { credential: { body: [{ refresh_token: REFRESH_TOKEN }] }, apple: { [REVOKE]: { body: {} } } },
    async (module, harness) => {
      const response = await module.handleDeleteAccount(post());
      assertEquals(response.status, 200);
      assertEquals(await response.json(), { ok: true, apple: 'revoked' });

      // The caller's own JWT is what identifies them; nothing else names the user.
      assertEquals(harness.requests[0].path, '/auth/v1/user');
      assertEquals(harness.requests[0].headers.authorization, 'Bearer learner-jwt');

      const gone = deletion(harness);
      assertEquals(gone?.path, `/auth/v1/admin/users/${LEARNER}`);
      // GoTrue can soft-delete instead, which would leave the account recoverable
      // and 5.1.1(v) unmet, so the flag is worth pinning rather than assuming.
      assertEquals(gone?.body, { should_soft_delete: false });
      assertEquals(gone?.headers.authorization, 'Bearer service-role-key');
    }
  );
});

Deno.test('revokes the apple grant with the stored token before the account goes', async () => {
  let accountGone = false;
  let accountGoneWhenRevoked: boolean | null = null;

  await withWorld(
    {
      credential: { body: [{ refresh_token: REFRESH_TOKEN }] },
      deleted: () => {
        accountGone = true;
        return { body: { id: LEARNER } };
      },
      apple: {
        [REVOKE]: () => {
          accountGoneWhenRevoked = accountGone;
          return { body: {} };
        },
      },
    },
    async (module, harness) => {
      const response = await module.handleDeleteAccount(post());
      assertEquals(await response.json(), { ok: true, apple: 'revoked' });

      const lookup = harness.requests.find(
        (request) => request.path === '/rest/v1/apple_credentials'
      );
      assertEquals(lookup?.search, `?select=refresh_token&user_id=eq.${LEARNER}`);

      assertEquals(harness.outbound.length, 1, 'exactly one call should reach Apple');
      const revoke = harness.outbound[0];
      assertEquals(revoke.method, 'POST');
      assertEquals(revoke.path, `${APPLE}/auth/revoke`);
      assertEquals(revoke.headers['content-type'], 'application/x-www-form-urlencoded');

      const form = new URLSearchParams(revoke.body as string);
      assertEquals(form.get('client_id'), CLIENT_ID);
      assertEquals(form.get('client_secret'), CLIENT_SECRET);
      assertEquals(form.get('token'), REFRESH_TOKEN);
      assertEquals(form.get('token_type_hint'), 'refresh_token');

      // The token lives in a row that the delete cascades away, so revocation
      // has to come first or it can never happen at all.
      assertEquals(accountGoneWhenRevoked, false);
    }
  );
});

Deno.test(
  'takes the apple credential row with it through the cascade, not a delete of its own',
  async () => {
    await withWorld(
      {
        credential: { body: [{ refresh_token: REFRESH_TOKEN }] },
        apple: { [REVOKE]: { body: {} } },
      },
      async (module, harness) => {
        await module.handleDeleteAccount(post());

        const touched = harness.requests.filter(
          (request) => request.path === '/rest/v1/apple_credentials'
        );
        assertEquals(
          touched.map((request) => request.method),
          ['GET'],
          'the function reads the token and leaves the row to the cascade'
        );
      }
    );

    // Which means nothing in the function removes the refresh token: the row only
    // goes if the schema says so, so the schema is what has to be asserted.
    const migrations = new URL('../../migrations/', import.meta.url);
    const files: string[] = [];
    for await (const entry of Deno.readDir(migrations)) {
      if (entry.isFile && entry.name.endsWith('.sql')) {
        files.push(await Deno.readTextFile(new URL(entry.name, migrations)));
      }
    }
    const table = files
      .join('\n')
      .match(/create table if not exists public\.apple_credentials \(([\s\S]*?)\);/)?.[1];
    assert(table !== undefined, 'apple_credentials should be created by a migration');
    assert(
      /user_id uuid primary key references auth\.users \(id\) on delete cascade/.test(table),
      'apple_credentials.user_id must cascade, or a deleted account leaves its refresh token behind'
    );
  }
);

Deno.test('deletes a learner who never signed in with apple', async () => {
  await withWorld({ credential: { body: [] } }, async (module, harness) => {
    const response = await module.handleDeleteAccount(post());
    assertEquals(response.status, 200);
    assertEquals(await response.json(), { ok: true, apple: 'skipped' });
    assertEquals(harness.outbound.length, 0, 'nothing to revoke means no call to Apple');
    assertEquals(deletion(harness)?.path, `/auth/v1/admin/users/${LEARNER}`);
  });
});

Deno.test('skips revocation when no apple client credentials are configured', async () => {
  await withWorld(
    {
      credential: { body: [{ refresh_token: REFRESH_TOKEN }] },
      environment: { APPLE_CLIENT_ID: '', APPLE_CLIENT_SECRET: '' },
    },
    async (module, harness) => {
      const response = await module.handleDeleteAccount(post());
      assertEquals(await response.json(), { ok: true, apple: 'skipped' });
      assertEquals(harness.outbound.length, 0);
      // Without a client secret there is nothing to sign the call with, so the
      // stored token is not even read.
      assertEquals(
        harness.requests.some((request) => request.path === '/rest/v1/apple_credentials'),
        false
      );
      assertEquals(deletion(harness)?.path, `/auth/v1/admin/users/${LEARNER}`);
    }
  );
});

Deno.test('deletes the account even when apple refuses the revoke', async () => {
  await withWorld(
    {
      credential: { body: [{ refresh_token: REFRESH_TOKEN }] },
      apple: { [REVOKE]: { status: 400, body: { error: 'invalid_grant' } } },
    },
    async (module, harness) => {
      const response = await module.handleDeleteAccount(post());
      assertEquals(response.status, 200);
      // Reported, not hidden — but a refusal upstream cannot be a reason to keep
      // the account, which is the whole point of 5.1.1(v).
      assertEquals(await response.json(), { ok: true, apple: 'failed' });
      assertEquals(deletion(harness)?.path, `/auth/v1/admin/users/${LEARNER}`);
    }
  );
});

Deno.test('deletes the account even when apple cannot be reached at all', async () => {
  await withWorld(
    { credential: { body: [{ refresh_token: REFRESH_TOKEN }] } },
    async (module, harness) => {
      // A transport failure, which `stubFetch` has no way to express: its
      // handlers can only answer, and this branch needs `fetch` itself to reject.
      const stubbed = globalThis.fetch;
      globalThis.fetch = async (
        input: string | URL | Request,
        init?: RequestInit
      ): Promise<Response> => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        if (url.hostname === 'appleid.apple.com') throw new TypeError('connection refused');
        return stubbed(input, init);
      };

      try {
        const response = await module.handleDeleteAccount(post());
        assertEquals(response.status, 200);
        assertEquals(await response.json(), { ok: true, apple: 'failed' });
        assertEquals(deletion(harness)?.path, `/auth/v1/admin/users/${LEARNER}`);
      } finally {
        globalThis.fetch = stubbed;
      }
    }
  );
});

Deno.test('says the grant is still standing when the credential could not be read', async () => {
  await withWorld(
    {
      credential: { status: 500, body: { message: 'database is starting up' } },
      apple: { [REVOKE]: { body: {} } },
    },
    async (module, harness) => {
      const response = await module.handleDeleteAccount(post());
      // "Could not tell" is not "there was nothing to revoke". The account is
      // deleted either way — 5.1.1(v) outranks the revoke — but the cascade
      // takes the token with it, so nothing can retry, and the answer has to
      // say a grant was left standing rather than report it as skipped.
      assertEquals(await response.json(), { ok: true, apple: 'failed' });
      assertEquals(harness.outbound.length, 0);
      assertEquals(deletion(harness)?.path, `/auth/v1/admin/users/${LEARNER}`);
    }
  );
});

Deno.test('skips the revoke for a learner who never used Apple', async () => {
  await withWorld(
    { credential: { body: [] }, apple: { [REVOKE]: { body: {} } } },
    async (module, harness) => {
      const response = await module.handleDeleteAccount(post());

      assertEquals(await response.json(), { ok: true, apple: 'skipped' });
      assertEquals(harness.outbound.length, 0);
      assertEquals(deletion(harness)?.path, `/auth/v1/admin/users/${LEARNER}`);
    }
  );
});

Deno.test(
  'says the delete failed rather than telling the learner the account has gone',
  async () => {
    await withWorld(
      {
        credential: { body: [{ refresh_token: REFRESH_TOKEN }] },
        deleted: { status: 500, body: { message: 'gotrue is unwell' } },
        apple: { [REVOKE]: { body: {} } },
      },
      async (module, harness) => {
        const response = await module.handleDeleteAccount(post());
        assertEquals(response.status, 500);
        assertEquals(await response.json(), { error: 'delete_failed' });
        // The attempt still went out; the app is free to retry.
        assertEquals(deletion(harness)?.path, `/auth/v1/admin/users/${LEARNER}`);
      }
    );
  }
);

Deno.test('answers a cors preflight and refuses any method but post', async () => {
  await withWorld({}, async (module, harness) => {
    const preflight = await module.handleDeleteAccount(
      new Request('http://localhost/delete-account', { method: 'OPTIONS' })
    );
    assertEquals(preflight.status, 200);
    assertEquals(await preflight.text(), 'ok');
    assertEquals(preflight.headers.get('Access-Control-Allow-Methods'), 'POST, OPTIONS');

    const get = await module.handleDeleteAccount(
      new Request('http://localhost/delete-account', { method: 'GET' })
    );
    assertEquals(get.status, 405);
    assertEquals(await get.json(), { error: 'method_not_allowed' });
    assertEquals(get.headers.get('Access-Control-Allow-Origin'), '*');

    assertEquals(harness.requests.length, 0, 'neither should reach the backend');
  });
});
