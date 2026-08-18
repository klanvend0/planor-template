/**
 * Entry route.
 *
 * Sends the learner to the right place: onboarding until they have chosen a
 * language and a course, sign-in until they have an account, the learn map after
 * that. Bootstrapping already finished in the root layout, so this is a pure
 * redirect with no loading state of its own.
 *
 * @module app/index
 */

import { Redirect } from 'expo-router';

import { useAuthStore } from '@/stores/auth_store';
import { useSettingsStore } from '@/stores/settings_store';

export default function IndexScreen() {
  const onboardingCompleted = useSettingsStore((state) => state.onboardingCompleted);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);

  if (!onboardingCompleted) return <Redirect href="/(onboarding)" />;
  if (!isAuthenticated) return <Redirect href="/(auth)/login" />;
  return <Redirect href="/(app)" />;
}
