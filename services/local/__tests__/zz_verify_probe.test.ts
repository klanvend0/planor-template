import { gradeLocally } from '@/services/local/grader';
import { getQuestion } from '@/services/content_service';

it('probe', () => {
  for (const id of ['py-u01-l4-q6', 'js-u02-l1-q6']) {
    const q = getQuestion(id);
    if (!q || q.type !== 'explain_code') throw new Error('missing');
    for (const loc of ['en', 'tr'] as const) {
      const r = gradeLocally(q.sampleAnswer[loc], q.keyPoints[loc], loc);
      console.log(id, loc, r.score, r.verdict, JSON.stringify(r.missedPoints));
    }
  }
});
