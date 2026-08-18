/**
 * Fill-in-the-blank question.
 *
 * The snippet is shown with `___` placeholders rendered as chips; tokens are
 * tapped from a shuffled bank below and tapped again to take them back. No
 * keyboard, so it works one-handed on a phone.
 *
 * @module components/question/fill_blank_view
 */

import { useMemo } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { tokenBank } from '@/lib/answer_check';
import type { FillBlankQuestion } from '@/lib/content_schema';
import { tapFeedback } from '@/lib/haptics';
import { useTranslation } from '@/hooks/use_translation';
import { tokenize } from '@/lib/syntax';
import { useSyntax } from '@/hooks/use_syntax';
import { cn } from '@/lib/utils';
import { pick, QuestionShell, type QuestionViewProps } from './question_shell';

/** Split the template into text segments and blanks, preserving order. */
function segments(
  template: string
): { kind: 'text' | 'blank'; value: string; blankIndex: number }[] {
  const parts = template.split('___');
  const result: { kind: 'text' | 'blank'; value: string; blankIndex: number }[] = [];

  parts.forEach((part, index) => {
    if (part) result.push({ kind: 'text', value: part, blankIndex: -1 });
    if (index < parts.length - 1) result.push({ kind: 'blank', value: '', blankIndex: index });
  });

  return result;
}

export function FillBlankView({
  question,
  locale,
  language,
  draft,
  onChange,
  disabled,
  result,
}: QuestionViewProps<FillBlankQuestion>) {
  const { t } = useTranslation();
  const syntax = useSyntax();
  const bank = useMemo(() => tokenBank(question), [question]);

  const filled: (string | null)[] =
    draft?.type === 'fill_blank' ? draft.tokens : question.blanks.map(() => null);

  const emit = (next: (string | null)[]) => {
    const complete = next.every((token) => token !== null);
    onChange(complete ? { type: 'fill_blank', tokens: next } : null);
  };

  const place = (token: string) => {
    if (disabled) return;
    const target = filled.findIndex((entry) => entry === null);
    if (target < 0) return;
    void tapFeedback();
    const next = [...filled];
    next[target] = token;
    emit(next);
  };

  const clear = (blankIndex: number) => {
    if (disabled) return;
    void tapFeedback();
    const next = [...filled];
    next[blankIndex] = null;
    emit(next);
  };

  // A token can be used once per occurrence in the bank.
  const usedCounts = filled.reduce<Record<string, number>>((counts, token) => {
    if (token) counts[token] = (counts[token] ?? 0) + 1;
    return counts;
  }, {});

  const lines = question.codeTemplate.split('\n');

  return (
    <QuestionShell
      prompt={pick(question.prompt, locale)}
      language={language}
      hint={disabled ? undefined : t('lesson.tap_to_fill')}>
      {/* The snippet, with tappable chips where the blanks are. */}
      <View className="overflow-hidden rounded-xl border border-code-border bg-code py-3">
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerClassName="px-4">
          <View>
            {lines.map((line, lineIndex) => {
              // Blanks are numbered across the whole template, not per line.
              const before = lines.slice(0, lineIndex).join('\n');
              const offset = (before.match(/___/g) ?? []).length;

              return (
                <View key={lineIndex} className="flex-row flex-wrap items-center py-0.5">
                  {segments(line).map((segment, segmentIndex) => {
                    if (segment.kind === 'text') {
                      return (
                        <Text key={segmentIndex} className="font-mono text-[15px] leading-7">
                          {tokenize(segment.value, language).map((token, tokenIndex) => (
                            <Text
                              key={tokenIndex}
                              className="font-mono text-[15px]"
                              style={{ color: syntax[token.type] }}>
                              {token.text}
                            </Text>
                          ))}
                        </Text>
                      );
                    }

                    const blankIndex = offset + segment.blankIndex;
                    const value = filled[blankIndex];
                    const isRight = !!result && value === question.blanks[blankIndex]?.answer;

                    return (
                      <Pressable
                        key={segmentIndex}
                        disabled={disabled || !value}
                        onPress={() => clear(blankIndex)}
                        accessibilityRole="button"
                        accessibilityLabel={value ?? t('lesson.tap_to_fill')}
                        className={cn(
                          'mx-1 min-w-[64px] items-center justify-center rounded-lg border-2 px-2 py-1',
                          value
                            ? 'border-primary bg-primary/20'
                            : 'border-dashed border-code-border',
                          result &&
                            (isRight
                              ? 'border-success bg-success/20'
                              : 'border-destructive bg-destructive/20')
                        )}>
                        <Text className="font-mono text-[15px]" style={{ color: syntax.plain }}>
                          {value ?? ' '}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              );
            })}
          </View>
        </ScrollView>
      </View>

      {/* Token bank */}
      <View className="flex-row flex-wrap gap-2">
        {bank.map((token, index) => {
          const available = (usedCounts[token] ?? 0) === 0;
          return (
            <Pressable
              key={`${token}-${index}`}
              disabled={disabled || !available}
              onPress={() => place(token)}
              accessibilityRole="button"
              className={cn(
                'rounded-xl border-2 border-border bg-card px-3 py-2.5',
                !available && 'opacity-30'
              )}>
              <Text className="font-mono text-[15px] text-foreground">{token}</Text>
            </Pressable>
          );
        })}
      </View>
    </QuestionShell>
  );
}
