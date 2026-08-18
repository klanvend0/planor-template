/**
 * Sign-in.
 *
 * Apple and Google only — no passwords to forget. Apple sign-in is listed first
 * on iOS and is mandatory there while Google is offered (App Store Review 4.8).
 *
 * On success the answers collected during onboarding are pushed into `profiles`,
 * so a learner who signs in on a second device keeps their language, course and
 * daily goal.
 *
 * @module app/(auth)/login
 */

import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Platform, View } from 'react-native';
import { useColorScheme } from 'nativewind';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GameButton } from '@/components/game_button';
import { WelcomeIllustration } from '@/components/onboarding/illustrations';
import { Text } from '@/components/ui/text';
import { useTranslation } from '@/hooks/use_translation';
import { signInWithApple, signInWithGoogle, type AuthResult } from '@/lib/auth';
import { LINKS } from '@/lib/constants';
import { openExternal } from '@/lib/links';
import { updateProfile } from '@/services/progress_service';
import { useAuthStore } from '@/stores/auth_store';
import { useSettingsStore } from '@/stores/settings_store';

export default function LoginScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { colorScheme } = useColorScheme();
  const [busy, setBusy] = useState<'apple' | 'google' | null>(null);

  const settings = useSettingsStore();

  /**
   * Mirror the onboarding answers onto the freshly created profile row. Failure
   * is not fatal — the local copy still drives the app.
   */
  const syncProfile = async () => {
    const userId = useAuthStore.getState().user?.id;
    if (!userId) return;
    try {
      await updateProfile(userId, {
        locale: settings.locale,
        activeCourse: settings.activeCourse,
        dailyGoalXp: settings.dailyGoalXp,
        experienceLevel: settings.experienceLevel,
        reminderHour: settings.remindersEnabled ? settings.reminderHour : null,
        onboardingCompleted: true,
      });
    } catch (error) {
      console.warn('[login] profile sync failed', error);
    }
  };

  const handle = async (provider: 'apple' | 'google', run: () => Promise<AuthResult>) => {
    setBusy(provider);
    try {
      const result = await run();
      if (result.success) {
        await syncProfile();
        router.replace('/(app)');
        return;
      }
      if (result.reason === 'cancelled') return;

      Alert.alert(
        t('auth.sign_in'),
        result.reason === 'unavailable'
          ? t('auth.apple_not_available')
          : (result.error ?? t('errors.generic'))
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <View
      className="flex-1 bg-background px-6"
      style={{ paddingTop: insets.top + 24, paddingBottom: insets.bottom + 16 }}>
      <View className="flex-1 items-center justify-center gap-8">
        <WelcomeIllustration width={260} scheme={colorScheme ?? 'light'} />

        <View className="gap-3">
          <Text className="text-center font-display text-[28px] leading-9 text-foreground">
            {t('auth.sign_in_title')}
          </Text>
          <Text className="text-center text-[15px] leading-6 text-muted-foreground">
            {t('auth.sign_in_subtitle')}
          </Text>
        </View>
      </View>

      <View className="gap-3">
        {Platform.OS === 'ios' ? (
          <GameButton
            label={t('auth.sign_in_with_apple')}
            size="lg"
            busy={busy === 'apple'}
            disabled={busy !== null}
            onPress={() => void handle('apple', signInWithApple)}
          />
        ) : null}

        <GameButton
          label={t('auth.sign_in_with_google')}
          variant={Platform.OS === 'ios' ? 'secondary' : 'primary'}
          size="lg"
          busy={busy === 'google'}
          disabled={busy !== null}
          onPress={() => void handle('google', signInWithGoogle)}
        />

        <Text className="px-2 pt-2 text-center text-xs leading-5 text-muted-foreground">
          {t('auth.terms_notice')}
        </Text>

        <View className="flex-row items-center justify-center gap-6 pt-1">
          <Text
            className="font-strong text-xs text-muted-foreground underline"
            onPress={() => void openExternal(LINKS.terms)}>
            {t('paywall.terms')}
          </Text>
          <Text
            className="font-strong text-xs text-muted-foreground underline"
            onPress={() => void openExternal(LINKS.privacy)}>
            {t('paywall.privacy')}
          </Text>
        </View>
      </View>
    </View>
  );
}
