/**
 * Type-the-code question.
 *
 * A plain input with autocorrect, autocapitalisation and smart punctuation all
 * turned off — iOS would happily turn `"` into `"` and break every answer.
 *
 * @module components/question/type_code_view
 */

import { TextInput, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { CodeBlock } from '@/components/code_block';
import type { TypeCodeQuestion } from '@/lib/content_schema';
import { useTranslation } from '@/hooks/use_translation';
import { SYNTAX } from '@/lib/theme';
import { cn } from '@/lib/utils';
import { pick, QuestionShell, type QuestionViewProps } from './question_shell';

export function TypeCodeView({
  question,
  locale,
  language,
  draft,
  onChange,
  disabled,
  result,
}: QuestionViewProps<TypeCodeQuestion>) {
  const { t } = useTranslation();
  const value = draft?.type === 'type_code' ? draft.text : '';

  return (
    <QuestionShell prompt={pick(question.prompt, locale)} language={language}>
      {question.code ? <CodeBlock code={question.code} language={language} /> : null}

      <View
        className={cn(
          'rounded-xl border-2 border-code-border bg-code px-4 py-3',
          result && (result.isCorrect ? 'border-success' : 'border-destructive')
        )}>
        <TextInput
          value={value}
          editable={!disabled}
          onChangeText={(text) => onChange(text.trim() ? { type: 'type_code', text } : null)}
          placeholder={t('lesson.type_here')}
          placeholderTextColor={SYNTAX.comment}
          // Everything the keyboard normally "helps" with breaks code.
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="off"
          spellCheck={false}
          keyboardAppearance="dark"
          multiline={question.expected.includes('\n')}
          accessibilityLabel={pick(question.prompt, locale)}
          className="min-h-[28px] font-mono text-[16px]"
          style={{ color: SYNTAX.plain }}
        />
      </View>

      {result && !result.isCorrect ? (
        <View className="gap-1">
          <Text className="text-sm font-semibold text-muted-foreground">
            {t('lesson.correct_answer')}
          </Text>
          <CodeBlock code={question.expected} language={language} compact />
        </View>
      ) : null}
    </QuestionShell>
  );
}
