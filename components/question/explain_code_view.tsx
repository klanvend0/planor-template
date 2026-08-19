/**
 * Explain-the-code question — the premium loop.
 *
 * The snippet carries its problem statement in comments written in the learner's
 * language; they explain what it does in their own words and a cheap model
 * grades the explanation against a rubric held server-side.
 *
 * Free learners see the locked state instead: the question is described honestly
 * and they can either start the trial or skip it, never a dead end.
 *
 * @module components/question/explain_code_view
 */

import { Lock, Sparkles } from 'lucide-react-native';
import { TextInput, View } from 'react-native';

import { CodeBlock } from '@/components/code_block';
import { GameButton } from '@/components/game_button';
import { Kicker } from '@/components/kicker';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { USES_LOCAL_BACKEND } from '@/lib/backend_mode';
import { EXPLANATION_MAX_CHARS, EXPLANATION_MIN_CHARS } from '@/lib/constants';
import type { ExplainCodeQuestion } from '@/lib/content_schema';
import { useTranslation } from '@/hooks/use_translation';
import type { SupportedLocale } from '@/lib/i18n';
import type { SyntaxLanguage } from '@/lib/syntax';
import { useSyntax } from '@/hooks/use_syntax';
import { cn } from '@/lib/utils';
import type { ExplanationReview } from '@/services/grading_service';
import { pick, QuestionPrompt } from './question_shell';

export type ExplainCodeViewProps = {
  question: ExplainCodeQuestion;
  locale: SupportedLocale;
  language: SyntaxLanguage;
  /** Draft text, owned by the lesson screen so it survives re-renders. */
  text: string;
  onChangeText: (text: string) => void;
  /** True when the learner may use the AI grader. */
  isPro: boolean;
  isGrading: boolean;
  review: ExplanationReview | null;
  onSubmit: () => void;
  onUpgrade: () => void;
  onSkip: () => void;
};

function VerdictBanner({ review }: { review: ExplanationReview }) {
  const { t } = useTranslation();
  const tone =
    review.verdict === 'correct'
      ? 'success'
      : review.verdict === 'partial'
        ? 'warning'
        : 'destructive';

  return (
    <View
      className={cn(
        'gap-2 rounded-2xl border-2 px-4 py-3',
        tone === 'success' && 'border-success bg-success/15',
        tone === 'warning' && 'border-warning bg-warning/15',
        tone === 'destructive' && 'border-destructive bg-destructive/15'
      )}>
      <View className="flex-row items-center justify-between">
        <Text
          className={cn(
            'font-strong text-base',
            tone === 'success' && 'text-success',
            tone === 'warning' && 'text-warning',
            tone === 'destructive' && 'text-destructive'
          )}>
          {review.verdict === 'correct'
            ? t('explain.verdict_correct')
            : review.verdict === 'partial'
              ? t('explain.verdict_partial')
              : t('explain.verdict_incorrect')}
        </Text>
        <Text className="font-strong text-sm text-muted-foreground">
          {t('explain.score', { score: review.score })}
        </Text>
      </View>

      <Text className="text-[15px] leading-6 text-foreground">{review.summary}</Text>

      {review.corrections.length > 0 ? (
        <View className="gap-1 pt-1">
          <Kicker className="tracking-wide">{t('explain.corrections')}</Kicker>
          {review.corrections.map((correction, index) => (
            <Text key={index} className="text-sm leading-5 text-foreground">
              {'• '}
              {correction}
            </Text>
          ))}
        </View>
      ) : null}

      {review.missedPoints.length > 0 ? (
        <View className="gap-1 pt-1">
          <Kicker className="tracking-wide">{t('explain.missed')}</Kicker>
          {review.missedPoints.map((point, index) => (
            <Text key={index} className="text-sm leading-5 text-foreground">
              {'• '}
              {point}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

export function ExplainCodeView({
  question,
  locale,
  language,
  text,
  onChangeText,
  isPro,
  isGrading,
  review,
  onSubmit,
  onUpgrade,
  onSkip,
}: ExplainCodeViewProps) {
  const { t } = useTranslation();
  const syntax = useSyntax();
  const code = pick(question.code, locale);
  const length = text.trim().length;
  const canSubmit =
    length >= EXPLANATION_MIN_CHARS && length <= EXPLANATION_MAX_CHARS && !isGrading;

  if (!isPro) {
    return (
      <View className="gap-5">
        <QuestionPrompt>{t('explain.title')}</QuestionPrompt>
        <CodeBlock code={code} language={language} />

        <View className="gap-3 rounded-2xl border-2 border-primary/40 bg-primary/10 px-4 py-5">
          <View className="flex-row items-center gap-2">
            <Icon as={Lock} size={18} className="text-primary" />
            <Text className="font-strong text-base text-foreground">
              {t('explain.locked_title')}
            </Text>
          </View>
          <Text className="text-[15px] leading-6 text-muted-foreground">
            {t('explain.locked_body')}
          </Text>
          <GameButton label={t('explain.locked_cta')} onPress={onUpgrade} className="mt-1" />
          <GameButton label={t('explain.locked_skip')} variant="ghost" onPress={onSkip} flat />
        </View>
      </View>
    );
  }

  return (
    <View className="gap-5">
      <View className="flex-row items-center gap-2">
        <Icon as={Sparkles} size={18} className="text-primary" />
        <Kicker className="text-sm tracking-wide text-primary">
          {USES_LOCAL_BACKEND ? t('explain.local_title') : t('explain.title')}
        </Kicker>
      </View>

      <QuestionPrompt>{pick(question.prompt, locale)}</QuestionPrompt>
      <CodeBlock code={code} language={language} />

      {review ? (
        <>
          <View className="rounded-2xl border border-border bg-card px-4 py-3">
            <Text className="text-[15px] leading-6 text-foreground">{text.trim()}</Text>
          </View>
          <VerdictBanner review={review} />
          <View className="gap-1">
            <Kicker className="tracking-wide">{t('explain.sample_title')}</Kicker>
            <Text className="text-[15px] leading-6 text-muted-foreground">
              {pick(question.sampleAnswer, locale)}
            </Text>
          </View>
        </>
      ) : (
        <>
          <View className="rounded-2xl border-2 border-border bg-card px-4 py-3">
            <TextInput
              value={text}
              onChangeText={onChangeText}
              editable={!isGrading}
              multiline
              maxLength={EXPLANATION_MAX_CHARS + 40}
              placeholder={t('explain.placeholder')}
              placeholderTextColor={syntax.comment}
              autoCapitalize="sentences"
              accessibilityLabel={t('explain.instruction')}
              className="min-h-[104px] text-[16px] leading-6 text-foreground"
              textAlignVertical="top"
            />
            <View className="flex-row items-center justify-between pt-2">
              <Text className="text-xs text-muted-foreground">{t('explain.instruction')}</Text>
              <Text
                className={cn(
                  'font-strong text-xs',
                  length > EXPLANATION_MAX_CHARS ? 'text-destructive' : 'text-muted-foreground'
                )}>
                {t('explain.counter', { count: length })}
              </Text>
            </View>
          </View>

          <GameButton
            label={isGrading ? t('explain.grading') : t('explain.submit')}
            onPress={onSubmit}
            disabled={!canSubmit}
            busy={isGrading}
          />
        </>
      )}
    </View>
  );
}
