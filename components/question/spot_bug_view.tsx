/**
 * Spot-the-bug question.
 *
 * The learner taps the line that is wrong — a misspelled variable, a value used
 * before it exists, a missing colon. After checking, the buggy line is marked
 * and the fix is shown beside it.
 *
 * @module components/question/spot_bug_view
 */

import { View } from 'react-native';

import { CodeBlock } from '@/components/code_block';
import { Text } from '@/components/ui/text';
import type { SpotBugQuestion } from '@/lib/content_schema';
import { tapFeedback } from '@/lib/haptics';
import { useTranslation } from '@/hooks/use_translation';
import { pick, QuestionShell, type QuestionViewProps } from './question_shell';

export function SpotBugView({
  question,
  locale,
  language,
  draft,
  onChange,
  disabled,
  result,
}: QuestionViewProps<SpotBugQuestion>) {
  const { t } = useTranslation();
  const selected = draft?.type === 'spot_bug' ? draft.lineIndex : null;

  return (
    <QuestionShell
      prompt={pick(question.prompt, locale)}
      language={language}
      hint={disabled ? undefined : t('lesson.which_line')}>
      <CodeBlock
        code={question.codeLines.join('\n')}
        language={language}
        showLineNumbers
        selectedLine={selected}
        // Once checked, the wrong pick and the real culprit are both marked.
        errorLine={result && !result.isCorrect ? selected : null}
        correctLine={result ? question.buggyLineIndex : null}
        onPressLine={
          disabled
            ? undefined
            : (lineIndex) => {
                void tapFeedback();
                onChange({ type: 'spot_bug', lineIndex });
              }
        }
      />

      {result ? (
        <View className="gap-1">
          <Text className="text-sm font-semibold text-muted-foreground">
            {t('lesson.correct_answer')}
          </Text>
          <CodeBlock code={question.fix} language={language} compact />
        </View>
      ) : null}
    </QuestionShell>
  );
}
