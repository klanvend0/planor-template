/**
 * Practice runner.
 *
 * Plays a deck of questions pulled from across the course — mistakes, or a quick
 * review — through the same session machinery a lesson uses. The teaching card
 * is skipped, hearts are not spent, and the reward is the smaller practice XP.
 *
 * @module app/practice/[deck]
 */

import { router, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { GameButton } from '@/components/game_button';
import { SessionRunner } from '@/components/lesson/session_runner';
import { Text } from '@/components/ui/text';
import { useLessonSession } from '@/hooks/use_lesson_session';
import { useMistakesDeck, useQuickReviewDeck } from '@/hooks/use_practice_deck';
import { useTranslation } from '@/hooks/use_translation';
import type { Question } from '@/lib/content_schema';
import { getQuestionLocation, type LessonLocation } from '@/services/content_service';
import { useSettingsStore } from '@/stores/settings_store';

export default function PracticeRunnerScreen() {
  const { deck } = useLocalSearchParams<{ deck: string }>();
  const { t } = useTranslation();
  const activeCourse = useSettingsStore((state) => state.activeCourse);

  const mistakes = useMistakesDeck(activeCourse);
  const review = useQuickReviewDeck(activeCourse);
  const source = deck === 'review' ? review : mistakes;

  if (source.isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator size="large" />
      </View>
    );
  }

  const location = source.questions.length > 0 ? getQuestionLocation(source.questions[0].id) : null;

  if (!location || source.questions.length === 0) {
    return (
      <View className="flex-1 items-center justify-center gap-4 bg-background px-8">
        <Text className="text-center font-display text-xl text-foreground">
          {t('practice.mistakes_empty_title')}
        </Text>
        <Text className="text-center text-[15px] text-muted-foreground">
          {t('practice.mistakes_empty_body')}
        </Text>
        <GameButton label={t('common.back')} onPress={() => router.back()} />
      </View>
    );
  }

  return <PracticeRunner questions={source.questions} location={location} />;
}

/**
 * Split out so the session hook only ever runs with a resolved deck, keeping
 * hook order stable across the loading and empty states above.
 */
function PracticeRunner({
  questions,
  location,
}: {
  questions: Question[];
  location: LessonLocation;
}) {
  const { t } = useTranslation();
  const session = useLessonSession(location, { questions, mode: 'practice' });
  const { phase, begin } = session;

  // Practice has no teaching card, so start on the first question.
  useEffect(() => {
    if (phase === 'concept') begin();
  }, [begin, phase]);

  return (
    <SessionRunner
      session={session}
      location={location}
      mode="practice"
      finishLabel={t('common.done')}
      onExit={() => router.back()}
      onFinish={() => router.back()}
    />
  );
}
