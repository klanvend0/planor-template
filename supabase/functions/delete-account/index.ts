/**
 * Account deletion.
 *
 * App Store Review Guideline 5.1.1(v) requires an app that creates accounts to
 * let people delete them from inside the app, and Apple additionally requires
 * apps using Sign in with Apple to revoke the sign-in grant. So this function
 * does two things, in order:
 *
 *   1. revokes the Apple refresh token stored by `apple-token-exchange`;
 *   2. deletes the `auth.users` row, which cascades through every table in the
 *      schema (profile, game state, progress, attempts, XP ledger, subscription
 *      mirror, AI review log, Apple credentials).
 *
 * The caller proves who they are with their own JWT; the service role key is
 * only used to perform the deletion they are entitled to.
 *
 * Secrets: APPLE_CLIENT_ID, APPLE_CLIENT_SECRET (see apple-token-exchange).
 *
 * @module supabase/functions/delete-account
 */

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';

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
 * Revoke the learner's Sign in with Apple grant.
 *
 * @returns `revoked` when Apple accepted, `skipped` when there is nothing to
 * revoke or the credentials are not configured, `failed` when Apple refused.
 */
async function revokeAppleGrant(
  admin: SupabaseClient,
  userId: string
): Promise<'revoked' | 'skipped' | 'failed'> {
  if (!APPLE_CLIENT_ID || !APPLE_CLIENT_SECRET) return 'skipped';

  const { data, error } = await admin
    .from('apple_credentials')
    .select('refresh_token')
    .eq('user_id', userId)
    .maybeSingle();

  // A read that failed is not the same fact as "there was nothing to revoke",
  // and the difference is permanent: the account is about to be deleted, the
  // cascade takes the token with it, and nothing can retry afterwards. Say it
  // failed, so the response and the logs show a grant that is still standing.
  if (error) {
    console.error('[delete-account] could not read the apple credential', error);
    return 'failed';
  }

  const refreshToken = data?.refresh_token;
  if (!refreshToken) return 'skipped';

  try {
    const response = await fetch('https://appleid.apple.com/auth/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: APPLE_CLIENT_ID,
        client_secret: APPLE_CLIENT_SECRET,
        token: refreshToken,
        token_type_hint: 'refresh_token',
      }),
    });

    if (!response.ok) {
      console.error('[delete-account] apple revoke failed', response.status, await response.text());
      return 'failed';
    }
    return 'revoked';
  } catch (error) {
    console.error('[delete-account] apple revoke threw', error);
    return 'failed';
  }
}

/**
 * The function itself. Exported so `supabase/functions/_tests` can call it
 * directly; the runtime reaches it through `Deno.serve` below.
 */
export async function handleDeleteAccount(request: Request): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

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

  const appleRevocation = await revokeAppleGrant(admin, user.id);

  // Every table references auth.users with `on delete cascade`, so one delete
  // removes the profile, game state, progress, attempts, XP ledger, the
  // subscription mirror, the AI review log and the Apple credentials.
  const { error: deleteError } = await admin.auth.admin.deleteUser(user.id);
  if (deleteError) {
    console.error('[delete-account] delete failed', deleteError);
    return json({ error: 'delete_failed' }, 500);
  }

  return json({ ok: true, apple: appleRevocation });
}

Deno.serve(handleDeleteAccount);
