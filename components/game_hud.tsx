/**
 * Heads-up display pieces.
 *
 * The small persistent readouts a learner glances at constantly: the lesson
 * progress bar, hearts, the streak flame, an XP pill and the level ring. Kept in
 * one module because they share a visual language and are always used together.
 *
 * @module components/game_hud
 */

import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';
import { Flame, Heart, Infinity as InfinityIcon, Zap } from 'lucide-react-native';

import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { useTranslation } from '@/hooks/use_translation';
import { MAX_HEARTS } from '@/lib/gamification';
import { DURATION, METER, POP_SPRING } from '@/lib/motion';
import { themeTokens } from '@/lib/theme';
import { cn } from '@/lib/utils';

/**
 * Lesson progress.
 *
 * Animated with a spring so a correct answer feels like it *pushes* the bar
 * forward rather than teleporting it.
 */
export function ProgressBar({
  progress,
  className,
  tone = 'primary',
}: {
  /** 0..1. */
  progress: number;
  className?: string;
  tone?: 'primary' | 'success' | 'xp';
}) {
  const width = useSharedValue(0);

  useEffect(() => {
    // Width is the one property the design system allows animating, because
    // here it carries information rather than decoration.
    width.value = withTiming(Math.max(0, Math.min(1, progress)), {
      duration: 700,
      easing: METER,
    });
  }, [progress, width]);

  const style = useAnimatedStyle(() => ({ width: `${width.value * 100}%` }));

  return (
    <View
      className={cn('h-3 flex-1 overflow-hidden rounded-full bg-muted', className)}
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(progress * 100) }}>
      <Animated.View
        style={style}
        className={cn(
          'h-full rounded-full',
          tone === 'primary' && 'bg-primary',
          tone === 'success' && 'bg-success',
          tone === 'xp' && 'bg-xp'
        )}
      />
    </View>
  );
}

/** Hearts left, or an infinity glyph for subscribers. */
export function HeartsIndicator({
  hearts,
  unlimited = false,
  className,
}: {
  hearts: number;
  unlimited?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const scale = useSharedValue(1);

  useEffect(() => {
    // A lost heart should be felt: pop, then settle.
    scale.value = withSpring(1.18, POP_SPRING, () => {
      scale.value = withTiming(1, { duration: DURATION.stateChange });
    });
  }, [hearts, scale]);

  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Animated.View
      style={style}
      className={cn('flex-row items-center gap-1.5', className)}
      // A bare numeral reads as "5" to VoiceOver, which says nothing about what
      // is running out; the plural key spells it out.
      accessible
      accessibilityLabel={
        unlimited
          ? t('learn.hearts_unlimited')
          : t('learn.hearts_left', { count: Math.max(0, hearts) })
      }>
      <Icon as={Heart} size={20} className="text-destructive" fill="currentColor" />
      {unlimited ? (
        <Icon as={InfinityIcon} size={18} className="text-destructive" />
      ) : (
        <Text className="font-num text-base text-foreground">{Math.max(0, hearts)}</Text>
      )}
    </Animated.View>
  );
}

/** Hearts drawn as individual pips, for the results and hearts sheet. */
export function HeartsRow({ hearts, className }: { hearts: number; className?: string }) {
  return (
    <View className={cn('flex-row items-center gap-1', className)}>
      {Array.from({ length: MAX_HEARTS }).map((_, index) => (
        <Icon
          key={index}
          as={Heart}
          size={18}
          className={index < hearts ? 'text-destructive' : 'text-muted-foreground/35'}
          fill={index < hearts ? 'currentColor' : 'transparent'}
        />
      ))}
    </View>
  );
}

/** Current streak, with the flame lit only once the streak is alive. */
export function StreakBadge({
  days,
  className,
  size = 'md',
}: {
  days: number;
  className?: string;
  size?: 'sm' | 'md';
}) {
  const { t } = useTranslation();
  const alive = days > 0;
  return (
    <View
      className={cn('flex-row items-center gap-1.5', className)}
      accessible
      accessibilityLabel={
        alive ? t('learn.streak_days', { count: days }) : t('learn.streak_start')
      }>
      <Icon
        as={Flame}
        size={size === 'sm' ? 18 : 20}
        className={alive ? 'text-streak' : 'text-muted-foreground/50'}
        fill={alive ? 'currentColor' : 'transparent'}
      />
      <Text
        className={cn(
          'font-num',
          size === 'sm' ? 'text-sm' : 'text-base',
          alive ? 'text-foreground' : 'text-muted-foreground'
        )}>
        {days}
      </Text>
    </View>
  );
}

/** Total or daily XP. */
export function XpPill({ xp, className }: { xp: number; className?: string }) {
  const { t } = useTranslation();
  return (
    <View
      className={cn('flex-row items-center gap-1.5', className)}
      accessible
      accessibilityLabel={`${xp} ${t('common.xp')}`}>
      <Icon as={Zap} size={18} className="text-xp" fill="currentColor" />
      <Text className="font-num text-base text-foreground">{xp}</Text>
    </View>
  );
}

/**
 * Circular level indicator.
 *
 * @param progress - 0..1 progress through the current level.
 */
export function LevelRing({
  level,
  progress,
  size = 72,
  scheme = 'light',
}: {
  level: number;
  progress: number;
  size?: number;
  scheme?: 'light' | 'dark';
}) {
  const { t } = useTranslation();
  const tokens = themeTokens(scheme);
  const strokeWidth = size * 0.09;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(1, progress));

  return (
    <View
      style={{ width: size, height: size }}
      className="items-center justify-center"
      accessible
      accessibilityLabel={t('profile.level', { level })}>
      <Svg width={size} height={size} style={{ position: 'absolute' }}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={tokens.muted}
          strokeWidth={strokeWidth}
          fill="none"
        />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={tokens.xp}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={`${circumference * clamped} ${circumference}`}
          // Start the arc at 12 o'clock instead of 3 o'clock.
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          fill="none"
        />
      </Svg>
      <Text className="font-num text-lg text-foreground">{level}</Text>
    </View>
  );
}
