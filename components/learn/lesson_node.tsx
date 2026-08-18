/**
 * A lesson on the learn path.
 *
 * The single most-tapped control in the app, so it is deliberately large (72pt),
 * carries its state in shape and colour rather than text, and shows how well the
 * lesson was cleared with stars underneath.
 *
 * @module components/learn/lesson_node
 */

import { Check, Crown, Lock, Play, Star } from 'lucide-react-native';
import { Pressable, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';

import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { tapFeedback } from '@/lib/haptics';
import { cn } from '@/lib/utils';
import type { LessonStatus } from '@/stores/progress_store';

export type LessonNodeProps = {
  title: string;
  status: LessonStatus;
  /** Stars earned, 0-3. */
  stars?: number;
  /** True for the lesson the learner should do next. */
  isCurrent?: boolean;
  onPress: () => void;
  /** Horizontal offset in points, to draw the path as a gentle zig-zag. */
  offset?: number;
};

export function LessonNode({
  title,
  status,
  stars = 0,
  isCurrent = false,
  onPress,
  offset = 0,
}: LessonNodeProps) {
  const halo = useSharedValue(0);

  // The next lesson breathes, so the eye lands on it without a label saying so.
  const haloStyle = useAnimatedStyle(() => ({
    opacity: 0.15 + halo.value * 0.25,
    transform: [{ scale: 1 + halo.value * 0.12 }],
  }));

  if (isCurrent && halo.value === 0) {
    halo.value = withRepeat(withTiming(1, { duration: 1400 }), -1, true);
  }

  const locked = status === 'locked' || status === 'premium_locked';

  return (
    <View className="items-center" style={{ transform: [{ translateX: offset }] }}>
      <View className="h-[76px] w-[76px] items-center justify-center">
        {isCurrent ? (
          <Animated.View
            style={haloStyle}
            className="absolute h-[76px] w-[76px] rounded-full bg-primary"
          />
        ) : null}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={title}
          accessibilityState={{ disabled: status === 'locked' }}
          onPress={() => {
            void tapFeedback();
            onPress();
          }}
          className={cn(
            'h-16 w-16 items-center justify-center rounded-full border-b-4',
            status === 'completed' && 'border-success/50 bg-success',
            status === 'available' && 'border-primary/50 bg-primary',
            status === 'locked' && 'border-muted-foreground/20 bg-muted',
            status === 'premium_locked' && 'border-warning/50 bg-warning',
            'active:translate-y-[3px] active:border-b-0'
          )}>
          <Icon
            as={
              status === 'completed'
                ? Check
                : status === 'premium_locked'
                  ? Crown
                  : status === 'locked'
                    ? Lock
                    : Play
            }
            size={26}
            className={cn(
              status === 'completed' && 'text-success-foreground',
              status === 'available' && 'text-primary-foreground',
              status === 'locked' && 'text-muted-foreground',
              status === 'premium_locked' && 'text-warning-foreground'
            )}
            fill={status === 'available' ? 'currentColor' : 'transparent'}
          />
        </Pressable>
      </View>

      {status === 'completed' ? (
        <View className="mt-1 flex-row gap-0.5">
          {[0, 1, 2].map((index) => (
            <Icon
              key={index}
              as={Star}
              size={12}
              className={index < stars ? 'text-warning' : 'text-muted-foreground/30'}
              fill={index < stars ? 'currentColor' : 'transparent'}
            />
          ))}
        </View>
      ) : null}

      <Text
        numberOfLines={2}
        className={cn(
          'mt-1 w-[104px] text-center text-xs font-semibold',
          locked ? 'text-muted-foreground' : 'text-foreground'
        )}>
        {title}
      </Text>
    </View>
  );
}
