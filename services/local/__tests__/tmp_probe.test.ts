import { getQuestion, listExplainQuestions } from '@/services/content_service';
import { gradeLocally } from '@/services/local/grader';

describe('probe', () => {
  it('py-u01-l1-q6 claimed answer', () => {
    const q = getQuestion('py-u01-l1-q6');
    if (!q || q.type !== 'explain_code') throw new Error('missing');
    const ans =
      'The print calls output some values, and each print call also creates a brand new line of output on the terminal for the reader.';
    const r = gradeLocally(ans, q.keyPoints.en, 'en');
    console.log('PY RESULT', JSON.stringify(r, null, 2));
  });

  it('js-u01-l4-q6 tokens', () => {
    const q = getQuestion('js-u01-l4-q6');
    if (!q || q.type !== 'explain_code') throw new Error('missing');
    const ans =
      'The code just runs from the top of the file down to the bottom of the file, and each logging call puts its output onto a brand new line.';
    const r = gradeLocally(ans, q.keyPoints.en, 'en');
    console.log('JS RESULT', JSON.stringify(r, null, 2));
  });

  it('count single-char loss', () => {
    const STOP = new Set<string>();
    let total = 0, affected = 0, emptied = 0;
    const samples: string[] = [];
    for (const { question: e } of listExplainQuestions()) {
      if (e.type !== 'explain_code') continue;
      for (const locale of ['en', 'tr'] as const) {
        for (const p of e.keyPoints[locale]) {
          total += 1;
          const toks = p
            .toLocaleLowerCase(locale === 'tr' ? 'tr-TR' : 'en-US')
            .replace(/[^\p{L}\p{N}_]+/gu, ' ')
            .split(/\s+/)
            .filter(Boolean);
          const dropped = toks.filter((w) => w.length === 1);
          if (dropped.length) {
            affected += 1;
            if (samples.length < 25) samples.push(`${e.id} [${locale}] "${p}" dropped=${JSON.stringify(dropped)}`);
          }
        }
      }
    }
    console.log('TOTAL POINTS', total, 'AFFECTED', affected);
    console.log(samples.join('\n'));
  });
});
