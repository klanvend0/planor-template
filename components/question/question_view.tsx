/**
 * Question dispatcher.
 *
 * Renders the view that matches the question's type. Keeping the switch in one
 * place means the lesson screen never grows a type check, and adding a question
 * type is a matter of writing a view and adding one branch.
 *
 * `explain_code` is handled by the lesson screen directly: it has its own submit
 * flow (AI grading) rather than the shared check button.
 *
 * @module components/question/question_view
 */

import type { Question } from '@/lib/content_schema';
import { FillBlankView } from './fill_blank_view';
import { MultipleChoiceView } from './multiple_choice_view';
import { OrderLinesView } from './order_lines_view';
import { SpotBugView } from './spot_bug_view';
import { TypeCodeView } from './type_code_view';
import type { QuestionViewProps } from './question_shell';

export function QuestionView(props: QuestionViewProps<Question>) {
  const { question } = props;

  switch (question.type) {
    case 'multiple_choice':
      return <MultipleChoiceView {...props} question={question} />;
    case 'fill_blank':
      return <FillBlankView {...props} question={question} />;
    case 'type_code':
      return <TypeCodeView {...props} question={question} />;
    case 'spot_bug':
      return <SpotBugView {...props} question={question} />;
    case 'order_lines':
      return <OrderLinesView {...props} question={question} />;
    case 'explain_code':
      // Rendered by the lesson screen, which owns the grading flow.
      return null;
  }
}

export { type QuestionViewProps } from './question_shell';
