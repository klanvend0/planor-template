/**
 * End-of-lesson results.
 *
 * The payoff screen: what was earned, how accurate the run was, and where the
 * streak now stands. Bonuses are listed separately from the base XP so the
 * learner can see *why* a perfect run was worth more.
 *
 * @module components/lesson/results_view
 */

import { Flame, Star, Target, Timer, Zap } from 'lucide-react-native';
import { View } from 'react-native';
import Animated, { FadeInDown, FadeInUp } from 'react-native-reanimated';

import { GameButton } from '@/components/game_button';
import { Kicker } from '@/components/kicker';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { useTranslation } from '@/hooks/use_translation';
import { useSettingsStore } from '@/stores/settings_store';
import { cn } from '@/lib/utils';
import type { LessonResult } from '@/services/progress_service';

function StatTile({
  icon,
  label,
  value,
  tone,
}: {
  icon: typeof Zap;
  label: string;
  value: string;
  tone: 'xp' | 'success' | 'streak';
}) {
  return (
    <View
      className={cn(
        'flex-1 gap-1 rounded-2xl border-2 px-3 py-3',
        tone === 'xp' && 'border-xp/40 bg-xp/10',
        tone === 'success' && 'border-success/40 bg-success/10',
        tone === 'streak' && 'border-streak/40 bg-streak/10'
      )}>
      <View className="flex-row items-center gap-1.5">
        <Icon
          as={icon}
          size={15}
          className={cn(
            tone === 'xp' && 'text-xp',
            tone === 'success' && 'text-success',
            tone === 'streak' && 'text-streak'
          )}
        />
        <Kicker className="text-[11px] tracking-wide">{label}</Kicker>
      </View>
      <Text className="font-num text-[22px] text-foreground">{value}</Text>
    </View>
  );
}

export function ResultsView({
  result,
  elapsedMs,
  isPractice = false,
  onContinue,
  onPracticeAgain,
  continueLabel,
}: {
  result: LessonResult;
  elapsedMs: number;
  isPractice?: boolean;
  onContinue: () => void;
  onPracticeAgain?: () => void;
  continueLabel?: string;
}) {
  const { t } = useTranslation();
  const dailyGoal = useSettingsStore((state) => state.dailyGoalXp);
  const goalHit = result.dailyXp >= dailyGoal;

  const title =
    result.score === 100
      ? t('results.title_perfect')
      : result.score >= 80
        ? t('results.title_great')
        : result.score >= 50
          ? t('results.title_ok')
          : t('results.title_retry');

  // The bonuses are already inside `xpAwarded`; listing them separately is the
  // only way the learner learns that a flawless run pays more than a passing one.
  const bonuses = [
    { label: t('results.perfect_bonus'), amount: result.perfectBonus },
    { label: t('results.streak_bonus'), amount: result.streakBonus },
  ].filter((bonus) => bonus.amount > 0);

  const minutes = Math.floor(elapsedMs / 60000);
  const seconds = Math.floor((elapsedMs % 60000) / 1000);

  return (
    <View className="flex-1 justify-between gap-6 px-6 py-6">
      <View className="flex-1 justify-center gap-8">
        <Animated.View entering={FadeInUp.duration(320)} className="items-center gap-4">
          <View className="flex-row gap-2">
            {[0, 1, 2].map((index) => (
              <Animated.View key={index} entering={FadeInDown.delay(120 * index).springify()}>
                <Icon
                  as={Star}
                  size={40}
                  className={index < result.stars ? 'text-warning' : 'text-muted-foreground/25'}
                  fill={index < result.stars ? 'currentColor' : 'transparent'}
                />
              </Animated.View>
            ))}
          </View>

          <Text className="text-center font-display text-[32px] leading-10 text-foreground">
            {title}
          </Text>
        </Animated.View>

        <Animated.View entering={FadeInDown.delay(200).duration(320)} className="gap-3">
          <View className="flex-row gap-3">
            <StatTile
              icon={Zap}
              label={t('results.xp_earned')}
              value={`+${result.xpAwarded}`}
              tone="xp"
            />
            <StatTile
              icon={Target}
              label={t('results.accuracy')}
              value={`${result.score}%`}
              tone="success"
            />
            <StatTile
              icon={Timer}
              label={t('results.time')}
              value={`${minutes}:${String(seconds).padStart(2, '0')}`}
              tone="streak"
            />
          </View>

          {bonuses.length > 0 ? (
            <View className="gap-2 rounded-2xl border border-border bg-card px-4 py-3">
              {bonuses.map((bonus) => (
                <View key={bonus.label} className="flex-row items-center justify-between">
                  <Text className="text-[14px] text-muted-foreground">{bonus.label}</Text>
                  <Text className="font-num text-[15px] text-xp">{`+${bonus.amount}`}</Text>
                </View>
              ))}
            </View>
          ) : null}

          {goalHit ? (
            <View className="flex-row items-center gap-2 rounded-2xl border-2 border-xp/40 bg-xp/10 px-4 py-3">
              <Icon as={Zap} size={20} className="text-xp" fill="currentColor" />
              <Text className="flex-1 font-strong text-[15px] text-foreground">
                {t('results.daily_goal_hit')}
              </Text>
            </View>
          ) : null}

          {!isPractice && result.streakDays > 0 ? (
            <View className="flex-row items-center gap-2 rounded-2xl border-2 border-streak/40 bg-streak/10 px-4 py-3">
              <Icon as={Flame} size={20} className="text-streak" fill="currentColor" />
              <Text className="flex-1 font-strong text-[15px] text-foreground">
                {result.streakDays === 1
                  ? t('results.streak_started')
                  : t('results.streak_extended', { count: result.streakDays })}
              </Text>
            </View>
          ) : null}
        </Animated.View>
      </View>

      <View className="gap-3">
        <GameButton
          label={continueLabel ?? t('results.continue')}
          variant="success"
          size="lg"
          onPress={onContinue}
        />
        {onPracticeAgain ? (
          <GameButton
            label={t('results.practice_again')}
            variant="ghost"
            onPress={onPracticeAgain}
            flat
          />
        ) : null}
      </View>
    </View>
  );
}
