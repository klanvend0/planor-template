/**
 * Protected Layout
 *
 * Layout for authenticated screens. This layout is only accessible
 * when the user is authenticated. Includes common navigation elements
 * and auth-required features.
 *
 * @module app/(protected)/_layout
 */

import { Stack } from 'expo-router';

export default function ProtectedLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: true,
      }}
    />
  );
}
