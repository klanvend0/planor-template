/**
 * Apple Sign-In Button Component
 *
 * A native Apple Sign-In button that only renders on iOS devices.
 * Uses expo-apple-authentication for the native Apple Sign-In experience.
 *
 * @module components/auth/apple_sign_in_button
 */

import * as AppleAuthentication from 'expo-apple-authentication';
import { useEffect, useState } from 'react';
import { Platform, View, ActivityIndicator } from 'react-native';
import { useColorScheme } from 'nativewind';

import { signInWithApple } from '@/lib/auth';
import { t } from '@/lib/i18n';
import { Text } from '@/components/ui/text';

type AppleSignInButtonProps = {
  /** Callback fired on successful authentication */
  onSuccess?: () => void;
  /** Callback fired on authentication error */
  onError?: (error: string) => void;
};

/**
 * Apple Sign-In Button
 *
 * Renders the native Apple Sign-In button on iOS devices.
 * Returns null on non-iOS platforms.
 *
 * @example
 * ```tsx
 * <AppleSignInButton
 *   onSuccess={() => router.replace('/(tabs)')}
 *   onError={(error) => Alert.alert('Error', error)}
 * />
 * ```
 */
export function AppleSignInButton({ onSuccess, onError }: AppleSignInButtonProps) {
  const { colorScheme } = useColorScheme();
  const [isAvailable, setIsAvailable] = useState<boolean | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Check if Apple Sign-In is available on mount
  useEffect(() => {
    async function checkAvailability() {
      if (Platform.OS !== 'ios') {
        setIsAvailable(false);
        return;
      }
      const available = await AppleAuthentication.isAvailableAsync();
      setIsAvailable(available);
    }
    checkAvailability();
  }, []);

  // Don't render on non-iOS platforms or if not available
  if (Platform.OS !== 'ios' || isAvailable === false) {
    return null;
  }

  // Show loading indicator while checking availability
  if (isAvailable === null) {
    return (
      <View className="h-12 items-center justify-center">
        <ActivityIndicator size="small" />
      </View>
    );
  }

  const handlePress = async () => {
    if (isLoading) return;

    setIsLoading(true);
    try {
      const result = await signInWithApple();

      if (result.success) {
        onSuccess?.();
      } else if (result.error) {
        onError?.(result.error);
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <View className="w-full">
      {isLoading ? (
        <View className="h-12 items-center justify-center rounded-lg bg-black dark:bg-white">
          <ActivityIndicator size="small" color={colorScheme === 'dark' ? '#000' : '#fff'} />
        </View>
      ) : (
        <AppleAuthentication.AppleAuthenticationButton
          buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
          buttonStyle={
            colorScheme === 'dark'
              ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE
              : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK
          }
          cornerRadius={8}
          style={{ width: '100%', height: 48 }}
          onPress={handlePress}
        />
      )}
    </View>
  );
}

export default AppleSignInButton;
