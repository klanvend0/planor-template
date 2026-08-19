/**
 * Learn map.
 *
 * The home screen: a scrolling path of lessons grouped into units, with the
 * day's state pinned to the top (streak, hearts, daily goal). Tapping a node
 * starts the lesson; tapping a locked premium unit opens the paywall, and
 * tapping one that is still out of order says why.
 *
 * @module app/(app)/index
 */

import { router, useFocusEffect } from 'expo-router';
import { ChevronDown, Settings } from 'lucide-react-native';
import { useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GameButton } from '@/components/game_button';
import { HeartsIndicator, ProgressBar, StreakBadge } from '@/components/game_hud';
import { LessonNode } from '@/components/learn/lesson_node';
import { pathOffset, UnitHeader } from '@/components/learn/unit_header';
import { Kicker } from '@/components/kicker';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { useTranslation } from '@/hooks/use_translation';
import { track } from '@/lib/analytics';
import { localized } from '@/lib/content_schema';
import { FREE_UNIT_LIMIT } from '@/lib/constants';
import { getCourse, getLesson } from '@/services/content_service';
import { useGameStore } from '@/stores/game_store';
import {
  lessonStatus,
  nextLessonId,
  unitProgress,
  useProgressStore,
} from '@/stores/progress_store';
import { useSettingsStore } from '@/stores/settings_store';

function greetingKey():
  'learn.greeting_morning' | 'learn.greeting_afternoon' | 'learn.greeting_evening' {
  const hour = new Date().getHours();
  if (hour < 12) return 'learn.greeting_morning';
  if (hour < 18) return 'learn.greeting_afternoon';
  return 'learn.greeting_evening';
}

export default function LearnScreen() {
  const { t, locale } = useTranslation();
  const insets = useSafeAreaInsets();
  const [refreshing, setRefreshing] = useState(false);

  const activeCourse = useSettingsStore((state) => state.activeCourse);
  const setActiveCourse = useSettingsStore((state) => state.setActiveCourse);
  const dailyGoal = useSettingsStore((state) => state.dailyGoalXp);
  const lastPaywallAt = useSettingsStore((state) => state.lastPaywallAt);

  const gameState = useGameStore((state) => state.state);
  const refreshGame = useGameStore((state) => state.refresh);
  const byLesson = useProgressStore((state) => state.byLesson);
  const loadProgress = useProgressStore((state) => state.load);

  const course = getCourse(activeCourse);
  const hasSubscription = gameState?.hasSubscription ?? false;

  useFocusEffect(
    useCallback(() => {
      void loadProgress(activeCourse);
    }, [activeCourse, loadProgress])
  );

  // The trial offer is made once, the first time the learner reaches the map.
  // Scheduled on focus so a learner who opens a lesson in the meantime does not
  // get the modal dropped on top of it.
  useFocusEffect(
    useCallback(() => {
      if (!gameState || hasSubscription || lastPaywallAt !== null) return;
      const timer = setTimeout(() => router.push('/paywall'), 600);
      return () => clearTimeout(timer);
    }, [gameState, hasSubscription, lastPaywallAt])
  );

  const nextId = useMemo(
    () => nextLessonId(byLesson, activeCourse, hasSubscription),
    [byLesson, activeCourse, hasSubscription]
  );
  const nextLesson = nextId ? getLesson(nextId) : null;

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([refreshGame(), loadProgress(activeCourse, { force: true })]);
    setRefreshing(false);
  };

  /** What tapping this node will do, for the screen reader. */
  const actionLabel = (status: ReturnType<typeof lessonStatus>, isNext: boolean): string => {
    if (status === 'completed') return t('learn.review_lesson');
    if (status === 'premium_locked') return t('paywall.title');
    if (status === 'locked') return t('learn.locked_title');
    return isNext ? t('learn.continue_lesson') : t('learn.start_lesson');
  };

  const openLesson = (
    lessonId: string,
    status: ReturnType<typeof lessonStatus>,
    unitId: string
  ) => {
    if (status === 'premium_locked') {
      router.push('/paywall');
      return;
    }
    if (status === 'locked') {
      // A node that does nothing when tapped reads as a broken button, so the
      // rule that locked it is stated instead.
      Alert.alert(t('learn.locked_title'), t('learn.locked_body'));
      return;
    }
    track('lesson_started', { lesson_id: lessonId, course: activeCourse, unit: unitId });
    router.push({ pathname: '/lesson/[lessonId]', params: { lessonId } });
  };

  const dailyXp = gameState?.dailyXp ?? 0;
  const goalReached = dailyXp >= dailyGoal;

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      {/* Sticky header */}
      <View className="gap-3 border-b border-border bg-background px-5 pb-3 pt-2">
        <View className="flex-row items-center justify-between">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('learn.course_switch')}
            onPress={() => setActiveCourse(activeCourse === 'python' ? 'javascript' : 'python')}
            className="flex-row items-center gap-2 rounded-full bg-muted px-3 py-1.5">
            <Text className="font-mono-strong text-sm text-foreground">
              {activeCourse === 'python' ? 'Py' : 'JS'}
            </Text>
            <Text className="font-strong text-sm text-foreground">
              {localized(course.title, locale)}
            </Text>
            <Icon as={ChevronDown} size={14} className="text-muted-foreground" />
          </Pressable>

          <View className="flex-row items-center gap-4">
            <StreakBadge days={gameState?.streakDays ?? 0} />
            <HeartsIndicator hearts={gameState?.hearts ?? 5} unlimited={hasSubscription} />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('settings.title')}
              hitSlop={10}
              onPress={() => router.push('/settings')}>
              <Icon as={Settings} size={22} className="text-muted-foreground" />
            </Pressable>
          </View>
        </View>

        <View className="flex-row items-center gap-3">
          <ProgressBar progress={dailyXp / dailyGoal} tone={goalReached ? 'success' : 'xp'} />
          <Text className="font-strong text-xs text-muted-foreground">
            {goalReached
              ? t('learn.daily_goal_done')
              : t('learn.daily_goal_progress', { current: dailyXp, target: dailyGoal })}
          </Text>
        </View>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerClassName="px-5 pt-5 gap-6"
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />
        }>
        {/* Continue card */}
        {nextLesson ? (
          <View className="gap-3 rounded-3xl border-2 border-primary/30 bg-primary/10 px-5 py-5">
            <Kicker className="text-primary">{t(greetingKey())}</Kicker>
            <Text className="font-display text-[22px] leading-7 text-foreground">
              {localized(nextLesson.title, locale)}
            </Text>
            <GameButton
              label={t('learn.jump_back_in')}
              onPress={() =>
                router.push({ pathname: '/lesson/[lessonId]', params: { lessonId: nextLesson.id } })
              }
            />
          </View>
        ) : null}

        {/* The path */}
        {course.units.map((unit) => {
          const progress = unitProgress(byLesson, unit.id, activeCourse);
          const unitLocked = !hasSubscription && unit.index > FREE_UNIT_LIMIT;

          return (
            <View key={unit.id} className="gap-5">
              <UnitHeader
                index={unit.index}
                title={localized(unit.title, locale)}
                description={localized(unit.description, locale)}
                done={progress.done}
                total={progress.total}
                locked={unitLocked}
                lockedLabel={t('paywall.title')}
                courseId={activeCourse}
                unitLabel={t('learn.unit', { index: unit.index })}
                progressLabel={
                  progress.done === progress.total && progress.total > 0
                    ? t('learn.unit_complete')
                    : t('learn.unit_progress', { done: progress.done, total: progress.total })
                }
              />

              <View className="items-center gap-3">
                {unit.lessons.map((lesson, index) => {
                  const status = lessonStatus({
                    byLesson,
                    courseId: activeCourse,
                    lessonId: lesson.id,
                    hasSubscription,
                  });

                  return (
                    <LessonNode
                      key={lesson.id}
                      title={localized(lesson.title, locale)}
                      actionLabel={actionLabel(status, lesson.id === nextId)}
                      status={status}
                      stars={byLesson[lesson.id]?.stars ?? 0}
                      isCurrent={lesson.id === nextId}
                      offset={pathOffset(index)}
                      onPress={() => openLesson(lesson.id, status, unit.id)}
                    />
                  );
                })}
              </View>

              {unitLocked ? (
                <GameButton
                  label={t('explain.locked_cta')}
                  variant="secondary"
                  onPress={() => router.push('/paywall')}
                />
              ) : null}
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}
