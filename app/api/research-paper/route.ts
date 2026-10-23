import { NextRequest,NextResponse } from 'next/server';
import {requireAuth,verifyRequestOrigin} from '../../../lib/auth-guard';
import {readResearchPaper,proposeResearchPaper} from '../../../lib/research-paper-workflow';
import {researchWorkerStatus} from '../../../lib/research-worker-status';
export const dynamic='force-dynamic';
export async function GET(req:NextRequest) {
  const auth=await requireAuth(req);if(!auth.authenticated)return auth.response;
  try{return NextResponse.json({...readResearchPaper('user:'+auth.session.user.email.toLowerCase()),worker:researchWorkerStatus()},{headers:{'Cache-Control':'no-store'}});}
  catch{return NextResponse.json({error:'Paper ledger unavailable.'},{status:503});}
}
export async function POST(req:NextRequest) {
  if(!verifyRequestOrigin(req))return NextResponse.json({error:'Invalid request origin.'},{status:403});
  const auth=await requireAuth(req);if(!auth.authenticated)return auth.response;
  try {
    const body=await req.json();
    if(typeof body.signalId!=='string')throw new Error('Stored signal ID required.');
    return NextResponse.json(await proposeResearchPaper('user:'+auth.session.user.email.toLowerCase(),body.signalId,body.days),{headers:{'Cache-Control':'no-store'}});
  }catch(error){return NextResponse.json({error:error instanceof Error?error.message:'Paper proposal failed.'},{status:400});}
}
