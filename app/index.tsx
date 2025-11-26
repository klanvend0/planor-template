/**
 * Root Index Screen
 *
 * This screen is a placeholder that redirects based on auth state.
 * The actual routing is handled by useProtectedRoute in _layout.tsx.
 *
 * @module app/index
 */

import { View, ActivityIndicator } from 'react-native';
import { Redirect } from 'expo-router';
import { useAuthStore } from '@/stores/auth_store';

export default function IndexScreen() {
  const { isAuthenticated, isLoading } = useAuthStore();

  // Show loading while checking auth
  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator size="large" />
      </View>
    );
  }

  // Redirect based on auth state
  if (isAuthenticated) {
    return <Redirect href="/(protected)" />;
  }

  return <Redirect href="/(auth)/login" />;
}
