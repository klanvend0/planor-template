/**
 * Onboarding layout.
 *
 * A single screen drives the whole flow, so this only strips the header and
 * disables the back gesture — stepping back is handled inside the flow, where it
 * can rewind one question at a time.
 *
 * @module app/(onboarding)/_layout
 */

import { Stack } from 'expo-router';

export default function OnboardingLayout() {
  return <Stack screenOptions={{ headerShown: false, gestureEnabled: false }} />;
}
