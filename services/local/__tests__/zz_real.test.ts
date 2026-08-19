import { getQuestion } from '@/services/content_service';
import { gradeLocally } from '@/services/local/grader';
function kp(id:string,l:'en'|'tr'){const q=getQuestion(id) as any; return q.keyPoints[l];}
const cases:[string,'en'|'tr',string][] = [
 ['js-u02-l1-q6','en','The code sets up a balance and then uses console.log to print out the current balance on the screen, so you can see the number that the account begins with.'],
 ['py-u03-l4-q6','en','It takes the string and makes it lowercase, then swaps the spaces for underscores, and finally shows the finished username on the screen for the person.'],
 ['py-u01-l2-q6','en','It prints four separate items in a row using commas between them, and Python joins those items with spaces so they all land on one single line.'],
];
it('realistic honest-but-incomplete answers',()=>{
 for(const [id,l,ans] of cases){
   const r=gradeLocally(ans,kp(id,l),l);
   console.log('====',id,l,'len',ans.length);
   console.log('  KP  :',JSON.stringify(kp(id,l)));
   console.log('  ->',r.verdict,r.score,'missed=',JSON.stringify(r.missedPoints));
 }
});
