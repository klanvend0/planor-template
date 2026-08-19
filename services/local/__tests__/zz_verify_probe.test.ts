import { gradeLocally } from '@/services/local/grader';
import { listExplainQuestions } from '@/services/content_service';
import fs from 'fs';

it('probe', () => {
  const out: any[] = [];
  for (const { question: q } of listExplainQuestions()) {
    if (q.type !== 'explain_code') continue;
    for (const loc of ['en', 'tr'] as const) {
      const r = gradeLocally(q.sampleAnswer[loc], q.keyPoints[loc], loc);
      out.push([q.id, loc, r.score]);
    }
  }
  fs.writeFileSync('/tmp/real_scores.json', JSON.stringify(out));
  expect(out.length).toBeGreaterThan(100);
});
