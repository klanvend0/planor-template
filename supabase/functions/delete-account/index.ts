/**
 * Account deletion.
 *
 * App Store Review Guideline 5.1.1(v) requires an app that creates accounts to
 * let people delete them from inside the app. Deleting the `auth.users` row
 * cascades through every table in the schema, so this is the whole story.
 *
 * The caller proves who they are with their own JWT; the service role key is
 * only used to perform the delete they are entitled to.
 *
 * @module supabase/functions/delete-account
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (request: Request) => {
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

  // Every table references auth.users with `on delete cascade`, so one delete
  // removes the profile, game state, progress, attempts, XP ledger, the
  // subscription mirror and the AI review log.
  const { error: deleteError } = await admin.auth.admin.deleteUser(user.id);
  if (deleteError) {
    console.error('[delete-account] delete failed', deleteError);
    return json({ error: 'delete_failed' }, 500);
  }

  return json({ ok: true });
});
