import { getQuestion } from '@/services/content_service';

const STOP = new Set(['a','an','and','are','as','at','be','but','by','can','do','does','each','for','from','has','have','how','in','into','is','it','its','of','on','or','out','so','that','the','then','they','this','to','up','was','what','when','which','with','you','your','will','we','if','not','all','any','one','two','first','after','before','also','just','only','over','more','than','there','their','them','these','those','value','values','ve','ile','bir','bu','şu','o','da','de','ki','mi','mı','mu','mü','için','gibi','olarak','sonra','önce','her','çok','daha','en','ama','veya','ya','ise','olan','olur','oluyor','yapar','yapıyor','eder','ediyor','ne','nasıl','kadar','sadece','ancak','yani','şey','değer','değeri']);
const fold=(v:string,l:string)=>v.toLocaleLowerCase(l==='tr'?'tr-TR':'en-US');
const words=(t:string,l:string)=>fold(t,l).replace(/[^\p{L}\p{N}_]+/gu,' ').split(/\s+/).filter(w=>w.length>1&&!STOP.has(w));
function shared(a:string,b:string){const lim=Math.min(a.length,b.length);let s=0;while(s<lim&&a[s]===b[s])s+=1;return s;}

type M=(a:string,b:string)=>boolean;
const CUR:M=(a,b)=>a===b||shared(a,b)>=4;
const EXACT:M=(a,b)=>a===b;
// proposed fix (a)+(b)
const FIX:M=(a,b)=>{ if(a===b)return true;
  if(/[_.]/.test(a)||/[_.]/.test(b))return false;
  const s=shared(a,b); return s>=4 && s>=0.7*Math.max(a.length,b.length); };

function score(ans:string,kps:string[],l:string,m:M){
  const aw=words(ans,l);
  const cov=kps.filter(p=>{const n=words(p,l); if(!n.length)return false;
    const h=n.filter(w=>aw.some(s=>m(w,s))).length; return h/n.length>=1/3;});
  return {score:Math.round(cov.length/kps.length*100), covered:cov, missed:kps.filter(p=>!cov.includes(p))};
}
function kp(id:string,l:'en'|'tr'){const q=getQuestion(id) as any; return q.keyPoints[l];}

it('counterfactual',()=>{
  const cases:[string,string,'en'|'tr'][]=[
    ['py-u02-l4-q6','It stores the text True inside is_active, which Python treats as a boolean type, and then prints the type of that one variable only, ignoring everything else here.','en'],
    ['py-u02-l4-q6',"Kod True'yu is_active'e bir metin olarak saklar, boolean turu degildir, ve sadece o tek degiskenin turunu yazdirir; geri kalan satirlarin hicbiri calismaz.",'tr'],
    ['js-u02-l1-q6','The console prints a random number, then lets the balance change on every start, so the same code stores nothing at all and the current amount is never fixed.','en'],
  ];
  for(const [id,ans,l] of cases){
    const k=kp(id,l);
    console.log('====',id,l);
    console.log(' KP:',JSON.stringify(k));
    for(const [name,m] of [['CURRENT',CUR],['EXACT',EXACT],['FIX',FIX]] as [string,M][]){
      const r=score(ans,k,l,m);
      console.log(`  ${name.padEnd(8)} score=${r.score} missed=${JSON.stringify(r.missed)}`);
    }
  }
});
