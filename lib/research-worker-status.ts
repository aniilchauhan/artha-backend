import {readFileSync} from 'node:fs';
import path from 'node:path';
import {getAxionProjectRoot} from './project-root';
export function researchWorkerStatus(now=Date.now()){
  try{
    const file=path.join(process.env.AXION_DAEMON_DIR||path.join(getAxionProjectRoot(),'.axion/daemon'),'checkpoint.json');
    const checkpoint=JSON.parse(readFileSync(file,'utf8'));
    const success=Date.parse(checkpoint.lastSuccessfulRun||'');
    const lastRun=Date.parse(checkpoint.lastRunTimestamp||'');
    return {status:!Number.isFinite(success)||success>now?'unverified':now-success>30*60_000?'stale':checkpoint.status==='healthy'?'recent_success':'degraded',
      lastSuccess:Number.isFinite(success)&&success<=now?new Date(success).toISOString():null,
      lastAttempt:Number.isFinite(lastRun)&&lastRun<=now?new Date(lastRun).toISOString():null,
      note:'Shared research daemon checkpoint; recent success does not prove this portfolio was reconciled. No new heartbeat is expected outside the worker’s market schedule.'};
  }catch{return {status:'unavailable',lastSuccess:null,lastAttempt:null,note:'No readable worker checkpoint. Pending plans require a running worker and valid session observations.'};}
}
