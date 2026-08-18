/**
 * Social authentication.
 *
 * Google and Apple sign-in on top of Supabase Auth, using Expo's own packages
 * (`expo-apple-authentication`, `expo-auth-session`, `expo-web-browser`).
 *
 * Apple-specific constraint: the app must be able to revoke the Sign in with
 * Apple grant when an account is deleted, which requires a refresh token that
 * can only be obtained from the one-time `authorizationCode` handed over at
 * sign-in. That code is therefore posted to the `apple-token-exchange` edge
 * function immediately, before it expires.
 *
 * @module lib/auth
 */

import * as AppleAuthentication from 'expo-apple-authentication';
import { makeRedirectUri } from 'expo-auth-session';
import * as Crypto from 'expo-crypto';
import * as WebBrowser from 'expo-web-browser';

import { supabase } from './supabase';

// Ensure WebBrowser sessions are completed properly on Android.
WebBrowser.maybeCompleteAuthSession();

/** URL scheme registered in app.json; also used for the OAuth redirect. */
const APP_SCHEME = 'codeling';

export type AuthResult = {
  success: boolean;
  /** Machine-readable reason, for mapping to a translated message. */
  reason?: 'cancelled' | 'unavailable' | 'failed';
  error?: string;
};

/**
 * Generate a random nonce for the OAuth flow.
 *
 * @returns A 32-character hex nonce.
 */
export async function generateNonce(): Promise<string> {
  const randomBytes = await Crypto.getRandomBytesAsync(16);
  return Array.from(new Uint8Array(randomBytes))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * SHA-256 hash of a nonce, which is what Apple is given so the raw value can be
 * used to prove the token belongs to this request.
 */
export async function hashNonce(nonce: string): Promise<string> {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, nonce);
}

/** The redirect URI Supabase sends the browser back to. */
export function getRedirectUri(): string {
  return makeRedirectUri({ scheme: APP_SCHEME, path: 'auth/callback' });
}

/**
 * Hand Apple's one-time authorization code to the backend, which exchanges it
 * for a refresh token used only to revoke the grant on account deletion.
 *
 * Failures are logged and swallowed: sign-in has already succeeded, and the
 * worst case is that deletion cannot revoke the Apple grant.
 */
async function storeAppleAuthorizationCode(authorizationCode: string): Promise<void> {
  try {
    const { error } = await supabase.functions.invoke('apple-token-exchange', {
      body: { authorizationCode },
    });
    if (error) console.warn('[auth] apple token exchange failed', error.message);
  } catch (error) {
    console.warn('[auth] apple token exchange threw', error);
  }
}

/**
 * Native Apple Sign-In (iOS).
 *
 * @returns Whether the learner is now signed in, and why not if they are not.
 */
export async function signInWithApple(): Promise<AuthResult> {
  try {
    if (!(await AppleAuthentication.isAvailableAsync())) {
      return { success: false, reason: 'unavailable', error: 'Apple Sign-In is unavailable' };
    }

    const rawNonce = await generateNonce();
    const hashedNonce = await hashNonce(rawNonce);

    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
      nonce: hashedNonce,
    });

    if (!credential.identityToken) {
      return { success: false, reason: 'failed', error: 'No identity token received from Apple' };
    }

    const { error } = await supabase.auth.signInWithIdToken({
      provider: 'apple',
      token: credential.identityToken,
      nonce: rawNonce,
    });

    if (error) return { success: false, reason: 'failed', error: error.message };

    if (credential.authorizationCode) {
      await storeAppleAuthorizationCode(credential.authorizationCode);
    }

    return { success: true };
  } catch (error) {
    const appleError = error as { code?: string; message?: string };
    if (
      appleError.code === 'ERR_REQUEST_CANCELED' ||
      appleError.message?.toLowerCase().includes('cancel')
    ) {
      return { success: false, reason: 'cancelled' };
    }
    console.error('[auth] apple sign-in failed', error);
    return { success: false, reason: 'failed', error: appleError.message ?? 'Unknown error' };
  }
}

/**
 * Google sign-in through Supabase's OAuth flow in an in-app browser.
 *
 * @returns Whether the learner is now signed in, and why not if they are not.
 */
export async function signInWithGoogle(): Promise<AuthResult> {
  try {
    const redirectTo = getRedirectUri();

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo, skipBrowserRedirect: true },
    });

    if (error) return { success: false, reason: 'failed', error: error.message };
    if (!data.url) {
      return { success: false, reason: 'failed', error: 'No OAuth URL returned from Supabase' };
    }

    const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);

    if (result.type === 'cancel' || result.type === 'dismiss') {
      return { success: false, reason: 'cancelled' };
    }
    if (result.type !== 'success' || !result.url) {
      return { success: false, reason: 'failed', error: 'Authentication did not complete' };
    }

    // Supabase returns the session in the URL fragment:
    // codeling://auth/callback#access_token=...&refresh_token=...
    const fragment = result.url.split('#')[1];
    if (fragment) {
      const params = new URLSearchParams(fragment);
      const accessToken = params.get('access_token');
      const refreshToken = params.get('refresh_token');

      if (accessToken && refreshToken) {
        const { error: sessionError } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        if (sessionError) {
          return { success: false, reason: 'failed', error: sessionError.message };
        }
        return { success: true };
      }
    }

    const description = new URLSearchParams(result.url.split('?')[1] ?? '').get(
      'error_description'
    );
    return {
      success: false,
      reason: 'failed',
      error: description ?? 'No authentication tokens received',
    };
  } catch (error) {
    console.error('[auth] google sign-in failed', error);
    return {
      success: false,
      reason: 'failed',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Sign in with a Google ID token obtained by a native SDK.
 *
 * Kept for a future native Google Sign-In flow; unused by the current UI.
 */
export async function signInWithGoogleToken(
  idToken: string,
  accessToken?: string
): Promise<AuthResult> {
  const { error } = await supabase.auth.signInWithIdToken({
    provider: 'google',
    token: idToken,
    access_token: accessToken,
  });

  if (error) return { success: false, reason: 'failed', error: error.message };
  return { success: true };
}

/** Sign the learner out of Supabase. */
export async function signOut(): Promise<AuthResult> {
  const { error } = await supabase.auth.signOut();
  if (error) return { success: false, reason: 'failed', error: error.message };
  return { success: true };
}
