/**
 * Unmatched route.
 *
 * Reachable from a stale deep link or a lesson id that no longer exists after a
 * content update, so it offers a way back rather than a dead end.
 *
 * @module app/+not-found
 */

import { router } from 'expo-router';
import { View } from 'react-native';

import { GameButton } from '@/components/game_button';
import { Text } from '@/components/ui/text';
import { useTranslation } from '@/hooks/use_translation';

export default function NotFoundScreen() {
  const { t } = useTranslation();

  return (
    <View className="flex-1 items-center justify-center gap-5 bg-background px-8">
      <Text className="text-center font-display text-2xl text-foreground">
        {t('errors.generic')}
      </Text>
      <GameButton label={t('learn.title')} onPress={() => router.replace('/(app)')} />
    </View>
  );
}
