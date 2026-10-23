import nextEnv from '@next/env';
nextEnv.loadEnvConfig(process.cwd());
const { checkPriceAlerts } = await import('../lib/alert-worker.ts');
let stopping = false;
process.on('SIGINT', () => { stopping = true; });
process.on('SIGTERM', () => { stopping = true; });
do {
  try { console.log(JSON.stringify(await checkPriceAlerts())); }
  catch { console.error('Alert check failed. Existing rules and history remain saved.'); process.exitCode = process.argv.includes('--once') ? 1 : 0; }
  if (process.argv.includes('--once') || stopping) break;
  for (let i = 0; i < 60 && !stopping; i++) await new Promise(resolve => setTimeout(resolve, 1000));
} while (!stopping);
