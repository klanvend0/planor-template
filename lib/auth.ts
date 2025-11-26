/**
 * Social Authentication Service
 *
 * This module provides Google and Apple OAuth authentication functions
 * that integrate with Supabase Auth. It uses Expo's official packages
 * for authentication flows:
 * - expo-apple-authentication for Apple Sign-In (iOS)
 * - expo-auth-session with expo-web-browser for Google Sign-In
 *
 * @module lib/auth
 */

import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import * as WebBrowser from 'expo-web-browser';
import { makeRedirectUri } from 'expo-auth-session';

import { supabase } from './supabase';

// Ensure WebBrowser sessions are completed properly on Android
WebBrowser.maybeCompleteAuthSession();

/**
 * Type definitions for authentication result
 */
export type AuthResult = {
  success: boolean;
  error?: string;
};

/**
 * Generate a random nonce for PKCE security
 * Used to prevent replay attacks in OAuth flows
 *
 * @returns A random nonce string
 */
export async function generateNonce(): Promise<string> {
  const randomBytes = await Crypto.getRandomBytesAsync(16);
  const nonce = Array.from(new Uint8Array(randomBytes))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  return nonce;
}

/**
 * Hash a nonce using SHA-256
 * Required for Apple Sign-In to verify the nonce
 *
 * @param nonce - The raw nonce string to hash
 * @returns SHA-256 hash of the nonce
 */
export async function hashNonce(nonce: string): Promise<string> {
  const hash = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, nonce);
  return hash;
}

/**
 * Apple Sign-In handler for iOS
 *
 * Performs native Apple Sign-In using expo-apple-authentication
 * and authenticates with Supabase using the returned ID token.
 *
 * @returns AuthResult indicating success or failure with error message
 *
 * @example
 * ```ts
 * const result = await signInWithApple();
 * if (result.success) {
 *   // Navigate to home screen
 * } else {
 *   console.error(result.error);
 * }
 * ```
 */
export async function signInWithApple(): Promise<AuthResult> {
  try {
    // Check if Apple authentication is available
    const isAvailable = await AppleAuthentication.isAvailableAsync();
    if (!isAvailable) {
      return {
        success: false,
        error: 'Apple Sign-In is not available on this device',
      };
    }

    // Generate a nonce for security
    const rawNonce = await generateNonce();
    const hashedNonce = await hashNonce(rawNonce);

    // Perform Apple Sign-In request
    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
      nonce: hashedNonce,
    });

    // Verify we received an identity token
    if (!credential.identityToken) {
      return {
        success: false,
        error: 'No identity token received from Apple',
      };
    }

    // Sign in with Supabase using the Apple ID token
    const { data, error } = await supabase.auth.signInWithIdToken({
      provider: 'apple',
      token: credential.identityToken,
      nonce: rawNonce,
    });

    if (error) {
      console.error('Supabase Apple sign-in error:', error);
      return {
        success: false,
        error: error.message,
      };
    }

    console.log('Apple sign-in successful:', data.user?.email);
    return { success: true };
  } catch (error) {
    // Handle user cancellation gracefully
    if (error instanceof Error && error.message.includes('cancelled')) {
      return {
        success: false,
        error: 'Sign-in was cancelled',
      };
    }

    // Check for AppleAuthenticationError with code property
    const appleError = error as { code?: string };
    if (appleError.code === 'ERR_REQUEST_CANCELED') {
      return {
        success: false,
        error: 'Sign-in was cancelled',
      };
    }

    console.error('Apple sign-in error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
}

/**
 * Generate the redirect URI for OAuth flows
 * This creates a proper URI based on the app's scheme and platform
 *
 * @returns The redirect URI string
 */
export function getRedirectUri(): string {
  return makeRedirectUri({
    scheme: 'planor-template',
    path: 'auth/callback',
  });
}

/**
 * Google Sign-In handler using Supabase OAuth flow
 *
 * Opens a web browser for Google authentication through Supabase.
 * After successful authentication, Supabase redirects back to the app
 * using the configured deep link (planor-template://auth/callback).
 *
 * @returns AuthResult indicating success or failure with error message
 *
 * @example
 * ```ts
 * const result = await signInWithGoogle();
 * if (result.success) {
 *   // User will be redirected, session handled by Supabase
 * }
 * ```
 */
export async function signInWithGoogle(): Promise<AuthResult> {
  try {
    const redirectTo = getRedirectUri();

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo,
        skipBrowserRedirect: true,
      },
    });

    if (error) {
      console.error('Supabase Google OAuth error:', error);
      return {
        success: false,
        error: error.message,
      };
    }

    if (!data.url) {
      return {
        success: false,
        error: 'No OAuth URL returned from Supabase',
      };
    }

    console.log('Opening OAuth URL:', data.url);
    console.log('Redirect URI:', redirectTo);

    // Open the OAuth URL in a web browser
    const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);

    console.log('OAuth result:', result.type, result.type === 'success' ? (result as any).url : '');

    if (result.type === 'success' && result.url) {
      // Extract tokens from the callback URL
      // The URL format is: planor-template://auth/callback#access_token=...&refresh_token=...
      const url = result.url;
      const hashParams = url.split('#')[1];

      if (hashParams) {
        const params = new URLSearchParams(hashParams);
        const accessToken = params.get('access_token');
        const refreshToken = params.get('refresh_token');

        if (accessToken && refreshToken) {
          // Set the session with the tokens
          const { error: sessionError } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });

          if (sessionError) {
            console.error('Error setting session:', sessionError);
            return {
              success: false,
              error: sessionError.message,
            };
          }

          console.log('Google sign-in successful, session set');
          return { success: true };
        }
      }

      // Check for error in URL
      const errorDesc = url.includes('error_description=')
        ? decodeURIComponent(url.split('error_description=')[1]?.split('&')[0] || '')
        : null;

      if (errorDesc) {
        return {
          success: false,
          error: errorDesc,
        };
      }

      return {
        success: false,
        error: 'No authentication tokens received',
      };
    } else if (result.type === 'cancel' || result.type === 'dismiss') {
      return {
        success: false,
        error: 'Sign-in was cancelled',
      };
    }

    return {
      success: false,
      error: 'Authentication failed',
    };
  } catch (error) {
    console.error('Google sign-in error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
}

/**
 * Google Sign-In with ID Token (for native flows)
 *
 * Used when you already have a Google ID token from a native SDK.
 *
 * @param idToken - The Google ID token from the auth response
 * @param accessToken - Optional access token for additional API calls
 * @returns AuthResult indicating success or failure with error message
 */
export async function signInWithGoogleToken(
  idToken: string,
  accessToken?: string
): Promise<AuthResult> {
  try {
    const { data, error } = await supabase.auth.signInWithIdToken({
      provider: 'google',
      token: idToken,
      access_token: accessToken,
    });

    if (error) {
      console.error('Supabase Google sign-in error:', error);
      return {
        success: false,
        error: error.message,
      };
    }

    console.log('Google sign-in successful:', data.user?.email);
    return { success: true };
  } catch (error) {
    console.error('Google sign-in error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
}

/**
 * Sign out the current user from Supabase
 *
 * @returns AuthResult indicating success or failure
 */
export async function signOut(): Promise<AuthResult> {
  try {
    const { error } = await supabase.auth.signOut();

    if (error) {
      console.error('Sign-out error:', error);
      return {
        success: false,
        error: error.message,
      };
    }

    return { success: true };
  } catch (error) {
    console.error('Sign-out error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
}
