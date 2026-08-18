/**
 * Multiple choice question.
 *
 * Four options; exactly one right. Options that are code render in the mono
 * face so a learner can tell `print(name)` from "prints the name" at a glance.
 *
 * @module components/question/multiple_choice_view
 */

import { Pressable, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { tapFeedback } from '@/lib/haptics';
import type { MultipleChoiceQuestion } from '@/lib/content_schema';
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
      <View className="gap-3">
        {question.options.map((option, index) => {
          const isSelected = selectedId === option.id;
          const isAnswer = option.id === question.answerId;
          // After checking, the right answer is always revealed, and a wrong
          // pick is marked so the learner sees both at once.
          const showCorrect = !!result && isAnswer;
          const showWrong = !!result && isSelected && !isAnswer;

          return (
            <Pressable
              key={option.id}
              disabled={disabled}
              accessibilityRole="radio"
              accessibilityState={{ checked: isSelected, disabled }}
              onPress={() => {
                void tapFeedback();
                onChange({ type: 'multiple_choice', optionId: option.id });
              }}
              className={cn(
                'flex-row items-center gap-3 rounded-2xl border-2 bg-card px-4 py-4',
                'border-border',
                isSelected && !result && 'border-primary bg-primary/10',
                showCorrect && 'border-success bg-success/15',
                showWrong && 'border-destructive bg-destructive/15'
              )}>
              <View
                className={cn(
                  'h-8 w-8 items-center justify-center rounded-lg border-2 border-border',
                  isSelected && !result && 'border-primary bg-primary',
                  showCorrect && 'border-success bg-success',
                  showWrong && 'border-destructive bg-destructive'
                )}>
                <Text
                  className={cn(
                    'font-strong text-sm text-muted-foreground',
                    isSelected && !result && 'text-primary-foreground',
                    showCorrect && 'text-success-foreground',
                    showWrong && 'text-destructive-foreground'
                  )}>
                  {LETTERS[index] ?? String(index + 1)}
                </Text>
              </View>

              <Text
                className={cn(
                  'flex-1 text-base text-foreground',
                  looksLikeCode(option.text) && 'font-mono text-[15px]'
                )}>
                {pick(option.text, locale)}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </QuestionShell>
  );
}
