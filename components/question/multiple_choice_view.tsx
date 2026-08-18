/**
 * Multiple choice question.
 *
 * Four options; exactly one right. Every state is carried by five redundant
 * channels — border weight, fill tint, whether the tile stays pressed into its
 * ledge, the letter badge, and haptics — so the answer never depends on colour
 * alone. Options that are code render in the mono face so a learner can tell
 * `print(name)` from "prints the name" at a glance.
 *
 * @module components/question/multiple_choice_view
 */

import { Pressable, View } from 'react-native';

import { Text } from '@/components/ui/text';
import type { MultipleChoiceQuestion } from '@/lib/content_schema';
import { tapFeedback } from '@/lib/haptics';
import { cn } from '@/lib/utils';
import { looksLikeCode, pick, QuestionShell, type QuestionViewProps } from './question_shell';

const LETTERS = ['A', 'B', 'C', 'D'];

export function MultipleChoiceView({
  question,
  locale,
  language,
  draft,
  onChange,
  disabled,
  result,
}: QuestionViewProps<MultipleChoiceQuestion>) {
  const selectedId = draft?.type === 'multiple_choice' ? draft.optionId : null;

  return (
    <QuestionShell prompt={pick(question.prompt, locale)} code={question.code} language={language}>
      <View className="gap-3" accessibilityRole="radiogroup">
        {question.options.map((option, index) => {
          const isSelected = selectedId === option.id;
          const isAnswer = option.id === question.answerId;
          // After checking, the right answer is always revealed, and a wrong
          // pick is marked too, so the learner sees both at once.
          const showCorrect = !!result && isAnswer;
          const showWrong = !!result && isSelected && !isAnswer;
          const pressedIntoLedge = showCorrect || showWrong;

          return (
            <View
              key={option.id}
              className={cn(
                'rounded-lg pb-[4px]',
                'bg-card-ledge',
                isSelected && !result && 'bg-primary-ledge',
                showCorrect && 'bg-success-ledge',
                showWrong && 'bg-destructive-ledge',
                // A resolved tile stays pressed down into its ledge.
                pressedIntoLedge && 'pb-0'
              )}>
              <Pressable
                disabled={disabled}
                accessibilityRole="radio"
                accessibilityState={{ checked: isSelected, disabled }}
                onPress={() => {
                  void tapFeedback();
                  onChange({ type: 'multiple_choice', optionId: option.id });
                }}
                className={cn(
                  'min-h-[56px] flex-row items-center gap-3 rounded-lg border-2 px-4 py-4',
                  'active:translate-y-[4px]',
                  'border-input bg-card',
                  isSelected && !result && 'border-[3px] border-primary bg-primary/15',
                  showCorrect && 'border-[3px] border-success bg-success/15',
                  showWrong && 'animate-shake border-[3px] border-destructive bg-destructive/15',
                  !!result && !showCorrect && !showWrong && 'opacity-55'
                )}>
                <View
                  className={cn(
                    'h-8 w-8 items-center justify-center rounded-sm border-2 border-input',
                    isSelected && !result && 'border-primary bg-primary',
                    showCorrect && 'border-success bg-success',
                    showWrong && 'border-destructive bg-destructive'
                  )}>
                  <Text
                    className={cn(
                      'font-mono-strong text-[13px] text-muted-foreground',
                      isSelected && !result && 'text-primary-foreground',
                      showCorrect && 'text-success-foreground',
                      showWrong && 'text-destructive-foreground'
                    )}
                    maxFontSizeMultiplier={1.4}>
                    {LETTERS[index] ?? String(index + 1)}
                  </Text>
                </View>

                <Text
                  className={cn(
                    'flex-1 font-sans text-[17px] leading-[26px] text-card-foreground',
                    looksLikeCode(option.text) && 'font-mono text-[15px]'
                  )}
                  maxFontSizeMultiplier={1.8}>
                  {pick(option.text, locale)}
                </Text>
              </Pressable>
            </View>
          );
        })}
      </View>
    </QuestionShell>
  );
}
