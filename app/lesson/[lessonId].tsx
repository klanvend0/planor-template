/**
 * Lesson screen.
 *
 * Resolves the lesson from the route, runs a session over it, and folds the
 * result back into the progress store so the learn map is already up to date
 * when the learner lands back on it.
 *
 * @module app/lesson/[lessonId]
 */

import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef } from 'react';
import { View } from 'react-native';

import { GameButton } from '@/components/game_button';
import { SessionRunner } from '@/components/lesson/session_runner';
import { Text } from '@/components/ui/text';
import { useLessonSession } from '@/hooks/use_lesson_session';
import { useTranslation } from '@/hooks/use_translation';
import { getLessonLocation, getNextLesson } from '@/services/content_service';
import { useProgressStore } from '@/stores/progress_store';

export default function LessonScreen() {
  const { lessonId } = useLocalSearchParams<{ lessonId: string }>();
  const { t } = useTranslation();
  const applyResult = useProgressStore((state) => state.applyResult);

  const location = getLessonLocation(lessonId ?? '');
  const recorded = useRef(false);

  // A lesson id that no longer exists (content shrank in an update) must not
  // crash the app; the hook below needs a location, so bail out first.
  if (!location) {
    return (
      <View className="flex-1 items-center justify-center gap-4 bg-background px-8">
        <Text className="text-center font-display text-xl text-foreground">
          {t('errors.generic')}
        </Text>
        <GameButton label={t('common.back')} onPress={() => router.back()} />
      </View>
    );
  }

  return <LessonPlayer lessonId={lessonId!} location={location} applyResult={applyResult} recorded={recorded} />;
}

/**
 * Separated so the hooks below always run with a resolved lesson — a bare
 * early return in the screen above would otherwise change hook order.
 */
function LessonPlayer({
  lessonId,
  location,
  applyResult,
  recorded,
}: {
  lessonId: string;
  location: NonNullable<ReturnType<typeof getLessonLocation>>;
  applyResult: ReturnType<typeof useProgressStore.getState>['applyResult'];
  recorded: { current: boolean };
}) {
  const { t } = useTranslation();
  const session = useLessonSession(location);

  // Fold the result into local progress exactly once.
  useEffect(() => {
    if (session.phase !== 'finished' || !session.outcome || recorded.current) return;
    recorded.current = true;
    applyResult({
      lessonId,
      unitId: location.unit.id,
      courseId: location.course.id,
      result: session.outcome,
    });
  }, [applyResult, lessonId, location, recorded, session.outcome, session.phase]);

  const next = getNextLesson(lessonId);

  return (
    <SessionRunner
      session={session}
      location={location}
      finishLabel={next ? t('results.continue') : t('common.done')}
      onExit={() => router.back()}
      onFinish={() => router.back()}
    />
  );
}
