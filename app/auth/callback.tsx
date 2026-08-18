/**
 * OAuth callback.
 *
 * The in-app browser normally intercepts `codeling://auth/callback` before the
 * OS ever routes to it, and `lib/auth.ts` sets the session from the URL it gets
 * back. This screen is the fallback for when the OS delivers the link to a cold
 * app instead — without it, a successful sign-in would land on "not found".
 *
 * @module app/auth/callback
 */

import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { GameButton } from '@/components/game_button';
import { Text } from '@/components/ui/text';
import { useTranslation } from '@/hooks/use_translation';
import { supabase } from '@/lib/supabase';

export default function AuthCallbackScreen() {
  const { t } = useTranslation();
  const params = useLocalSearchParams<{
    access_token?: string;
    refresh_token?: string;
    error_description?: string;
  }>();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const complete = async () => {
      if (params.access_token && params.refresh_token) {
        const { error } = await supabase.auth.setSession({
          access_token: params.access_token,
          refresh_token: params.refresh_token,
        });
        if (!error) {
          router.replace('/(app)');
          return;
        }
      }

      // No usable tokens: fall back to the sign-in screen rather than hanging.
      setFailed(true);
    };

    void complete();
  }, [params.access_token, params.refresh_token]);

  if (!failed) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <View className="flex-1 items-center justify-center gap-5 bg-background px-8">
      <Text className="text-center font-display text-xl text-foreground">
        {params.error_description ?? t('auth.google_error')}
      </Text>
      <GameButton label={t('auth.sign_in')} onPress={() => router.replace('/(auth)/login')} />
    </View>
  );
}
