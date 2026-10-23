import {NextResponse} from 'next/server';
import {readSnapshot,snapshotMetadata,type SnapshotJob} from '../../../lib/backend-snapshots';
export const dynamic='force-dynamic';
export async function GET(){
  const jobs = [
    'whole-market',
    'rapid-moves',
    'gap-screener',
    'swing-opportunities',
    'market-session-report',
    'opportunities',
    'small-cap-predictions',
  ] as SnapshotJob[];
  const entries=await Promise.all(jobs.map(async job=>{try{
    const snapshot=await readSnapshot(job);
    if(job==='gap-screener'&&(snapshot.data as any)?.source?.dataSource!=='provider')throw new Error('Unverified gap snapshot');
    if(job==='market-session-report'&&(snapshot.data as any)?.source?.dataSource!=='provider')throw new Error('Unverified market report');
    return [job,await snapshotMetadata(snapshot)];
  }catch{return [job,{status:'unavailable',generatedAt:null,marketDataAsOf:null,coverage:null}];}}));
  return NextResponse.json(Object.fromEntries(entries),{headers:{'Cache-Control':'no-store'}});
}
