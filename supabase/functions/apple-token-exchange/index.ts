/**
 * Stores the Apple refresh token needed to revoke a Sign in with Apple grant.
 *
 * Apple requires an app that offers Sign in with Apple to call its revoke
 * endpoint when the account is deleted (App Store Review 5.1.1(v)). Revocation
 * needs a refresh token, which can only be obtained by exchanging the
 * short-lived `authorizationCode` the device receives at sign-in — so the app
 * posts that code here immediately after signing in, and the token is filed away
 * until (and unless) the learner deletes their account.
 *
 * The token lands in `public.apple_credentials`, which no client role can read.
 *
 * Secrets:
 *   APPLE_CLIENT_ID     - the app's bundle identifier (e.g. com.planor.codeling)
 *   APPLE_CLIENT_SECRET - the signed JWT from `npm run generate:apple-secret`
 *                         (Apple caps its lifetime at 6 months; regenerate it)
 *
 * @module supabase/functions/apple-token-exchange
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const APPLE_CLIENT_ID = Deno.env.get('APPLE_CLIENT_ID') ?? '';
const APPLE_CLIENT_SECRET = Deno.env.get('APPLE_CLIENT_SECRET') ?? '';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

/**
 * Read the claims out of an id_token without verifying it.
 *
 * Verification is unnecessary here: the token came straight from Apple over TLS
 * in the response to our own exchange request, so it cannot have been swapped.
 * The claims are only used to check that the code belonged to the caller.
 */
function readClaims(idToken: string): { sub?: string } | null {
  try {
    const payload = idToken.split('.')[1];
    const padded = payload
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      .padEnd(payload.length + ((4 - (payload.length % 4)) % 4), '=');
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  if (!APPLE_CLIENT_ID || !APPLE_CLIENT_SECRET) {
    // Not fatal for the learner: sign-in already succeeded. Deletion will simply
    // fall back to deleting the Supabase user without revoking the Apple grant.
    console.error('[apple-token-exchange] APPLE_CLIENT_ID/SECRET are not set');
    return json({ error: 'not_configured' }, 503);
  }

  const authHeader = request.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return json({ error: 'unauthorized' }, 401);

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } }
  );

  const { data: userData, error: userError } = await admin.auth.getUser(
    authHeader.replace('Bearer ', '')
  );
  const user = userData?.user;
  if (userError || !user) return json({ error: 'unauthorized' }, 401);

  let body: { authorizationCode?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  const code = typeof body.authorizationCode === 'string' ? body.authorizationCode : '';
  if (!code) return json({ error: 'code_required' }, 400);

  const response = await fetch('https://appleid.apple.com/auth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: APPLE_CLIENT_ID,
      client_secret: APPLE_CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    console.error(
      '[apple-token-exchange] apple rejected the code',
      response.status,
      detail.slice(0, 200)
    );
    return json({ error: 'exchange_failed' }, 502);
  }

  const tokens = await response.json();
  const refreshToken = typeof tokens?.refresh_token === 'string' ? tokens.refresh_token : '';
  if (!refreshToken) return json({ error: 'no_refresh_token' }, 502);

  // The code has to belong to the caller. Without this check anyone could post
  // someone else's authorization code and file that person's refresh token
  // under their own account — and later revoke their Apple sign-in with it.
  const claims = typeof tokens?.id_token === 'string' ? readClaims(tokens.id_token) : null;
  const appleIdentity = user.identities?.find((identity) => identity.provider === 'apple');

  if (!claims?.sub || !appleIdentity || appleIdentity.id !== claims.sub) {
    console.error('[apple-token-exchange] code does not belong to the caller');
    return json({ error: 'identity_mismatch' }, 403);
  }

  const { error } = await admin.from('apple_credentials').upsert(
    {
      user_id: user.id,
      refresh_token: refreshToken,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' }
  );

  if (error) {
    console.error('[apple-token-exchange] could not store token', error);
    return json({ error: 'persist_failed' }, 500);
  }

  return json({ ok: true });
});
