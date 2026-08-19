import { gradeLocally } from '@/services/local/grader';
import { getQuestion, listExplainQuestions } from '@/services/content_service';

describe('tr dotted-I sensitivity (current code)', () => {
  it('claim reproduction on py-u01-l1-q6', () => {
    const q: any = getQuestion('py-u01-l1-q6');
    const kp = q.keyPoints.tr;
    const dotted =
      'İlk print cagrisi 6 sayisini gosterir, ikinci ise 9 sayisini gosterir; her biri kendi satirinda gorunur cunku sonuna yeni satir eklenir.';
    const ascii = 'I' + dotted.slice(1);
    console.log('len', dotted.length);
    console.log('DOTTED', JSON.stringify(gradeLocally(dotted, kp, 'tr')));
    console.log('ASCII ', JSON.stringify(gradeLocally(ascii, kp, 'tr')));
  });

  it('bundle sweep over tr sample answers', () => {
    let total = 0, withDotted = 0, changed = 0, verdictChanged = 0;
    const ex: string[] = [];
    for (const { question: q } of listExplainQuestions()) {
      if (q.type !== 'explain_code') continue;
      total += 1;
      const s = q.sampleAnswer.tr;
      if (!s.includes('İ')) continue;
      withDotted += 1;
      const a = gradeLocally(s, q.keyPoints.tr, 'tr');
      const b = gradeLocally(s.replace(/İ/g, 'I'), q.keyPoints.tr, 'tr');
      if (a.score !== b.score) {
        changed += 1;
        if (a.verdict !== b.verdict) verdictChanged += 1;
        ex.push(`${q.id}: ${a.score}/${a.verdict} -> ${b.score}/${b.verdict} newly-missed ${JSON.stringify(b.missedPoints.filter((p) => !a.missedPoints.includes(p)))}`);
      }
    }
    console.log(`SWEEP total=${total} withDotted=${withDotted} scoreChanged=${changed} verdictChanged=${verdictChanged}`);
    console.log(ex.join('\n'));
  });

  it('js-u04-l4-q6 key-point tokenisation', () => {
    const q: any = getQuestion('js-u04-l4-q6');
    console.log('KP', JSON.stringify(q.keyPoints.tr[0]));
    console.log('sample tr', JSON.stringify(gradeLocally(q.sampleAnswer.tr, q.keyPoints.tr, 'tr')));
  });
});
