/**
 * Device-local preferences.
 *
 * Everything here survives a restart without a round trip: locale, appearance,
 * haptics, the daily reminder and the onboarding answers. Preferences that also
 * matter server-side (locale, course, daily goal) are mirrored into `profiles`
 * by the screens that change them — this store is the fast, offline copy.
 *
 * @module stores/settings_store
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import type { CourseId } from '@/lib/content_schema';
import { getLocale, setLocale as applyLocale, type SupportedLocale } from '@/lib/i18n';

export type ColorSchemePreference = 'system' | 'light' | 'dark';
export type ExperienceLevel = 'new' | 'some' | 'confident';

/** Daily goals offered during onboarding, in XP. */
export const DAILY_GOALS = [20, 50, 100, 200] as const;

export type DailyGoal = (typeof DAILY_GOALS)[number];

type SettingsState = {
  locale: SupportedLocale;
  colorScheme: ColorSchemePreference;
  hapticsEnabled: boolean;
  remindersEnabled: boolean;
  /** Local hour (0-23) for the daily reminder. */
  reminderHour: number;
  activeCourse: CourseId;
  dailyGoalXp: DailyGoal;
  experienceLevel: ExperienceLevel;
  onboardingCompleted: boolean;
  /** Epoch ms of the last paywall impression, used to avoid nagging. */
  lastPaywallAt: number | null;
  /** True once the persisted state has been read from disk. */
  hydrated: boolean;
};

type SettingsActions = {
  setLocale: (locale: SupportedLocale) => Promise<void>;
  setColorScheme: (scheme: ColorSchemePreference) => void;
  setHapticsEnabled: (enabled: boolean) => void;
  setReminders: (enabled: boolean, hour?: number) => void;
  setActiveCourse: (course: CourseId) => void;
  setDailyGoal: (goal: DailyGoal) => void;
  setExperienceLevel: (level: ExperienceLevel) => void;
  completeOnboarding: () => void;
  markPaywallSeen: () => void;
  /** Wipe local preferences — used after account deletion. */
  reset: () => void;
};

const initialState: SettingsState = {
  locale: getLocale(),
  colorScheme: 'system',
  hapticsEnabled: true,
  remindersEnabled: false,
  reminderHour: 19,
  activeCourse: 'python',
  dailyGoalXp: 50,
  experienceLevel: 'new',
  onboardingCompleted: false,
  lastPaywallAt: null,
  hydrated: false,
};

export const useSettingsStore = create<SettingsState & SettingsActions>()(
  persist(
    (set) => ({
      ...initialState,

      setLocale: async (locale) => {
        await applyLocale(locale);
        set({ locale });
      },
      setColorScheme: (colorScheme) => set({ colorScheme }),
      setHapticsEnabled: (hapticsEnabled) => set({ hapticsEnabled }),
      setReminders: (remindersEnabled, hour) =>
        set((state) => ({
          remindersEnabled,
          reminderHour: hour ?? state.reminderHour,
        })),
      setActiveCourse: (activeCourse) => set({ activeCourse }),
      setDailyGoal: (dailyGoalXp) => set({ dailyGoalXp }),
      setExperienceLevel: (experienceLevel) => set({ experienceLevel }),
      completeOnboarding: () => set({ onboardingCompleted: true }),
      markPaywallSeen: () => set({ lastPaywallAt: Date.now() }),
      reset: () => set({ ...initialState, hydrated: true }),
    }),
    {
      name: 'codeling.settings',
      storage: createJSONStorage(() => AsyncStorage),
      version: 1,
      partialize: ({ hydrated: _hydrated, ...rest }) => rest,
      onRehydrateStorage: () => (state) => {
        // Push the restored locale into i18n before the first screen renders.
        if (state?.locale) void applyLocale(state.locale);
        useSettingsStore.setState({ hydrated: true });
      },
    }
  )
);

/** Read settings outside React (services, notification handlers). */
export const settingsSnapshot = () => useSettingsStore.getState();
