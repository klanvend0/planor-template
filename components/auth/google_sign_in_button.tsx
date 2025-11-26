/**
 * Google Sign-In Button Component
 *
 * A cross-platform Google Sign-In button that works on iOS, Android, and web.
 * Uses Supabase OAuth flow with expo-web-browser for authentication.
 *
 * @module components/auth/google_sign_in_button
 */

import { useState } from 'react';
import { View, TouchableOpacity, ActivityIndicator } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { useColorScheme } from 'nativewind';
import { SvgXml } from 'react-native-svg';

import { signInWithGoogle } from '@/lib/auth';
import { t } from '@/lib/i18n';
import { Text } from '@/components/ui/text';

// Ensure WebBrowser auth session completes properly
WebBrowser.maybeCompleteAuthSession();

/**
 * Google "G" logo SVG
 * Official Google brand colors
 */
const GoogleLogo = `
<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
</svg>
`;

type GoogleSignInButtonProps = {
  /** Callback fired on successful authentication */
  onSuccess?: () => void;
  /** Callback fired on authentication error */
  onError?: (error: string) => void;
};

/**
 * Google Sign-In Button
 *
 * Cross-platform button that initiates Google OAuth flow through Supabase.
 * Opens a web browser for authentication, then Supabase redirects back
 * to the app using the configured deep link.
 *
 * @example
 * ```tsx
 * <GoogleSignInButton
 *   onSuccess={() => router.replace('/(tabs)')}
 *   onError={(error) => Alert.alert('Error', error)}
 * />
 * ```
 */
export function GoogleSignInButton({ onSuccess, onError }: GoogleSignInButtonProps) {
  const { colorScheme } = useColorScheme();
  const [isLoading, setIsLoading] = useState(false);

  const handlePress = async () => {
    if (isLoading) return;

    setIsLoading(true);
    try {
      const result = await signInWithGoogle();

      if (result.success) {
        onSuccess?.();
      } else if (result.error) {
        // Don't show error for user cancellation
        if (!result.error.includes('cancelled')) {
          onError?.(result.error);
        }
      }
    } catch (error) {
      console.error('Google sign-in error:', error);
      onError?.(t('auth.google_error'));
    } finally {
      setIsLoading(false);
    }
  };

  const isDark = colorScheme === 'dark';

  return (
    <TouchableOpacity
      onPress={handlePress}
      disabled={isLoading}
      activeOpacity={0.8}
      className={`w-full flex-row items-center justify-center rounded-lg border px-4 py-3 ${isDark ? 'border-border bg-card' : 'border-gray-300 bg-white'} ${isLoading ? 'opacity-50' : ''} `}>
      {isLoading ? (
        <ActivityIndicator size="small" color={isDark ? '#fff' : '#000'} className="mr-3" />
      ) : (
        <View className="mr-3">
          <SvgXml xml={GoogleLogo} width={24} height={24} />
        </View>
      )}
      <Text className={`text-base font-medium ${isDark ? 'text-foreground' : 'text-gray-700'}`}>
        {t('auth.sign_in_with_google')}
      </Text>
    </TouchableOpacity>
  );
}

export default GoogleSignInButton;
