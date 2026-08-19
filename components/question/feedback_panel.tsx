/**
 * Answer feedback panel.
 *
 * Slides up under the question the moment an answer is checked: verdict,
 * the right answer when it was missed, and the *why* — the explanation is the
 * part that teaches, so it is always shown, including after a correct answer.
 *
 * @module components/question/feedback_panel
 */

import { CheckCircle2, XCircle } from 'lucide-react-native';
import { View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { GameButton } from '@/components/game_button';
import { Kicker } from '@/components/kicker';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { useTranslation } from '@/hooks/use_translation';
import { cn } from '@/lib/utils';

export type FeedbackPanelProps = {
  isCorrect: boolean;
  /** Rendered when the answer was wrong; already localized. */
  correctAnswer?: string | null;
  /** Why the answer is what it is, in the learner's language. */
  explanation: string;
  onContinue: () => void;
  busy?: boolean;
  /** Label override for the continue button (e.g. on the last question). */
  continueLabel?: string;
};

export function FeedbackPanel({
  isCorrect,
  correctAnswer,
  explanation,
  onContinue,
  busy = false,
  continueLabel,
}: FeedbackPanelProps) {
  const { t } = useTranslation();

  return (
    <Animated.View
      entering={FadeInDown.springify().damping(18).stiffness(180)}
      className={cn(
        'gap-3 rounded-t-3xl border-t-2 px-5 pb-2 pt-4',
        isCorrect ? 'bg-success/12 border-success' : 'bg-destructive/12 border-destructive'
      )}>
      <View className="flex-row items-center gap-2">
        <Icon
          as={isCorrect ? CheckCircle2 : XCircle}
          size={26}
          className={isCorrect ? 'text-success' : 'text-destructive'}
        />
        <Text
          className={cn('font-display text-xl', isCorrect ? 'text-success' : 'text-destructive')}>
          {isCorrect ? t('lesson.correct') : t('lesson.incorrect')}
        </Text>
      </View>

      {!isCorrect && correctAnswer ? (
        <View className="gap-0.5">
          <Kicker className="tracking-wide">{t('lesson.correct_answer')}</Kicker>
          <Text className="font-mono text-[15px] text-foreground">{correctAnswer}</Text>
        </View>
      ) : null}

      <View className="gap-0.5">
        <Kicker className="tracking-wide">{t('lesson.why')}</Kicker>
        <Text className="text-[15px] leading-6 text-foreground">{explanation}</Text>
      </View>

      {/* After a wrong answer the neutral button leads: the primary action
          colour never shares a frame with an error state. */}
      <GameButton
        label={continueLabel ?? t('lesson.continue')}
        variant={isCorrect ? 'success' : 'secondary'}
        onPress={onContinue}
        busy={busy}
        className="mt-1"
      />
    </Animated.View>
  );
}
