/**
 * App bootstrap.
 *
 * Everything that must happen once, in order, before the first screen is shown:
 * restore the locale, restore preferences, restore the Supabase session, and
 * bring RevenueCat up. Also keeps the app honest while it runs — refreshing game
 * state and flushing queued offline writes whenever it returns to the foreground.
 *
 * @module hooks/use_app_bootstrap
 */

import { useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { identify as identifyAnalytics, resetAnalytics } from '@/lib/analytics';
import { initI18n } from '@/lib/i18n';
import { scheduleDailyReminder } from '@/services/notifications_service';
import { useAuthStore } from '@/stores/auth_store';
import { useGameStore } from '@/stores/game_store';
import { useProgressStore } from '@/stores/progress_store';
import { useSettingsStore } from '@/stores/settings_store';
import { useSubscriptionStore } from '@/stores/subscription_store';
import { useSyncQueue } from '@/stores/sync_queue';

export type BootstrapState = {
  /** True once the app may render its first screen. */
  isReady: boolean;
};

/**
 * @returns Whether bootstrap has finished; the root layout holds the splash
 * screen until it has.
 */
export function useAppBootstrap(): BootstrapState {
  const [localeReady, setLocaleReady] = useState(false);

  const hydrated = useSettingsStore((state) => state.hydrated);
  const initializeAuth = useAuthStore((state) => state.initialize);
  const isAuthLoading = useAuthStore((state) => state.isLoading);
  const userId = useAuthStore((state) => state.user?.id ?? null);

  const initializeSubscription = useSubscriptionStore((state) => state.initialize);
  const identify = useSubscriptionStore((state) => state.identify);
  const refreshGame = useGameStore((state) => state.refresh);
  const clearGame = useGameStore((state) => state.clear);
  const clearProgress = useProgressStore((state) => state.clear);

  const identifiedUser = useRef<string | null>(null);

  // 1. Locale, before anything renders, so nothing flashes in English.
  useEffect(() => {
    void initI18n().finally(() => setLocaleReady(true));
  }, []);

  // 2. Supabase session.
  useEffect(() => {
    void initializeAuth();
  }, [initializeAuth]);

  // 3. RevenueCat: configured once, then re-identified whenever the user changes.
  useEffect(() => {
    void initializeSubscription(userId ?? undefined);
    // Only on mount: identify() below handles later sign-ins.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!userId) {
      identifiedUser.current = null;
      resetAnalytics();
      // Anything still queued belonged to the account that just left.
      useSyncQueue.getState().setOwner(null);
      clearGame();
      clearProgress();
      return;
    }

    useSyncQueue.getState().setOwner(userId);
    if (identifiedUser.current === userId) return;

    identifiedUser.current = userId;
    identifyAnalytics(userId);
    void identify(userId);
    void refreshGame();
  }, [clearGame, clearProgress, identify, refreshGame, userId]);

  // 4. Keep the daily reminder's copy in step with the streak it talks about.
  const remindersEnabled = useSettingsStore((state) => state.remindersEnabled);
  const reminderHour = useSettingsStore((state) => state.reminderHour);
  const streakDays = useGameStore((state) => state.state?.streakDays ?? 0);

  useEffect(() => {
    if (!remindersEnabled) return;
    void scheduleDailyReminder(reminderHour, streakDays);
  }, [reminderHour, remindersEnabled, streakDays]);

  // 5. Keep state fresh across foreground transitions, and land offline writes.
  useEffect(() => {
    const onChange = (status: AppStateStatus) => {
      if (status !== 'active' || !userId) return;
      void useSyncQueue.getState().flush();
      void refreshGame({ silent: true });
    };

    const subscription = AppState.addEventListener('change', onChange);
    return () => subscription.remove();
  }, [refreshGame, userId]);

  return { isReady: localeReady && hydrated && !isAuthLoading };
}
