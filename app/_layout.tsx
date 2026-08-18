/**
 * Root layout.
 *
 * Holds the splash screen until fonts, locale, preferences, session and the
 * store SDK are ready, then hands over to the route group the learner belongs
 * in: onboarding, sign-in, or the app itself.
 *
 * @module app/_layout
 */

import '@/global.css';

import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  Inter_800ExtraBold,
} from '@expo-google-fonts/inter';
import {
  JetBrainsMono_400Regular,
  JetBrainsMono_700Bold,
} from '@expo-google-fonts/jetbrains-mono';
import { PortalHost } from '@rn-primitives/portal';
import { useFonts } from 'expo-font';
import { Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useColorScheme } from 'nativewind';
import { PostHogProvider } from 'posthog-react-native';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useAppBootstrap } from '@/hooks/use_app_bootstrap';
import { posthog } from '@/lib/posthog';
import { NAV_THEME } from '@/lib/theme';
import { useSettingsStore } from '@/stores/settings_store';

export { ErrorBoundary } from 'expo-router';

SplashScreen.preventAutoHideAsync();

/** Applies the learner's appearance preference to NativeWind. */
function useAppearance() {
  const preference = useSettingsStore((state) => state.colorScheme);
  const { colorScheme, setColorScheme } = useColorScheme();

  useEffect(() => {
    setColorScheme(preference);
  }, [preference, setColorScheme]);

  return colorScheme ?? 'light';
}

export default function RootLayout() {
  const scheme = useAppearance();
  const { isReady } = useAppBootstrap();

  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    Inter_800ExtraBold,
    JetBrainsMono_400Regular,
    JetBrainsMono_700Bold,
  });

  // A missing font must not strand the learner on the splash screen.
  const canRender = isReady && (fontsLoaded || !!fontError);

  useEffect(() => {
    if (canRender) void SplashScreen.hideAsync();
  }, [canRender]);

  if (!canRender) return null;

  const content = (
    <ThemeProvider value={NAV_THEME[scheme]}>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="(onboarding)" />
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(app)" />
        <Stack.Screen
          name="lesson/[lessonId]"
          options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom' }}
        />
        <Stack.Screen
          name="practice/[deck]"
          options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom' }}
        />
        <Stack.Screen
          name="paywall"
          options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
        />
        <Stack.Screen name="settings" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="+not-found" />
      </Stack>
      <PortalHost />
    </ThemeProvider>
  );

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        {posthog ? <PostHogProvider client={posthog}>{content}</PostHogProvider> : content}
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
