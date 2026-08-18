/**
 * Onboarding.
 *
 * Five illustrated slides that explain what the app is, then the four questions
 * whose answers actually change the product (language, course, starting point,
 * daily goal) and an honest ask for notification permission.
 *
 * Everything is stored locally first so the flow works before sign-in; the
 * answers are pushed to `profiles` the moment an account exists.
 *
 * @module app/(onboarding)/index
 */

import { ArrowLeft } from 'lucide-react-native';
import { useCallback, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import Animated, { FadeIn, FadeInRight, FadeOut } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useColorScheme } from 'nativewind';

import { GameButton } from '@/components/game_button';
import { ChoiceCard } from '@/components/onboarding/choice_card';
import {
  ONBOARDING_ILLUSTRATIONS,
  type OnboardingSlideKey,
} from '@/components/onboarding/illustrations';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { useTranslation } from '@/hooks/use_translation';
import { track } from '@/lib/analytics';
import { TRIAL_DAYS } from '@/lib/constants';
import type { CourseId } from '@/lib/content_schema';
import { tapFeedback } from '@/lib/haptics';
import type { SupportedLocale } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import {
  requestNotificationPermission,
  scheduleDailyReminder,
} from '@/services/notifications_service';
import {
  DAILY_GOALS,
  useSettingsStore,
  type DailyGoal,
  type ExperienceLevel,
} from '@/stores/settings_store';

const SLIDES: OnboardingSlideKey[] = ['welcome', 'puzzles', 'mistakes', 'ai', 'streak'];

/** Questions asked after the slides, in order. */
type Step = 'language' | 'course' | 'experience' | 'goal' | 'notifications' | 'ready';
const STEPS: Step[] = ['language', 'course', 'experience', 'goal', 'notifications', 'ready'];

/** Rough minutes a daily goal takes, used to make the choice concrete. */
const GOAL_MINUTES: Record<DailyGoal, number> = { 20: 3, 50: 7, 100: 13, 200: 25 };
const GOAL_LABEL: Record<DailyGoal, 'casual' | 'regular' | 'serious' | 'intense'> = {
  20: 'casual',
  50: 'regular',
  100: 'serious',
  200: 'intense',
};

export default function OnboardingScreen() {
  const { t, locale, setLocale } = useTranslation();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { colorScheme } = useColorScheme();

  const scrollRef = useRef<ScrollView>(null);
  const [slide, setSlide] = useState(0);
  const [inQuestions, setInQuestions] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);

  const settings = useSettingsStore();
  const step = STEPS[stepIndex];

  const onSlideScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const next = Math.round(event.nativeEvent.contentOffset.x / width);
      if (next !== slide) setSlide(next);
    },
    [slide, width]
  );

  const advanceSlide = () => {
    void tapFeedback();
    if (slide < SLIDES.length - 1) {
      scrollRef.current?.scrollTo({ x: (slide + 1) * width, animated: true });
      setSlide(slide + 1);
      return;
    }
    setInQuestions(true);
  };

  const back = () => {
    void tapFeedback();
    if (stepIndex === 0) {
      setInQuestions(false);
      return;
    }
    setStepIndex(stepIndex - 1);
  };

  const advanceStep = () => setStepIndex((index) => Math.min(STEPS.length - 1, index + 1));

  const finish = () => {
    track('onboarding_completed', {
      locale: settings.locale,
      course: settings.activeCourse,
      daily_goal: settings.dailyGoalXp,
    });
    settings.completeOnboarding();
    router.replace('/(auth)/login');
  };

  const enableReminders = async () => {
    const granted = await requestNotificationPermission();
    settings.setReminders(granted, settings.reminderHour);
    if (granted) await scheduleDailyReminder(settings.reminderHour, 0);
    advanceStep();
  };

  // ---------------------------------------------------------------------------
  // Slides
  // ---------------------------------------------------------------------------

  if (!inQuestions) {
    return (
      <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
        <ScrollView
          ref={scrollRef}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onScroll={onSlideScroll}
          scrollEventThrottle={32}
          className="flex-1">
          {SLIDES.map((key) => {
            const Illustration = ONBOARDING_ILLUSTRATIONS[key];
            return (
              <View key={key} style={{ width }} className="flex-1 items-center justify-center px-8">
                <Illustration width={Math.min(300, width - 72)} scheme={colorScheme ?? 'light'} />
                <Text className="mt-10 text-center font-display text-[30px] leading-9 text-foreground">
                  {t(`onboarding.slides.${key}.title` as 'onboarding.slides.welcome.title')}
                </Text>
                <Text className="mt-3 text-center text-[16px] leading-6 text-muted-foreground">
                  {t(`onboarding.slides.${key}.body` as 'onboarding.slides.welcome.body')}
                </Text>
              </View>
            );
          })}
        </ScrollView>

        <View className="gap-6 px-6" style={{ paddingBottom: insets.bottom + 16 }}>
          <View className="flex-row items-center justify-center gap-2">
            {SLIDES.map((key, index) => (
              <View
                key={key}
                className={cn(
                  'h-2 rounded-full',
                  index === slide ? 'w-6 bg-primary' : 'w-2 bg-muted-foreground/35'
                )}
              />
            ))}
          </View>

          <GameButton
            label={slide === SLIDES.length - 1 ? t('common.continue') : t('common.next')}
            onPress={advanceSlide}
            size="lg"
          />
        </View>
      </View>
    );
  }

  // ---------------------------------------------------------------------------
  // Questions
  // ---------------------------------------------------------------------------

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top + 8 }}>
      <View className="flex-row items-center gap-3 px-5 pb-6">
        <Pressable
          onPress={back}
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
          hitSlop={12}
          className="h-10 w-10 items-center justify-center rounded-full bg-muted">
          <Icon as={ArrowLeft} size={20} className="text-foreground" />
        </Pressable>

        <View className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
          <View
            className="h-full rounded-full bg-primary"
            style={{ width: `${((stepIndex + 1) / STEPS.length) * 100}%` }}
          />
        </View>

        <Text className="w-16 text-right font-semibold text-xs text-muted-foreground">
          {t('onboarding.progress', { current: stepIndex + 1, total: STEPS.length })}
        </Text>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerClassName="px-6 pb-6 gap-6"
        keyboardShouldPersistTaps="handled">
        <Animated.View
          key={step}
          entering={FadeInRight.duration(220)}
          exiting={FadeOut.duration(120)}>
          {step === 'language' ? (
            <View className="gap-6">
              <View className="gap-2">
                <Text className="font-display text-[26px] leading-8 text-foreground">
                  {t('onboarding.language.title')}
                </Text>
                <Text className="text-[15px] text-muted-foreground">
                  {t('onboarding.language.subtitle')}
                </Text>
              </View>
              <View className="gap-3">
                {(['en', 'tr'] as SupportedLocale[]).map((code) => (
                  <ChoiceCard
                    key={code}
                    title={
                      code === 'en'
                        ? t('onboarding.language.english')
                        : t('onboarding.language.turkish')
                    }
                    selected={locale === code}
                    onPress={() => {
                      void setLocale(code);
                      void settings.setLocale(code);
                    }}
                    leading={<Text className="text-2xl">{code === 'en' ? 'EN' : 'TR'}</Text>}
                  />
                ))}
              </View>
            </View>
          ) : null}

          {step === 'course' ? (
            <View className="gap-6">
              <View className="gap-2">
                <Text className="font-display text-[26px] leading-8 text-foreground">
                  {t('onboarding.course.title')}
                </Text>
                <Text className="text-[15px] text-muted-foreground">
                  {t('onboarding.course.subtitle')}
                </Text>
              </View>
              <View className="gap-3">
                {(['python', 'javascript'] as CourseId[]).map((course) => (
                  <ChoiceCard
                    key={course}
                    title={t(`onboarding.course.${course}` as 'onboarding.course.python')}
                    subtitle={t(
                      `onboarding.course.${course}_hint` as 'onboarding.course.python_hint'
                    )}
                    selected={settings.activeCourse === course}
                    onPress={() => settings.setActiveCourse(course)}
                    leading={
                      <View
                        className={cn(
                          'h-11 w-11 items-center justify-center rounded-xl',
                          course === 'python' ? 'bg-course-python/20' : 'bg-course-javascript/20'
                        )}>
                        <Text
                          className={cn(
                            'font-mono-bold text-base',
                            course === 'python' ? 'text-course-python' : 'text-course-javascript'
                          )}>
                          {course === 'python' ? 'Py' : 'JS'}
                        </Text>
                      </View>
                    }
                  />
                ))}
              </View>
            </View>
          ) : null}

          {step === 'experience' ? (
            <View className="gap-6">
              <Text className="font-display text-[26px] leading-8 text-foreground">
                {t('onboarding.experience.title')}
              </Text>
              <View className="gap-3">
                {(['new', 'some', 'confident'] as ExperienceLevel[]).map((level) => (
                  <ChoiceCard
                    key={level}
                    title={t(`onboarding.experience.${level}` as 'onboarding.experience.new')}
                    subtitle={t(
                      `onboarding.experience.${level}_hint` as 'onboarding.experience.new_hint'
                    )}
                    selected={settings.experienceLevel === level}
                    onPress={() => settings.setExperienceLevel(level)}
                  />
                ))}
              </View>
            </View>
          ) : null}

          {step === 'goal' ? (
            <View className="gap-6">
              <View className="gap-2">
                <Text className="font-display text-[26px] leading-8 text-foreground">
                  {t('onboarding.goal.title')}
                </Text>
                <Text className="text-[15px] text-muted-foreground">
                  {t('onboarding.goal.subtitle')}
                </Text>
              </View>
              <View className="gap-3">
                {DAILY_GOALS.map((goal) => (
                  <ChoiceCard
                    key={goal}
                    title={t(`onboarding.goal.${GOAL_LABEL[goal]}` as 'onboarding.goal.casual')}
                    subtitle={`${t('onboarding.goal.xp_per_day', { xp: goal })} · ${t(
                      'onboarding.goal.minutes',
                      { minutes: GOAL_MINUTES[goal] }
                    )}`}
                    selected={settings.dailyGoalXp === goal}
                    onPress={() => settings.setDailyGoal(goal)}
                  />
                ))}
              </View>
            </View>
          ) : null}

          {step === 'notifications' ? (
            <View className="gap-6">
              <View className="gap-2">
                <Text className="font-display text-[26px] leading-8 text-foreground">
                  {t('onboarding.notifications.title')}
                </Text>
                <Text className="text-[15px] text-muted-foreground">
                  {t('onboarding.notifications.subtitle')}
                </Text>
              </View>
              <View className="items-center py-4">
                <ONBOARDING_ILLUSTRATIONS.streak width={220} scheme={colorScheme ?? 'light'} />
              </View>
            </View>
          ) : null}

          {step === 'ready' ? (
            <Animated.View entering={FadeIn.duration(260)} className="items-center gap-6 pt-6">
              <ONBOARDING_ILLUSTRATIONS.welcome width={240} scheme={colorScheme ?? 'light'} />
              <Text className="text-center font-display text-[28px] leading-9 text-foreground">
                {t('onboarding.ready.title')}
              </Text>
              <Text className="text-center text-[15px] leading-6 text-muted-foreground">
                {t('onboarding.ready.subtitle', { days: TRIAL_DAYS })}
              </Text>
            </Animated.View>
          ) : null}
        </Animated.View>
      </ScrollView>

      <View className="gap-3 px-6" style={{ paddingBottom: insets.bottom + 16 }}>
        {step === 'notifications' ? (
          <>
            <GameButton
              label={t('onboarding.notifications.allow')}
              onPress={() => void enableReminders()}
              size="lg"
            />
            <GameButton
              label={t('onboarding.notifications.deny')}
              variant="ghost"
              onPress={() => {
                settings.setReminders(false);
                advanceStep();
              }}
              flat
            />
          </>
        ) : (
          <GameButton
            label={step === 'ready' ? t('onboarding.ready.cta') : t('common.continue')}
            onPress={step === 'ready' ? finish : advanceStep}
            size="lg"
          />
        )}
      </View>
    </View>
  );
}
