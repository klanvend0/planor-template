import { listExplainQuestions, getQuestion } from '@/services/content_service';
import { gradeLocally } from '@/services/local/grader';

const STOP = new Set(['a','an','and','are','as','at','be','but','by','can','do','does','each','for','from','has','have','how','in','into','is','it','its','of','on','or','out','so','that','the','then','they','this','to','up','was','what','when','which','with','you','your','will','we','if','not','all','any','one','two','first','after','before','also','just','only','over','more','than','there','their','them','these','those','value','values','ve','ile','bir','bu','şu','o','da','de','ki','mi','mı','mu','mü','için','gibi','olarak','sonra','önce','her','çok','daha','en','ama','veya','ya','ise','olan','olur','oluyor','yapar','yapıyor','eder','ediyor','ne','nasıl','kadar','sadece','ancak','yani','şey','değer','değeri']);

function toks(p: string, locale: 'en'|'tr', keepSingle: boolean) {
  return p.toLocaleLowerCase(locale==='tr'?'tr-TR':'en-US')
    .replace(/[^\p{L}\p{N}_]+/gu,' ').split(/\s+/)
    .filter(w => w.length>0 && (keepSingle || w.length>1) && !STOP.has(w));
}

describe('probe2', () => {
  it('distribution of surviving tokens per key point', () => {
    const dist: Record<number, number> = {};
    const singles: string[] = [];
    let total=0;
    for (const { question: e } of listExplainQuestions()) {
      if (e.type!=='explain_code') continue;
      for (const locale of ['en','tr'] as const) {
        for (const p of e.keyPoints[locale]) {
          total++;
          const t = toks(p, locale, false);
          dist[t.length] = (dist[t.length]||0)+1;
          if (t.length<=1) singles.push(`${e.id}[${locale}] "${p}" -> ${JSON.stringify(t)} (with singles: ${JSON.stringify(toks(p,locale,true))})`);
        }
      }
    }
    console.log('TOTAL', total, 'DIST', JSON.stringify(dist));
    console.log('POINTS REDUCED TO <=1 TOKEN:\n' + singles.join('\n'));
  });

  it('does keeping digits change py-u01-l1-q6 verdict? simulate 1/3 rule', () => {
    const q = getQuestion('py-u01-l1-q6');
    if (!q || q.type!=='explain_code') throw new Error('x');
    const ans='The print calls output some values, and each print call also creates a brand new line of output on the terminal for the reader.';
    const aw = toks(ans,'en',false);
    function same(a:string,b:string){if(a===b)return true;const lim=Math.min(a.length,b.length);let s=0;while(s<lim&&a[s]===b[s])s++;return s>=4;}
    for (const p of q.keyPoints.en) {
      for (const keep of [false,true]) {
        const need = toks(p,'en',keep);
        const hits = need.filter(w=>aw.some(s=>same(w,s))).length;
        console.log(`keepSingle=${keep} point="${p}" needed=${JSON.stringify(need)} hits=${hits} ratio=${(hits/need.length).toFixed(2)} covered=${hits/need.length>=1/3}`);
      }
    }
  });

  it('js-u01-l4-q6 with an answer that merely says prints', () => {
    const q = getQuestion('js-u01-l4-q6');
    if (!q || q.type!=='explain_code') throw new Error('x');
    const ans = 'This code prints some things onto the screen and it runs from the very top of the file down to the very bottom line by line.';
    console.log('JS2', JSON.stringify(gradeLocally(ans, q.keyPoints.en, 'en'), null, 2));
  });
});
