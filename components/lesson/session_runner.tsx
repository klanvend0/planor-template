/**
 * The lesson player.
 *
 * Renders a {@link LessonSession} from the teaching card through to the results,
 * and is shared by lessons and practice runs so both behave identically.
 *
 * @module components/lesson/session_runner
 */

import { router } from 'expo-router';
import { X } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GameButton } from '@/components/game_button';
import { HeartsIndicator, ProgressBar } from '@/components/game_hud';
import { ConceptCard } from '@/components/lesson/concept_card';
import { OutOfHearts } from '@/components/lesson/out_of_hearts';
import { ResultsView } from '@/components/lesson/results_view';
import { ExplainCodeView } from '@/components/question/explain_code_view';
import { FeedbackPanel } from '@/components/question/feedback_panel';
import { QuestionView } from '@/components/question/question_view';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { useTranslation } from '@/hooks/use_translation';
import type { LessonSession } from '@/hooks/use_lesson_session';
import type { AnswerInput } from '@/lib/answer_check';
import { expectedAnswerText } from '@/lib/answer_check';
import { track } from '@/lib/analytics';
import { localized } from '@/lib/content_schema';
import { errorMessageKey } from '@/lib/errors';
import { celebrateFeedback } from '@/lib/haptics';
import type { LessonLocation } from '@/services/content_service';
import { useGameStore } from '@/stores/game_store';

export type SessionRunnerProps = {
  session: LessonSession;
  location: LessonLocation;
  /** Practice runs skip the teaching card and pay the smaller reward. */
  mode?: 'lesson' | 'practice';
  /** Label for the button on the results screen. */
  finishLabel?: string;
  onExit: () => void;
  onFinish: () => void;
};

export function SessionRunner({
  session,
  location,
  mode = 'lesson',
  finishLabel,
  onExit,
  onFinish,
}: SessionRunnerProps) {
  const { t, locale } = useTranslation();
  const insets = useSafeAreaInsets();

  const [draft, setDraft] = useState<AnswerInput | null>(null);
  const [explanation, setExplanation] = useState('');
  const [refillBusy, setRefillBusy] = useState(false);

  const gameState = useGameStore((state) => state.state);
  const refill = useGameStore((state) => state.refill);
  const isPro = gameState?.hasSubscription ?? false;
  const language = location.course.language;

  // A new question always starts from a clean slate.
  useEffect(() => {
    setDraft(null);
    setExplanation('');
  }, [session.question?.id]);

  useEffect(() => {
    if (session.phase !== 'finished' || !session.outcome) return;
    void celebrateFeedback();
    track('lesson_completed', {
      lesson_id: location.lesson.id,
      course: location.course.id,
      score: session.outcome.score,
      stars: session.outcome.stars,
      xp: session.outcome.xpAwarded,
      duration_ms: session.elapsedMs,
    });
  }, [location.course.id, location.lesson.id, session.elapsedMs, session.outcome, session.phase]);

  useEffect(() => {
    if (session.phase === 'out_of_hearts') track('hearts_depleted', { lesson_id: location.lesson.id });
  }, [location.lesson.id, session.phase]);

  useEffect(() => {
    if (!session.error) return;
    Alert.alert(t('app.name'), t(errorMessageKey(session.error.code)));
    session.clearError();
  }, [session, t]);

  const confirmExit = () => {
    if (session.phase === 'finished') {
      onExit();
      return;
    }
    Alert.alert(t('lesson.exit_title'), t('lesson.exit_body'), [
      { text: t('lesson.exit_stay'), style: 'cancel' },
      { text: t('lesson.exit_confirm'), style: 'destructive', onPress: onExit },
    ]);
  };

  // ---------------------------------------------------------------------------
  // Results
  // ---------------------------------------------------------------------------

  if (session.phase === 'finished') {
    if (!session.outcome) {
      // The write failed and no result came back; do not invent numbers.
      return (
        <View className="flex-1 items-center justify-center gap-5 bg-background px-8">
          <Text className="text-center font-display text-2xl text-foreground">
            {t('results.title_ok')}
          </Text>
          <Text className="text-center text-[15px] text-muted-foreground">
            {t('errors.network')}
          </Text>
          <GameButton label={t('common.continue')} onPress={onFinish} />
        </View>
      );
    }

    return (
      <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
        <ResultsView
          result={session.outcome}
          elapsedMs={session.elapsedMs}
          isPractice={mode === 'practice'}
          onContinue={onFinish}
          continueLabel={finishLabel}
        />
      </View>
    );
  }

  // ---------------------------------------------------------------------------
  // Out of hearts
  // ---------------------------------------------------------------------------

  if (session.phase === 'out_of_hearts') {
    return (
      <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
        <OutOfHearts
          heartsUpdatedAt={gameState?.heartsUpdatedAt ?? new Date().toISOString()}
          refillBusy={refillBusy}
          onRefill={async () => {
            setRefillBusy(true);
            try {
              await refill();
              session.resume();
            } catch {
              Alert.alert(t('hearts.empty_title'), t('hearts.refill_free_used'));
            } finally {
              setRefillBusy(false);
            }
          }}
          onPractice={() => {
            onExit();
            router.push({ pathname: '/practice/[deck]', params: { deck: 'mistakes' } });
          }}
          onUpgrade={() => router.push('/paywall')}
          onClose={onExit}
        />
      </View>
    );
  }

  const question = session.question;

  // ---------------------------------------------------------------------------
  // Concept card
  // ---------------------------------------------------------------------------

  if (session.phase === 'concept') {
    return (
      <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
        <View className="flex-row items-center gap-4 px-5 py-3">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('common.close')}
            hitSlop={12}
            onPress={onExit}>
            <Icon as={X} size={26} className="text-muted-foreground" />
          </Pressable>
          <Text className="flex-1 font-semibold text-sm text-muted-foreground" numberOfLines={1}>
            {localized(location.unit.title, locale)}
          </Text>
        </View>

        <ScrollView className="flex-1" contentContainerClassName="px-6 pb-8 pt-2">
          <ConceptCard lesson={location.lesson} locale={locale} language={language} />
        </ScrollView>

        <View className="px-6" style={{ paddingBottom: insets.bottom + 12 }}>
          <GameButton label={t('lesson.concept_cta')} size="lg" onPress={session.begin} />
        </View>
      </View>
    );
  }

  if (!question) return null;

  const isExplain = question.type === 'explain_code';
  const showFeedback = session.phase === 'feedback' && !!session.lastResult;
  // The AI question carries its own verdict banner, so the generic panel would
  // only repeat it.
  const showGenericFeedback = showFeedback && !isExplain;

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-background"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ paddingTop: insets.top }}>
      {/* HUD */}
      <View className="flex-row items-center gap-4 px-5 py-3">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common.close')}
          hitSlop={12}
          onPress={confirmExit}>
          <Icon as={X} size={26} className="text-muted-foreground" />
        </Pressable>
        <ProgressBar progress={session.progress} />
        <HeartsIndicator hearts={gameState?.hearts ?? 5} unlimited={isPro} />
      </View>

      <ScrollView
        className="flex-1"
        contentContainerClassName="px-6 pb-8 pt-2"
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive">
        <Text className="mb-4 font-bold text-xs uppercase tracking-widest text-muted-foreground">
          {t('lesson.question_of', { current: session.position, total: session.total })}
        </Text>

        {isExplain ? (
          <ExplainCodeView
            question={question}
            locale={locale}
            language={language}
            text={explanation}
            onChangeText={setExplanation}
            isPro={isPro}
            isGrading={session.isGrading}
            review={session.review}
            onSubmit={() => void session.submitExplanation(explanation)}
            onUpgrade={() => router.push('/paywall')}
            onSkip={session.skip}
          />
        ) : (
          <QuestionView
            question={question}
            locale={locale}
            language={language}
            draft={draft}
            onChange={setDraft}
            disabled={session.phase !== 'question'}
            result={session.lastResult}
          />
        )}
      </ScrollView>

      {/* Action area */}
      {showGenericFeedback && session.lastResult ? (
        <View style={{ paddingBottom: insets.bottom + 8 }}>
          <FeedbackPanel
            isCorrect={session.lastResult.isCorrect}
            correctAnswer={session.lastResult.isCorrect ? null : expectedAnswerText(question)}
            explanation={localized(question.explanation, locale)}
            busy={session.isFinishing}
            onContinue={() => void session.next()}
          />
        </View>
      ) : (
        <View className="px-6 pt-2" style={{ paddingBottom: insets.bottom + 12 }}>
          {isExplain && showFeedback ? (
            <GameButton
              label={t('lesson.continue')}
              variant={session.lastResult?.isCorrect ? 'success' : 'destructive'}
              size="lg"
              busy={session.isFinishing}
              onPress={() => void session.next()}
            />
          ) : isExplain ? null : (
            <GameButton
              label={t('lesson.check')}
              size="lg"
              disabled={!draft}
              onPress={() => draft && void session.submit(draft)}
            />
          )}
        </View>
      )}
    </KeyboardAvoidingView>
  );
}
