/**
 * Onboarding choice row.
 *
 * One tappable card per option, big enough to hit without looking, with the
 * selected state carried by border and fill rather than a small check mark.
 *
 * @module components/onboarding/choice_card
 */

import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { tapFeedback } from '@/lib/haptics';
import { cn } from '@/lib/utils';

export function ChoiceCard({
  title,
  subtitle,
  selected,
  onPress,
  leading,
  trailing,
  className,
}: {
  title: string;
  subtitle?: string;
  selected: boolean;
  onPress: () => void;
  leading?: ReactNode;
  trailing?: ReactNode;
  className?: string;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={() => {
        void tapFeedback();
        onPress();
      }}
      className={cn(
        'flex-row items-center gap-4 rounded-2xl border-2 border-border bg-card px-4 py-4',
        selected && 'border-primary bg-primary/10',
        className
      )}>
      {leading}
      <View className="flex-1 gap-0.5">
        <Text className={cn('font-bold text-[17px] text-foreground')}>{title}</Text>
        {subtitle ? <Text className="text-sm text-muted-foreground">{subtitle}</Text> : null}
      </View>
      {trailing}
    </Pressable>
  );
}
