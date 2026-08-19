/**
 * Account lifecycle.
 *
 * Deleting an account has to happen server-side (it needs the service role key,
 * which never ships in the bundle) and has to revoke the Sign in with Apple
 * grant, so it goes through the `delete-account` edge function.
 *
 * @module services/account_service
 */

import { FunctionsHttpError } from '@supabase/supabase-js';

import { USES_LOCAL_BACKEND } from '@/lib/backend_mode';
import { AppError } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import * as local from '@/services/local/backend';
import { useAuthStore } from '@/stores/auth_store';

/**
 * Permanently delete the signed-in learner's account and every row that hangs
 * off it, then clear the local session.
 *
 * @throws {AppError} when the backend refuses; the caller shows a support hint.
 */
export async function deleteAccount(): Promise<void> {
  if (USES_LOCAL_BACKEND) {
    // Nothing was ever sent anywhere: deleting is wiping the device's own copy.
    // Clearing the session matters as much as the wipe — the id is minted from
    // a constant, so signing back in would otherwise land on the same id with
    // the old XP and streak still on screen.
    await local.deleteAccount();
    useAuthStore.getState().clearAuth();
    return;
  }

  const { error } = await supabase.functions.invoke('delete-account', { body: {} });

  if (error) {
    if (error instanceof FunctionsHttpError && error.context.status === 401) {
      throw new AppError('auth', 'Session expired, sign in again to delete the account');
    }
    throw new AppError('unknown', error.message ?? 'Account deletion failed', error);
  }

  // The auth row is gone; drop the local session so the app returns to sign-in.
  await supabase.auth.signOut();
}
