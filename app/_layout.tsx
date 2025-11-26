import '@/global.css';

import { useEffect } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { NAV_THEME } from '@/lib/theme';
import { ThemeProvider } from '@react-navigation/native';
import { PortalHost } from '@rn-primitives/portal';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useColorScheme } from 'nativewind';
import * as SplashScreen from 'expo-splash-screen';

export {
  // Catch any errors thrown by the Layout component.
  ErrorBoundary,
} from 'expo-router';

import { posthog } from '@/lib/posthog';
// import { configureSuperwall } from '@/lib/superwall'; // Disabled - doesn't work with Expo Go
import { PostHogProvider } from 'posthog-react-native';
import { useAuthStore } from '@/stores/auth_store';

// Prevent splash screen from auto-hiding
SplashScreen.preventAutoHideAsync();

/**
 * Hook to handle auth-based navigation
 * Redirects to login if not authenticated, or to protected area if authenticated
 */
function useProtectedRoute() {
  const segments = useSegments();
  const router = useRouter();
  const { isAuthenticated, isLoading } = useAuthStore();

  useEffect(() => {
    if (isLoading) return;

    const inAuthGroup = segments[0] === '(auth)';
    const inProtectedGroup = segments[0] === '(protected)';

    if (!isAuthenticated && !inAuthGroup) {
      // Redirect to login if not authenticated
      router.replace('/(auth)/login');
    } else if (isAuthenticated && inAuthGroup) {
      // Redirect to protected area if authenticated
      router.replace('/(protected)');
    } else if (!isAuthenticated && inProtectedGroup) {
      // Redirect to login if not authenticated but trying to access protected
      router.replace('/(auth)/login');
    }
  }, [isAuthenticated, isLoading, segments]);
}

function RootNavigator() {
  const { isLoading } = useAuthStore();

  useProtectedRoute();

  // Show loading screen while checking auth
  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="(protected)" />
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="+not-found" />
    </Stack>
  );
}

export default function RootLayout() {
  const { colorScheme } = useColorScheme();
  const initialize = useAuthStore((state) => state.initialize);

  // Initialize auth on mount
  useEffect(() => {
    async function init() {
      await initialize();
      // Hide splash screen after auth is initialized
      SplashScreen.hideAsync();
    }
    init();
  }, []);

  const content = (
    <ThemeProvider value={NAV_THEME[colorScheme ?? 'light']}>
      <StatusBar style={colorScheme === 'dark' ? 'light' : 'dark'} />
      <RootNavigator />
      <PortalHost />
    </ThemeProvider>
  );

  if (posthog) {
    return <PostHogProvider client={posthog}>{content}</PostHogProvider>;
  }

  return content;
}
