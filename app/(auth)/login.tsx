/**
 * Sign-in.
 *
 * Apple and Google only — no passwords to forget. Apple sign-in is listed first
 * on iOS and is mandatory there while Google is offered (App Store Review 4.8).
 *
 * With no Supabase project configured there is nothing to sign in to, so the
 * screen offers to start playing on the device instead of showing two buttons
 * that could only fail.
 *
 * On success the answers collected during onboarding are pushed into `profiles`,
 * so a learner who signs in on a second device keeps their language, course and
 * daily goal.
 *
 * @module app/(auth)/login
 */

import * as AppleAuthentication from 'expo-apple-authentication';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Platform, View } from 'react-native';
import { useColorScheme } from 'nativewind';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GameButton } from '@/components/game_button';
import { WelcomeIllustration } from '@/components/onboarding/illustrations';
import { Text } from '@/components/ui/text';
import { useTranslation } from '@/hooks/use_translation';
import { USES_LOCAL_BACKEND } from '@/lib/backend_mode';
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
  const [busy, setBusy] = useState<'apple' | 'google' | 'local' | null>(null);
  const startLocalSession = useAuthStore((state) => state.startLocalSession);

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

  const startLocally = async () => {
    setBusy('local');
    try {
      await startLocalSession();
      await syncProfile();
      router.replace('/(app)');
    } catch (error) {
      // The device refused to write, so there is no learner to start. Saying so
      // beats a button that goes quiet.
      console.warn('[login] could not start a local session', error);
      Alert.alert(t('auth.sign_in'), t('errors.generic'));
    } finally {
      setBusy(null);
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

      // The provider's message is English and technical ("No identity token
      // received from Apple"), so it goes to the log and the learner is told
      // what happened in their own language.
      if (result.error) console.warn(`[login] ${provider} sign-in failed`, result.error);

      Alert.alert(
        t('auth.sign_in'),
        result.reason === 'unavailable'
          ? t('auth.apple_not_available')
          : provider === 'apple'
            ? t('auth.apple_error')
            : t('auth.google_error')
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
            {USES_LOCAL_BACKEND ? t('auth.local_notice') : t('auth.sign_in_subtitle')}
          </Text>
        </View>
      </View>

      <View className="gap-3">
        {USES_LOCAL_BACKEND ? (
          <GameButton
            label={t('auth.start_local')}
            size="lg"
            busy={busy === 'local'}
            disabled={busy !== null}
            onPress={() => void startLocally()}
          />
        ) : (
          <>
            {/* Apple's own button, not a lookalike: Guideline 4.8 and the Sign
                in with Apple guidelines require its mark, its wording and its
                proportions, which a themed button cannot carry. */}
            {Platform.OS === 'ios' ? (
              <View
                pointerEvents={busy === null ? 'auto' : 'none'}
                style={{ opacity: busy === null ? 1 : 0.6 }}>
                <AppleAuthentication.AppleAuthenticationButton
                  buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
                  buttonStyle={
                    colorScheme === 'dark'
                      ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE
                      : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK
                  }
                  cornerRadius={12}
                  style={{ height: 52, width: '100%' }}
                  onPress={() => void handle('apple', signInWithApple)}
                />
              </View>
            ) : null}

            <GameButton
              label={t('auth.sign_in_with_google')}
              variant={Platform.OS === 'ios' ? 'secondary' : 'primary'}
              size="lg"
              busy={busy === 'google'}
              disabled={busy !== null}
              onPress={() => void handle('google', signInWithGoogle)}
            />
          </>
        )}

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
