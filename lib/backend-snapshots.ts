import {promises as fs} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {getAxionProjectRoot} from './project-root';

export type SnapshotJob =
  | 'whole-market'
  | 'rapid-moves'
  | 'gap-screener'
  | 'swing-opportunities'
  | 'market-session-report'
  | 'opportunities'
  | 'small-cap-predictions'
  | 'ollama-evidence';
export interface Snapshot<T>{version:1;job:SnapshotJob;generatedAt:string;marketDataAsOf:string|null;coverage:{evaluated:number;total:number};data:T}
const root=()=>path.join(getAxionProjectRoot(),'data/backend-snapshots');
export async function atomicSnapshotFile(name:string,value:unknown){
  await fs.mkdir(root(),{recursive:true});
  const target=path.join(root(),name),temporary=target+'.'+randomUUID()+'.tmp';
  try{await fs.writeFile(temporary,JSON.stringify(value));await fs.rename(temporary,target);}finally{await fs.unlink(temporary).catch(()=>{});}
}
export async function readSnapshot<T>(job:SnapshotJob,progress=false):Promise<Snapshot<T>>{
  // Try high-speed MongoDB retrieval (<1ms) first
  try {
    const { default: BackendSnapshot } = await import('../models/BackendSnapshot');
    const { default: connectDB } = await import('./mongodb');
    await connectDB();
    const doc = await BackendSnapshot.findOne({ job }).lean();
    if (doc && doc.data) {
      return {
        version: (doc.version as any) || 1,
        job: doc.job as any,
        generatedAt: doc.generatedAt,
        marketDataAsOf: doc.marketDataAsOf || null,
        coverage: doc.coverage || { evaluated: 0, total: 0 },
        data: doc.data as T,
      };
    }
  } catch {}

  // Disk fallback
  const result=JSON.parse(await fs.readFile(path.join(root(),job+(progress?'-progress':'')+'.json'),'utf8'));
  if(result.version!==1||result.job!==job||result.data===undefined||!result.coverage||
    !Number.isInteger(result.coverage.evaluated)||!Number.isInteger(result.coverage.total)||result.coverage.evaluated<0||result.coverage.total<result.coverage.evaluated||
    !Number.isFinite(Date.parse(result.generatedAt))||Date.parse(result.generatedAt)>Date.now()+30000)throw new Error('Invalid backend snapshot');
  return result;
}
export async function snapshotMetadata<T>(snapshot:Snapshot<T>){
  const ageMs=Math.max(0,Date.now()-Date.parse(snapshot.generatedAt));
  let worker:unknown=null;try{worker=JSON.parse(await fs.readFile(path.join(root(),snapshot.job+'-status.json'),'utf8'));}catch{}
  return {generatedAt:snapshot.generatedAt,marketDataAsOf:snapshot.marketDataAsOf,coverage:snapshot.coverage,
    status:ageMs>20*60_000?'stale':snapshot.coverage.evaluated<snapshot.coverage.total?'partial':'ready',ageMs,worker};
}
export async function runSnapshotJob<T>(job:SnapshotJob,produce:()=>Promise<Omit<Snapshot<T>,'version'|'job'|'generatedAt'>&{publish?:boolean}>){
  await fs.mkdir(root(),{recursive:true});
  const lock=path.join(root(),job+'.lock');
  // Exclusive creation prevents overlap. Expired locks recover after a crashed process.
  try{const stat=await fs.stat(lock);if(Date.now()-stat.mtimeMs>120_000){
    const owner=Number(await fs.readFile(lock,'utf8'));let alive=Number.isSafeInteger(owner)&&owner>0;
    if(alive)try{process.kill(owner,0);}catch(error){alive=(error as NodeJS.ErrnoException).code!=='ESRCH';}
    if(!alive)await fs.unlink(lock);
  }}catch{}
  let handle;try{handle=await fs.open(lock,'wx');}catch(error){if((error as NodeJS.ErrnoException).code==='EEXIST')return false;throw error;}
  await handle.writeFile(String(process.pid));
  const heartbeat=setInterval(()=>{void fs.utimes(lock,new Date(),new Date()).catch(()=>{});},30_000);
  const startedAt=new Date().toISOString();
  try{
    await atomicSnapshotFile(job+'-status.json',{state:'running',startedAt});
    const output=await produce();
    const {publish,...result}=output;
    const snapshot={...result,version:1,job,generatedAt:new Date().toISOString()};
    if(job==='rapid-moves'||job==='small-cap-predictions')await atomicSnapshotFile(job+'-progress.json',snapshot);
    if(publish!==false) {
      await atomicSnapshotFile(job+'.json',snapshot);
      try {
        const { default: BackendSnapshot } = await import('../models/BackendSnapshot');
        const { default: connectDB } = await import('./mongodb');
        await connectDB();
        await BackendSnapshot.findOneAndUpdate(
          { job },
          { $set: snapshot },
          { upsert: true }
        );
      } catch {}
    }
    await atomicSnapshotFile(job+'-status.json',{state:publish===false?'updating':'ready',startedAt,finishedAt:new Date().toISOString(),coverage:output.coverage});return true;
  }catch(error){await atomicSnapshotFile(job+'-status.json',{state:'failed',startedAt,finishedAt:new Date().toISOString(),error:error instanceof Error?error.message:'Worker failed'});throw error;}
  finally{clearInterval(heartbeat);await handle.close();await fs.unlink(lock).catch(()=>{});}
}
