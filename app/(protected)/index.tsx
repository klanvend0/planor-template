/**
 * Protected Home Screen
 *
 * Main screen shown after successful authentication.
 * This is a placeholder that can be customized based on app needs.
 *
 * @module app/(protected)/index
 */

import { View, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/ui/text';
import { Button } from '@/components/ui/button';
import { signOut } from '@/lib/auth';
import { useAuthStore } from '@/stores/auth_store';
import { t } from '@/lib/i18n';

export default function ProtectedHomeScreen() {
  const insets = useSafeAreaInsets();
  const user = useAuthStore((state) => state.user);

  const handleSignOut = async () => {
    const result = await signOut();
    if (!result.success && result.error) {
      Alert.alert(t('auth.sign_out'), result.error);
    }
    // Navigation will be handled by auth state change
  };

  return (
    <View
      className="flex-1 items-center justify-center bg-background px-6"
      style={{ paddingBottom: insets.bottom }}>
      <Text className="mb-2 text-center text-2xl font-bold text-foreground">
        {t('protected.welcome_back')}
      </Text>

      {user?.email && <Text className="mb-8 text-center text-muted-foreground">{user.email}</Text>}

      <View className="w-full max-w-sm">
        <Button onPress={handleSignOut} variant="outline">
          <Text>{t('auth.sign_out')}</Text>
        </Button>
      </View>
    </View>
  );
}
