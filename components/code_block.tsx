/**
 * Syntax-highlighted code surface.
 *
 * The most-used component in the app: every question, concept card and feedback
 * sheet renders code through it. The surface stays dark in both themes so a
 * snippet always reads like an editor, and long lines scroll horizontally rather
 * than wrapping, because wrapped code lies about its structure.
 *
 * @module components/code_block
 */

import { memo } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { useSyntax } from '@/hooks/use_syntax';
import { tokenizeLines, type SyntaxLanguage } from '@/lib/syntax';
import type { SyntaxPalette } from '@/lib/theme';
import { cn } from '@/lib/utils';

export type CodeBlockProps = {
  /** Source to display. Trailing whitespace is trimmed, indentation is kept. */
  code: string;
  language: SyntaxLanguage;
  /** Show 1-based line numbers down the left edge. */
  showLineNumbers?: boolean;
  /** Make each line tappable — used by "spot the bug" questions. */
  onPressLine?: (lineIndex: number) => void;
  /** Line the learner has tapped. */
  selectedLine?: number | null;
  /** Line to mark as wrong (after an incorrect answer). */
  errorLine?: number | null;
  /** Line to mark as right (in the feedback sheet). */
  correctLine?: number | null;
  className?: string;
  /** Smaller type, for inline use inside option rows. */
  compact?: boolean;
};

function LineContent({
  line,
  compact,
  syntax,
}: {
  line: { text: string; type: keyof SyntaxPalette }[];
  compact?: boolean;
  syntax: SyntaxPalette;
}) {
  return (
    <Text
      className={cn('font-mono leading-6', compact ? 'text-[13px]' : 'text-[15px]')}
      style={{ color: syntax.plain }}>
      {line.length === 0 ? ' ' : null}
      {line.map((token, index) => (
        <Text
          key={`${index}-${token.text}`}
          className={cn('font-mono', compact ? 'text-[13px]' : 'text-[15px]')}
          style={{ color: syntax[token.type] }}>
          {token.text}
        </Text>
      ))}
    </Text>
  );
}

function CodeBlockImpl({
  code,
  language,
  showLineNumbers = false,
  onPressLine,
  selectedLine = null,
  errorLine = null,
  correctLine = null,
  className,
  compact = false,
}: CodeBlockProps) {
  const syntax = useSyntax();
  const lines = tokenizeLines(code.replace(/\s+$/, ''), language);

  return (
    <View
      className={cn(
        'overflow-hidden rounded-md border-[1.5px] border-code-border bg-code',
        compact ? 'py-2' : 'py-3',
        className
      )}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerClassName={compact ? 'px-3' : 'px-4'}
        // Codes lines are short; bouncing feels wrong on a static block.
        bounces={false}>
        <View>
          {lines.map((line, index) => {
            const isSelected = selectedLine === index;
            const isError = errorLine === index;
            const isCorrect = correctLine === index;

            const row = (
              <View
                className={cn(
                  'flex-row items-center rounded-md px-2 py-0.5',
                  isSelected && !isError && !isCorrect && 'bg-primary/25',
                  isError && 'bg-destructive/25',
                  isCorrect && 'bg-success/25'
                )}>
                {showLineNumbers ? (
                  <Text
                    className="mr-3 w-5 text-right font-mono text-[13px]"
                    style={{ color: syntax.gutter }}>
                    {index + 1}
                  </Text>
                ) : null}
                <LineContent line={line} compact={compact} syntax={syntax} />
              </View>
            );

            if (!onPressLine) {
              return <View key={index}>{row}</View>;
            }

            return (
              <Pressable
                key={index}
                onPress={() => onPressLine(index)}
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected }}
                // Rows are short; the hit slop keeps them a comfortable target.
                hitSlop={{ top: 4, bottom: 4 }}>
                {row}
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

export const CodeBlock = memo(CodeBlockImpl);

/**
 * Inline code, for a single token inside a sentence.
 */
export function InlineCode({ children, className }: { children: string; className?: string }) {
  const syntax = useSyntax();

  return (
    <Text
      className={cn(
        'rounded-md border border-code-border bg-code px-1.5 py-0.5 font-mono text-[13px]',
        className
      )}
      style={{ color: syntax.plain }}>
      {children}
    </Text>
  );
}
