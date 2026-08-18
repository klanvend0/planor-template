/**
 * Localization.
 *
 * Wraps i18n-js with the two locales the app ships with (English and Turkish),
 * device detection, persistence, and a typed `t()` whose keys are derived from
 * `i18n/en.json` — a missing or misspelled key is a compile error, not a
 * runtime "[missing translation]".
 *
 * Constraints:
 * - Every learner-facing string in the app must come from here.
 * - `initI18n()` must be awaited before the first render so the stored locale
 *   is applied without a visible flash of English.
 *
 * @module lib/i18n
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Localization from 'expo-localization';
import { I18n } from 'i18n-js';

import en from '@/i18n/en.json';
import tr from '@/i18n/tr.json';

/** Locales with a complete dictionary. Mirrors `LOCALES` in content_schema. */
export const SUPPORTED_LOCALES = ['en', 'tr'] as const;

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

const STORAGE_KEY = 'settings.locale';

const i18n = new I18n({ en, tr });

i18n.defaultLocale = 'en';
i18n.enableFallback = true;

function isSupported(value: string | null | undefined): value is SupportedLocale {
  return !!value && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/** The locale the device asks for, or English when it is one we do not ship. */
export function deviceLocale(): SupportedLocale {
  const tag = Localization.getLocales()[0]?.languageCode;
  return isSupported(tag) ? tag : 'en';
}

i18n.locale = deviceLocale();

// -----------------------------------------------------------------------------
// Typed keys (bounded depth keeps TypeScript out of recursion limits)
// -----------------------------------------------------------------------------

type Keys<T> = Extract<keyof T, string>;
type Join<K, P> = K extends string | number
  ? P extends string | number
    ? `${K}.${P}`
    : never
  : never;

type Level1<T> = Keys<T>;
type Level2<T> = {
  [K in Keys<T>]: T[K] extends Record<string, any> ? Join<K, Keys<T[K]>> : never;
}[Keys<T>];
type Level3<T> = {
  [K in Keys<T>]: T[K] extends Record<string, any>
    ? {
        [K2 in Keys<T[K]>]: T[K][K2] extends Record<string, any>
          ? Join<Join<K, K2>, Keys<T[K][K2]>>
          : never;
      }[Keys<T[K]>]
    : never;
}[Keys<T>];
type Level4<T> = {
  [K in Keys<T>]: T[K] extends Record<string, any>
    ? {
        [K2 in Keys<T[K]>]: T[K][K2] extends Record<string, any>
          ? {
              [K3 in Keys<T[K][K2]>]: T[K][K2][K3] extends Record<string, any>
                ? Join<Join<Join<K, K2>, K3>, Keys<T[K][K2][K3]>>
                : never;
            }[Keys<T[K][K2]>]
          : never;
      }[Keys<T[K]>]
    : never;
}[Keys<T>];

export type TranslationKeys =
  Level1<typeof en> | Level2<typeof en> | Level3<typeof en> | Level4<typeof en>;

/**
 * Translate a key.
 *
 * @param key - Dotted key from `i18n/en.json`.
 * @param options - i18n-js options: interpolation values, `count` for plurals.
 */
export function t<Key extends TranslationKeys>(
  key: Key,
  options?: Parameters<I18n['t']>[1]
): string {
  return i18n.t(key as string, options);
}

// -----------------------------------------------------------------------------
// Locale management
// -----------------------------------------------------------------------------

const listeners = new Set<() => void>();

/** The locale currently in use. */
export function getLocale(): SupportedLocale {
  const current = String(i18n.locale);
  return isSupported(current) ? current : 'en';
}

/** Switch locale, persist the choice, and notify subscribed components. */
export async function setLocale(next: SupportedLocale): Promise<void> {
  if (getLocale() === next) return;
  i18n.locale = next;
  try {
    await AsyncStorage.setItem(STORAGE_KEY, next);
  } catch {
    // A failed write only costs the preference on next launch; never block the UI.
  }
  listeners.forEach((listener) => listener());
}

/**
 * Restore the stored locale. Call once, before the first render.
 *
 * @returns The locale that ended up active.
 */
export async function initI18n(): Promise<SupportedLocale> {
  try {
    const stored = await AsyncStorage.getItem(STORAGE_KEY);
    if (isSupported(stored)) {
      i18n.locale = stored;
      return stored;
    }
  } catch {
    // Fall through to the device locale.
  }
  return getLocale();
}

/**
 * Uppercase a string the way its language expects.
 *
 * Turkish is the reason this exists: a dotted `i` uppercases to `İ`, not `I`,
 * and CSS `text-transform` (NativeWind's `uppercase`) gets that wrong. Button
 * and badge labels therefore go through here instead of a class.
 */
export function localeUpper(value: string, locale: SupportedLocale): string {
  return value.toLocaleUpperCase(locale === 'tr' ? 'tr-TR' : 'en-US');
}

/** Subscribe to locale changes. Returns the unsubscribe function. */
export function subscribeToLocale(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export default i18n;
