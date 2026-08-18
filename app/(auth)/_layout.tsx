/**
 * Auth layout.
 *
 * One screen, no header: sign-in is the only thing that happens here.
 *
 * @module app/(auth)/_layout
 */

import { Stack } from 'expo-router';

export default function AuthLayout() {
  return <Stack screenOptions={{ headerShown: false, gestureEnabled: false }} />;
}
