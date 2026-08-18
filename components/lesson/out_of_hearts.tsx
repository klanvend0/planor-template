/**
 * Out-of-hearts state.
 *
 * A stop, not a dead end: the learner can wait (with the countdown running),
 * spend their free daily refill, practise old mistakes for nothing, or subscribe
 * for unlimited hearts. Every option is on screen at once.
 *
 * @module components/lesson/out_of_hearts
 */

import { HeartCrack } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { GameButton } from '@/components/game_button';
import { HeartsRow } from '@/components/game_hud';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { useTranslation } from '@/hooks/use_translation';
import { formatCountdown, msUntilNextHeart } from '@/lib/gamification';

export function OutOfHearts({
  heartsUpdatedAt,
  onRefill,
  onPractice,
  onUpgrade,
  onClose,
  refillBusy = false,
  refillAvailable = true,
}: {
  heartsUpdatedAt: string;
  onRefill: () => void;
  onPractice: () => void;
  onUpgrade: () => void;
  onClose: () => void;
  refillBusy?: boolean;
  refillAvailable?: boolean;
}) {
  const { t } = useTranslation();
  const [remaining, setRemaining] = useState(() => msUntilNextHeart(0, heartsUpdatedAt));

  // The countdown is the only thing on this screen that changes by itself, so it
  // gets its own second-resolution timer rather than a global one.
  useEffect(() => {
    const timer = setInterval(() => {
      setRemaining(msUntilNextHeart(0, heartsUpdatedAt));
    }, 1000);
    return () => clearInterval(timer);
  }, [heartsUpdatedAt]);

  return (
    <View className="flex-1 items-center justify-center gap-6 px-6">
      <View className="h-24 w-24 items-center justify-center rounded-full bg-destructive/15">
        <Icon as={HeartCrack} size={44} className="text-destructive" />
      </View>

      <View className="gap-2">
        <Text className="text-center font-display text-[26px] leading-8 text-foreground">
          {t('hearts.empty_title')}
        </Text>
        <Text className="text-center text-[15px] leading-6 text-muted-foreground">
          {t('hearts.empty_body')}
        </Text>
      </View>

      <HeartsRow hearts={0} />

      <Text className="font-strong text-sm text-muted-foreground">
        {t('hearts.next_in', { time: formatCountdown(remaining) })}
      </Text>

      <View className="w-full gap-3 pt-2">
        <GameButton label={t('hearts.go_pro')} onPress={onUpgrade} size="lg" />
        <GameButton
          label={refillAvailable ? t('hearts.refill') : t('hearts.refill_free_used')}
          variant="secondary"
          onPress={onRefill}
          disabled={!refillAvailable}
          busy={refillBusy}
        />
        <GameButton
          label={t('hearts.practice_instead')}
          variant="ghost"
          onPress={onPractice}
          flat
        />
        <GameButton label={t('common.close')} variant="ghost" onPress={onClose} flat />
      </View>
    </View>
  );
}
