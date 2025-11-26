/**
 * Auth Layout
 *
 * Layout for authentication screens (login, register, etc.)
 * This layout is shown when the user is not authenticated.
 *
 * @module app/(auth)/_layout
 */

import { Stack } from 'expo-router';

export default function AuthLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: 'transparent' },
      }}
    />
  );
}
