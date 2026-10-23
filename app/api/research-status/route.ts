import {NextResponse} from 'next/server';
import {readResearchStatus} from '../../../lib/backtest-research-store';
import {researchWorkerStatus} from '../../../lib/research-worker-status';
export const dynamic='force-dynamic';
export async function GET(){
  try{return NextResponse.json({...await readResearchStatus(),worker:researchWorkerStatus()},{headers:{'Cache-Control':'no-store'}});}
  catch{return NextResponse.json({ready:false,error:'Verified historical research is not available yet.',worker:researchWorkerStatus()},{status:503,headers:{'Cache-Control':'no-store'}});}
}
