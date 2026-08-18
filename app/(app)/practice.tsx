/**
 * Practice tab.
 *
 * Two decks: the questions the learner actually got wrong, and a quick review
 * drawn from everything they have finished. Practice never costs hearts and pays
 * a smaller XP reward, so it stays a warm-up rather than a shortcut.
 *
 * @module app/(app)/practice
 */

import { router, useFocusEffect } from 'expo-router';
import { Repeat2, Zap } from 'lucide-react-native';
import { useCallback } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GameButton } from '@/components/game_button';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { useMistakesDeck, useQuickReviewDeck } from '@/hooks/use_practice_deck';
import { useTranslation } from '@/hooks/use_translation';
import { cn } from '@/lib/utils';
import { useSettingsStore } from '@/stores/settings_store';

function DeckCard({
  icon,
  title,
  body,
  meta,
  actionLabel,
  onPress,
  disabled,
  tone,
}: {
  icon: typeof Zap;
  title: string;
  body: string;
  meta?: string;
  actionLabel: string;
  onPress: () => void;
  disabled?: boolean;
  tone: 'destructive' | 'primary';
}) {
  return (
    <View
      className={cn(
        'gap-4 rounded-3xl border-2 px-5 py-5',
        tone === 'destructive'
          ? 'border-destructive/30 bg-destructive/10'
          : 'border-primary/30 bg-primary/10'
      )}>
      <View className="flex-row items-center gap-3">
        <View
          className={cn(
            'h-11 w-11 items-center justify-center rounded-2xl',
            tone === 'destructive' ? 'bg-destructive/20' : 'bg-primary/20'
          )}>
          <Icon
            as={icon}
            size={22}
            className={tone === 'destructive' ? 'text-destructive' : 'text-primary'}
          />
        </View>
        <View className="flex-1 gap-0.5">
          <Text className="font-display text-[20px] text-foreground">{title}</Text>
          {meta ? <Text className="font-strong text-sm text-muted-foreground">{meta}</Text> : null}
        </View>
      </View>

      <Text className="text-[15px] leading-6 text-muted-foreground">{body}</Text>

      <GameButton
        label={actionLabel}
        variant={tone === 'destructive' ? 'destructive' : 'primary'}
        onPress={onPress}
        disabled={disabled}
      />
    </View>
  );
}

export default function PracticeScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const activeCourse = useSettingsStore((state) => state.activeCourse);

  const mistakes = useMistakesDeck(activeCourse);
  const review = useQuickReviewDeck(activeCourse);

  useFocusEffect(
    useCallback(() => {
      void mistakes.reload();
      void review.reload();
      // Reloading on focus keeps the counts honest after a lesson.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeCourse])
  );

  const hasMistakes = mistakes.questions.length > 0;
  const hasReview = review.questions.length > 0;

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <View className="px-5 py-4">
        <Text className="font-display text-[28px] text-foreground">{t('practice.title')}</Text>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerClassName="px-5 gap-4"
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}>
        {hasMistakes ? (
          <DeckCard
            icon={Repeat2}
            tone="destructive"
            title={t('practice.mistakes_title')}
            meta={t('practice.mistakes_count', { count: mistakes.questions.length })}
            body={t('practice.mistakes_body')}
            actionLabel={t('practice.start')}
            onPress={() =>
              router.push({ pathname: '/practice/[deck]', params: { deck: 'mistakes' } })
            }
          />
        ) : (
          <View className="gap-2 rounded-3xl border-2 border-border bg-card px-5 py-6">
            <Text className="font-display text-[20px] text-foreground">
              {t('practice.mistakes_empty_title')}
            </Text>
            <Text className="text-[15px] leading-6 text-muted-foreground">
              {t('practice.mistakes_empty_body')}
            </Text>
          </View>
        )}

        <DeckCard
          icon={Zap}
          tone="primary"
          title={t('practice.speed_title')}
          body={hasReview ? t('practice.speed_body') : t('practice.no_lessons_yet')}
          meta={
            hasReview ? t('practice.mistakes_count', { count: review.questions.length }) : undefined
          }
          actionLabel={t('practice.start')}
          disabled={!hasReview}
          onPress={() => router.push({ pathname: '/practice/[deck]', params: { deck: 'review' } })}
        />
      </ScrollView>
    </View>
  );
}
