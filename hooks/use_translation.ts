/**
 * Locale-aware translation hook.
 *
 * Components must use this rather than importing `t` directly when their copy
 * has to change the moment the learner switches language: `useSyncExternalStore`
 * re-renders every subscriber when {@link setLocale} fires.
 *
 * @module hooks/use_translation
 */

import { useCallback, useSyncExternalStore } from 'react';

import {
  getLocale,
  setLocale,
  subscribeToLocale,
  t as translate,
  type SupportedLocale,
  type TranslationKeys,
} from '@/lib/i18n';

type Translate = <Key extends TranslationKeys>(
  key: Key,
  options?: Record<string, unknown>
) => string;

export type UseTranslation = {
  /** Translate a key in the active locale. */
  t: Translate;
  /** The active locale. */
  locale: SupportedLocale;
  /** Switch locale for the whole app and persist the choice. */
  setLocale: (locale: SupportedLocale) => Promise<void>;
};

/**
 * @example
 * const { t, locale } = useTranslation();
 * <Text>{t('learn.daily_goal')}</Text>
 */
export function useTranslation(): UseTranslation {
  const locale = useSyncExternalStore(subscribeToLocale, getLocale, getLocale);

  const t = useCallback<Translate>(
    (key, options) => translate(key, options as never),
    // The locale is not read inside `translate`'s closure, but the identity has
    // to change with it so memoized children re-render on a language switch.
    [locale]
  );

  return { t, locale, setLocale };
}
