import { gradeLocally } from '@/services/local/grader';
import { getQuestion } from '@/services/content_service';

function kp(id: string, loc: 'en' | 'tr'): string[] {
  const q = getQuestion(id);
  if (!q || q.type !== 'explain_code') throw new Error('missing ' + id);
  return q.keyPoints[loc];
}

it('probe', () => {
  const cases: [string, 'en' | 'tr', string][] = [
    [
      'js-u01-l1-q6',
      'en',
      "This line calls a function that reads the user's name from the keyboard and quietly saves that text to a file, so nothing whatsoever is ever shown on the screen.",
    ],
    [
      'js-u01-l2-q6',
      'en',
      'The two lines here are only comments, so nothing at all is printed; the first line is a number and the second line is text that JavaScript simply ignores completely.',
    ],
  ];
  for (const [id, loc, answer] of cases) {
    const points = kp(id, loc);
    const r = gradeLocally(answer, points, loc);
    // eslint-disable-next-line no-console
    console.log(id, loc, JSON.stringify(points), '=>', r.verdict, r.score, JSON.stringify(r.missedPoints), '|', r.summary);
  }
});
