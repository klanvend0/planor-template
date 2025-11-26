/**
 * Login Screen
 *
 * Presents social authentication options (Google, Apple).
 * Users are redirected here when not authenticated.
 *
 * @module app/(auth)/login
 */

import { View, Alert, Platform } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/ui/text';
import { GoogleSignInButton, AppleSignInButton } from '@/components/auth';
import { t } from '@/lib/i18n';

export default function LoginScreen() {
  const insets = useSafeAreaInsets();

  const handleSuccess = () => {
    // Auth state change will trigger navigation automatically
    // via the root layout's useEffect
    router.replace('/(protected)');
  };

  const handleError = (error: string) => {
    Alert.alert(t('auth.sign_in'), error);
  };

  return (
    <View
      className="flex-1 bg-background"
      style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}>
      {/* Header */}
      <View className="flex-1 items-center justify-center px-6">
        <Text className="mb-2 text-center text-4xl font-bold text-foreground">{t('welcome')}</Text>
        <Text className="mb-12 text-center text-muted-foreground">
          {t('auth.sign_in_subtitle')}
        </Text>

        {/* Social Sign-In Buttons */}
        <View className="w-full max-w-sm gap-4">
          <GoogleSignInButton onSuccess={handleSuccess} onError={handleError} />

          {Platform.OS === 'ios' && (
            <AppleSignInButton onSuccess={handleSuccess} onError={handleError} />
          )}
        </View>
      </View>

      {/* Footer */}
      <View className="px-6 pb-4">
        <Text className="text-center text-xs text-muted-foreground">{t('auth.terms_notice')}</Text>
      </View>
    </View>
  );
}
