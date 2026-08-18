/**
 * Profile tab.
 *
 * What the learner has built: level and XP, the streak record, the weekly league
 * they are sitting in, and the achievement grid. Subscription status lives here
 * too, with a route to manage it in the App Store.
 *
 * @module app/(app)/profile
 */

import { router, useFocusEffect } from 'expo-router';
import * as LucideIcons from 'lucide-react-native';
import { Settings } from 'lucide-react-native';
import { useCallback } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useColorScheme } from 'nativewind';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GameButton } from '@/components/game_button';
import { LevelRing, StreakBadge } from '@/components/game_hud';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { useProfileStats } from '@/hooks/use_profile_stats';
import { useTranslation } from '@/hooks/use_translation';
import { ACHIEVEMENTS, isUnlocked, leagueFromWeeklyXp, levelFromXp } from '@/lib/gamification';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth_store';
import { useGameStore } from '@/stores/game_store';

function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-1 gap-1 rounded-2xl border border-border bg-card px-3 py-3">
      <Text className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
        {label}
      </Text>
      <Text className="font-display text-[20px] text-foreground">{value}</Text>
    </View>
  );
}

export default function ProfileScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { colorScheme } = useColorScheme();

  const user = useAuthStore((state) => state.user);
  const gameState = useGameStore((state) => state.state);
  const refreshGame = useGameStore((state) => state.refresh);
  const { stats, reload } = useProfileStats();

  useFocusEffect(
    useCallback(() => {
      void refreshGame({ silent: true });
      void reload();
    }, [refreshGame, reload])
  );

  const level = levelFromXp(stats.totalXp);
  const league = leagueFromWeeklyXp(gameState?.weeklyXp ?? 0);
  const isPro = gameState?.hasSubscription ?? false;

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <View className="flex-row items-center justify-between px-5 py-4">
        <Text className="font-display text-[28px] text-foreground">{t('profile.title')}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('settings.title')}
          hitSlop={10}
          onPress={() => router.push('/settings')}>
          <Icon as={Settings} size={24} className="text-muted-foreground" />
        </Pressable>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerClassName="px-5 gap-6"
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}>
        {/* Identity + level */}
        <View className="flex-row items-center gap-4 rounded-3xl border border-border bg-card px-5 py-5">
          <LevelRing
            level={level.level}
            progress={level.progress}
            size={78}
            scheme={colorScheme ?? 'light'}
          />
          <View className="flex-1 gap-1">
            <Text className="font-display text-[20px] text-foreground" numberOfLines={1}>
              {user?.user_metadata?.full_name ?? user?.email ?? t('app.name')}
            </Text>
            <Text className="text-sm font-semibold text-muted-foreground">
              {t('profile.level', { level: level.level })}
            </Text>
            <Text className="text-xs text-muted-foreground">
              {t('profile.level_progress', {
                current: level.xpIntoLevel,
                target: level.xpForLevel,
                next: level.level + 1,
              })}
            </Text>
          </View>
          <StreakBadge days={gameState?.streakDays ?? 0} />
        </View>

        {/* Subscription */}
        <View
          className={cn(
            'flex-row items-center gap-4 rounded-3xl border-2 px-5 py-4',
            isPro ? 'border-success/40 bg-success/10' : 'border-border bg-card'
          )}>
          <View className="flex-1 gap-0.5">
            <Text className="font-bold text-[16px] text-foreground">
              {isPro ? t('profile.pro_member') : t('profile.free_member')}
            </Text>
            <Text className="text-xs text-muted-foreground">
              {isPro ? t('paywall.subtitle') : t('paywall.features.ai')}
            </Text>
          </View>
          {!isPro ? (
            <GameButton
              label={t('paywall.cta_buy')}
              size="sm"
              onPress={() => router.push('/paywall')}
            />
          ) : null}
        </View>

        {/* Stats */}
        <View className="gap-3">
          <Text className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
            {t('profile.stats')}
          </Text>
          <View className="flex-row gap-3">
            <StatCell label={t('profile.total_xp')} value={String(stats.totalXp)} />
            <StatCell label={t('profile.current_streak')} value={String(stats.streakDays)} />
            <StatCell label={t('profile.longest_streak')} value={String(stats.longestStreak)} />
          </View>
          <View className="flex-row gap-3">
            <StatCell label={t('profile.lessons_completed')} value={String(stats.lessonsCompleted)} />
            <StatCell label={t('profile.perfect_lessons')} value={String(stats.perfectLessons)} />
            <StatCell label={t('common.xp')} value={String(gameState?.weeklyXp ?? 0)} />
          </View>
        </View>

        {/* League */}
        <View className="gap-3 rounded-3xl border border-border bg-card px-5 py-5">
          <View className="flex-row items-center justify-between">
            <Text className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
              {t('profile.league')}
            </Text>
            <Text className="text-xs font-semibold text-muted-foreground">
              {t('profile.league_progress', { xp: gameState?.weeklyXp ?? 0 })}
            </Text>
          </View>

          <Text className="font-display text-[22px] text-foreground">
            {t(`profile.leagues.${league.league}` as 'profile.leagues.bronze')}
          </Text>

          <View className="h-2 overflow-hidden rounded-full bg-muted">
            <View
              className="h-full rounded-full bg-xp"
              style={{ width: `${Math.round(Math.max(0, Math.min(1, league.progress)) * 100)}%` }}
            />
          </View>
        </View>

        {/* Achievements */}
        <View className="gap-3">
          <View className="flex-row items-center justify-between">
            <Text className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
              {t('profile.achievements')}
            </Text>
            <Text className="text-xs font-semibold text-muted-foreground">
              {t('profile.achievements_progress', {
                unlocked: ACHIEVEMENTS.filter((achievement) => isUnlocked(achievement, stats)).length,
                total: ACHIEVEMENTS.length,
              })}
            </Text>
          </View>

          <View className="flex-row flex-wrap gap-3">
            {ACHIEVEMENTS.map((achievement) => {
              const unlocked = isUnlocked(achievement, stats);
              const progress = achievement.progress(stats);
              const IconComponent =
                (LucideIcons as unknown as Record<string, typeof Settings>)[achievement.icon] ??
                LucideIcons.Award;

              return (
                <View
                  key={achievement.id}
                  className={cn(
                    'w-[31%] items-center gap-2 rounded-2xl border-2 px-2 py-3',
                    unlocked ? 'border-warning/50 bg-warning/10' : 'border-border bg-card'
                  )}>
                  <View
                    className={cn(
                      'h-11 w-11 items-center justify-center rounded-full',
                      unlocked ? 'bg-warning/25' : 'bg-muted'
                    )}>
                    <Icon
                      as={IconComponent}
                      size={20}
                      className={unlocked ? 'text-warning' : 'text-muted-foreground/60'}
                    />
                  </View>
                  <Text
                    numberOfLines={2}
                    className={cn(
                      'text-center text-[11px] font-bold leading-4',
                      unlocked ? 'text-foreground' : 'text-muted-foreground'
                    )}>
                    {t(achievement.titleKey)}
                  </Text>
                  {!unlocked && progress > 0 ? (
                    <View className="h-1 w-full overflow-hidden rounded-full bg-muted">
                      <View
                        className="h-full rounded-full bg-muted-foreground/60"
                        style={{ width: `${Math.round(progress * 100)}%` }}
                      />
                    </View>
                  ) : null}
                </View>
              );
            })}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}
