/**
 * Signed-in layout.
 *
 * Three tabs — learn, practice, profile — behind an auth guard: anyone without a
 * session is sent back to sign-in rather than shown an empty shell.
 *
 * @module app/(app)/_layout
 */

import { Redirect, Tabs } from 'expo-router';

import { GameTabBar } from '@/components/tab_bar';
import { useTranslation } from '@/hooks/use_translation';
import { useAuthStore } from '@/stores/auth_store';

export default function AppLayout() {
  const { t } = useTranslation();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);

  if (!isAuthenticated) return <Redirect href="/(auth)/login" />;

  return (
    <Tabs screenOptions={{ headerShown: false }} tabBar={(props) => <GameTabBar {...props} />}>
      <Tabs.Screen name="index" options={{ title: t('learn.title') }} />
      <Tabs.Screen name="practice" options={{ title: t('practice.title') }} />
      <Tabs.Screen name="profile" options={{ title: t('profile.title') }} />
    </Tabs>
  );
}
