/**
 * Shared pieces for question views.
 *
 * Every question type renders the same frame — an instruction, an optional code
 * snippet, then its own answer surface — so the frame lives here and the type
 * components stay focused on their interaction.
 *
 * @module components/question/question_shell
 */

import type { ReactNode } from 'react';
import { View } from 'react-native';

import { CodeBlock } from '@/components/code_block';
import { Text } from '@/components/ui/text';
import type { AnswerInput, CheckResult } from '@/lib/answer_check';
import type { Localized, Question } from '@/lib/content_schema';
import type { SupportedLocale } from '@/lib/i18n';
import type { SyntaxLanguage } from '@/lib/syntax';
import { cn } from '@/lib/utils';

/** Props every question view receives from the lesson screen. */
export type QuestionViewProps<Q extends Question = Question> = {
  question: Q;
  locale: SupportedLocale;
  language: SyntaxLanguage;
  /** The answer being composed, or null while it is still incomplete. */
  draft: AnswerInput | null;
  /** Report a new draft; pass null to disable the check button again. */
  onChange: (draft: AnswerInput | null) => void;
  /** True once the answer has been checked — the view becomes read-only. */
  disabled: boolean;
  /** Grading outcome, available after checking. */
  result: CheckResult | null;
};

/** Read a localized string in the active locale, falling back to English. */
export function pick(value: Localized, locale: SupportedLocale): string {
  return value[locale] || value.en;
}

/**
 * True when a piece of option text should be rendered as code rather than prose.
 *
 * Options that are the same in both locales are usually literal values or
 * snippets; the character test keeps plain words like "5" or "true" as prose
 * only when they carry no code punctuation.
 */
export function looksLikeCode(value: Localized): boolean {
  const text = value.en.trim();
  if (value.en !== value.tr) return false;
  return /[()[\]{}=+*/%<>#"']|\b(print|console|def|function|let|const|return|for|while|if)\b/.test(
    text
  );
}

/** Instruction line above every question. */
export function QuestionPrompt({ children }: { children: string }) {
  return (
    <Text className="font-bold text-[22px] leading-8 text-foreground" accessibilityRole="header">
      {children}
    </Text>
  );
}

/** Small helper line, e.g. "Tap a token to fill the blank". */
export function QuestionHint({ children }: { children: string }) {
  return <Text className="text-sm text-muted-foreground">{children}</Text>;
}

/**
 * Frame shared by every question type.
 */
export function QuestionShell({
  prompt,
  code,
  language,
  hint,
  children,
  className,
}: {
  prompt: string;
  code?: string | null;
  language: SyntaxLanguage;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <View className={cn('gap-5', className)}>
      <QuestionPrompt>{prompt}</QuestionPrompt>
      {code ? <CodeBlock code={code} language={language} /> : null}
      {hint ? <QuestionHint>{hint}</QuestionHint> : null}
      {children}
    </View>
  );
}
