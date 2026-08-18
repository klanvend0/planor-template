/**
 * Reorder-the-lines question.
 *
 * Shuffled lines are tapped in order into a stack above; tapping a placed line
 * takes it back. Indentation is part of the line text and is preserved, because
 * in Python it is the difference between a loop body and the line after it.
 *
 * @module components/question/order_lines_view
 */

import { useMemo } from 'react';
import { Pressable, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { seededShuffle } from '@/lib/answer_check';
import type { OrderLinesQuestion } from '@/lib/content_schema';
import { tapFeedback } from '@/lib/haptics';
import { useTranslation } from '@/hooks/use_translation';
import { tokenize } from '@/lib/syntax';
import { SYNTAX } from '@/lib/theme';
import { cn } from '@/lib/utils';
import { pick, QuestionShell, type QuestionViewProps } from './question_shell';

function CodeLine({ text, language }: { text: string; language: 'python' | 'javascript' }) {
  return (
    <Text className="font-mono text-[15px]">
      {tokenize(text, language).map((token, index) => (
        <Text key={index} className="font-mono text-[15px]" style={{ color: SYNTAX[token.type] }}>
          {token.text}
        </Text>
      ))}
    </Text>
  );
}

export function OrderLinesView({
  question,
  locale,
  language,
  draft,
  onChange,
  disabled,
  result,
}: QuestionViewProps<OrderLinesQuestion>) {
  const { t } = useTranslation();
  const shuffled = useMemo(() => seededShuffle(question.lines, question.id), [question]);
  const placed = draft?.type === 'order_lines' ? draft.lines : [];

  const emit = (next: string[]) => {
    onChange(next.length === question.lines.length ? { type: 'order_lines', lines: next } : null);
  };

  const remaining = shuffled.filter((line) => {
    const placedCount = placed.filter((entry) => entry === line).length;
    const totalCount = shuffled.filter((entry) => entry === line).length;
    return placedCount < totalCount;
  });

  return (
    <QuestionShell
      prompt={pick(question.prompt, locale)}
      language={language}
      hint={disabled ? undefined : t('lesson.reorder')}>
      {/* Answer stack */}
      <View
        className={cn(
          'min-h-[120px] justify-center rounded-xl border-2 border-dashed border-code-border bg-code px-4 py-3',
          result &&
            (result.isCorrect ? 'border-solid border-success' : 'border-solid border-destructive')
        )}>
        {placed.length === 0 ? (
          <Text className="text-center text-sm" style={{ color: SYNTAX.comment }}>
            {t('lesson.reorder')}
          </Text>
        ) : (
          placed.map((line, index) => (
            <Pressable
              key={`${line}-${index}`}
              disabled={disabled}
              onPress={() => {
                void tapFeedback();
                emit(placed.filter((_, position) => position !== index));
              }}
              className="py-0.5">
              <CodeLine text={line} language={language} />
            </Pressable>
          ))
        )}
      </View>

      {/* Remaining lines */}
      <View className="gap-2">
        {remaining.map((line, index) => (
          <Pressable
            key={`${line}-${index}`}
            disabled={disabled}
            onPress={() => {
              void tapFeedback();
              emit([...placed, line]);
            }}
            className="rounded-xl border-2 border-border bg-card px-3 py-2.5">
            <CodeLine text={line} language={language} />
          </Pressable>
        ))}
      </View>

      {result && !result.isCorrect ? (
        <View className="gap-1">
          <Text className="font-semibold text-sm text-muted-foreground">
            {t('lesson.correct_answer')}
          </Text>
          <View className="rounded-xl border border-code-border bg-code px-4 py-3">
            {question.lines.map((line, index) => (
              <CodeLine key={index} text={line} language={language} />
            ))}
          </View>
        </View>
      ) : null}
    </QuestionShell>
  );
}
