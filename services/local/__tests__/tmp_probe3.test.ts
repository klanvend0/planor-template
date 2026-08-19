import { listExplainQuestions } from '@/services/content_service';

const STOP = new Set(['a','an','and','are','as','at','be','but','by','can','do','does','each','for','from','has','have','how','in','into','is','it','its','of','on','or','out','so','that','the','then','they','this','to','up','was','what','when','which','with','you','your','will','we','if','not','all','any','one','two','first','after','before','also','just','only','over','more','than','there','their','them','these','those','value','values','ve','ile','bir','bu','şu','o','da','de','ki','mi','mı','mu','mü','için','gibi','olarak','sonra','önce','her','çok','daha','en','ama','veya','ya','ise','olan','olur','oluyor','yapar','yapıyor','eder','ediyor','ne','nasıl','kadar','sadece','ancak','yani','şey','değer','değeri']);

function toks(p: string, locale: 'en'|'tr', keepSingle: boolean) {
  return p.toLocaleLowerCase(locale==='tr'?'tr-TR':'en-US')
    .replace(/[^\p{L}\p{N}_]+/gu,' ').split(/\s+/)
    .filter(w => w.length>0 && (keepSingle || w.length>1) && !STOP.has(w));
}
function same(a:string,b:string){if(a===b)return true;const lim=Math.min(a.length,b.length);let s=0;while(s<lim&&a[s]===b[s])s++;return s>=4;}
function score(points: string[], ans: string, locale:'en'|'tr', keepSingle: boolean) {
  const aw = toks(ans, locale, keepSingle);
  let cov=0;
  for (const p of points) {
    const need = toks(p, locale, keepSingle);
    if (need.length===0) continue;
    const hits = need.filter(w=>aw.some(s=>same(w,s))).length;
    if (hits/need.length >= 1/3) cov++;
  }
  return Math.round((cov/points.length)*100);
}
function verdict(s:number){return s>=60?'correct':s>=40?'partial':'incorrect';}

describe('probe3', () => {
  it('does keeping single-char tokens ever change a verdict on sample answers?', () => {
    let n=0, changedScore=0, changedVerdict=0;
    const diffs: string[] = [];
    for (const { question: e } of listExplainQuestions()) {
      if (e.type!=='explain_code') continue;
      for (const locale of ['en','tr'] as const) {
        const pts = e.keyPoints[locale];
        const ans = e.sampleAnswer[locale];
        const a = score(pts, ans, locale, false), b = score(pts, ans, locale, true);
        n++;
        if (a!==b) { changedScore++; diffs.push(`${e.id}[${locale}] sample ${a} -> ${b} (${verdict(a)}->${verdict(b)})`); }
        if (verdict(a)!==verdict(b)) changedVerdict++;
      }
    }
    console.log(`SAMPLE ANSWERS: cases=${n} scoreChanged=${changedScore} verdictChanged=${changedVerdict}`);
    console.log(diffs.slice(0,20).join('\n'));
  });

  it('cross-answer stress: every sample answer vs every question (does fix help discriminate?)', () => {
    const entries: {id:string; pts:string[]; ans:string; locale:'en'|'tr'}[] = [];
    for (const { question: e } of listExplainQuestions()) {
      if (e.type!=='explain_code') continue;
      for (const locale of ['en','tr'] as const) entries.push({id:e.id, pts:e.keyPoints[locale], ans:e.sampleAnswer[locale], locale});
    }
    for (const keep of [false,true]) {
      let fp=0, tot=0, tp=0, own=0;
      for (const q of entries) for (const a of entries) {
        if (a.locale!==q.locale) continue;
        const s = score(q.pts, a.ans, q.locale, keep);
        if (q.id===a.id) { own++; if (verdict(s)==='correct') tp++; }
        else { tot++; if (verdict(s)==='correct') fp++; }
      }
      console.log(`keepSingle=${keep}: own-answer correct ${tp}/${own}; MISMATCHED-answer graded correct ${fp}/${tot} (${(100*fp/tot).toFixed(1)}%)`);
    }
  });
});
