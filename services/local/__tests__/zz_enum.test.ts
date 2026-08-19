import { listExplainQuestions } from '@/services/content_service';
const STOP = new Set(['a','an','and','are','as','at','be','but','by','can','do','does','each','for','from','has','have','how','in','into','is','it','its','of','on','or','out','so','that','the','then','they','this','to','up','was','what','when','which','with','you','your','will','we','if','not','all','any','one','two','first','after','before','also','just','only','over','more','than','there','their','them','these','those','value','values','ve','ile','bir','bu','şu','o','da','de','ki','mi','mı','mu','mü','için','gibi','olarak','sonra','önce','her','çok','daha','en','ama','veya','ya','ise','olan','olur','oluyor','yapar','yapıyor','eder','ediyor','ne','nasıl','kadar','sadece','ancak','yani','şey','değer','değeri']);
const fold=(v:string,l:string)=>v.toLocaleLowerCase(l==='tr'?'tr-TR':'en-US');
const words=(t:string,l:string)=>fold(t,l).replace(/[^\p{L}\p{N}_]+/gu,' ').split(/\s+/).filter(w=>w.length>1&&!STOP.has(w));
function sh(a:string,b:string){const lim=Math.min(a.length,b.length);let s=0;while(s<lim&&a[s]===b[s])s+=1;return s;}

it('enumerate within-question collisions',()=>{
  const pairs=new Map<string,number>();
  let qn=0;
  for(const {question:q} of listExplainQuestions()){
    if((q as any).type!=='explain_code')continue; qn++;
    for(const l of ['en','tr'] as const){
      const e=q as any;
      // vocabulary a learner realistically writes: key points + sample answer + code identifiers
      const vocab=new Set<string>([...words(e.keyPoints[l].join(' '),l),...words(e.sampleAnswer[l],l),...words(e.code[l],l)]);
      const kpw=new Set<string>(words(e.keyPoints[l].join(' '),l));
      for(const a of kpw) for(const b of vocab){
        if(a===b)continue;
        if(sh(a,b)>=4){ const k=[a,b].sort().join(' ~ ')+`  [${l}]`; pairs.set(k,(pairs.get(k)||0)+1); }
      }
    }
  }
  console.log('questions',qn,'distinct within-question collision pairs',pairs.size);
  console.log([...pairs.keys()].sort().join('\n'));
});
