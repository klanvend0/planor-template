import * as Localization from 'expo-localization';
import { I18n } from 'i18n-js';
import en from '@/i18n/en.json';
import AsyncStorage from '@react-native-async-storage/async-storage';

const i18n = new I18n({ en });

// Default locale
i18n.defaultLocale = 'en';

// Detect device locale; fallback to English
const deviceLocales = Array.isArray(Localization.getLocales)
  ? // Newer expo-localization returns getLocales(): Locale[]
    // @ts-ignore: safeguard for differing versions
    Localization.getLocales()
  : // Older versions expose locales array directly
    // @ts-ignore
    Localization.locales;

const primaryTag =
  Array.isArray(deviceLocales) && deviceLocales.length > 0
    ? (deviceLocales[0].languageCode ?? 'en')
    : (Localization.getLocales()[0].languageCode ?? 'en');

i18n.locale = ['en'].includes(primaryTag) ? primaryTag : 'en';

// -----------------------------
// Typed translation key support (bounded depth to avoid TS recursion limits)
// -----------------------------
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
  | Level1<typeof en>
  | Level2<typeof en>
  | Level3<typeof en>
  | Level4<typeof en>;

export function t<Key extends TranslationKeys>(
  key: Key,
  options?: Parameters<I18n['t']>[1]
): string {
  // Casting to string is safe because TranslationKeys are derived from object keys
  return i18n.t(key as string, options);
}

// -----------------------------
// Locale management helpers
// -----------------------------
type SupportedLocale = 'en';

const listeners = new Set<() => void>();

export function getLocale(): SupportedLocale {
  const current = String(i18n.locale);
  return (current.startsWith('en') ? 'en' : 'en') as SupportedLocale;
}

export async function setLocale(next: SupportedLocale): Promise<void> {
  i18n.locale = next;
  try {
    await AsyncStorage.setItem('i18n.locale', next);
  } catch {}
  listeners.forEach((fn) => fn());
}

export function addI18nChangeListener(listener: () => void): void {
  listeners.add(listener);
}

export function removeI18nChangeListener(listener: () => void): void {
  listeners.delete(listener);
}

export default i18n;
