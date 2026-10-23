import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

const projectRoot = process.cwd();
const pythonBin = process.platform === 'win32'
  ? path.join(projectRoot, 'stock-ai', 'venv', 'Scripts', 'python.exe')
  : path.join(projectRoot, 'stock-ai', 'venv', 'bin', 'python');

function runStep(name, cmd, args) {
  return new Promise((resolve, reject) => {
    console.log(`\n[STEP: ${name}] Running ${cmd} ${args.join(' ')}...`);
    const child = spawn(cmd, args, { cwd: projectRoot, stdio: 'inherit', shell: true });
    child.on('close', (code) => {
      if (code === 0) {
        console.log(`✓ [STEP: ${name}] Completed successfully.`);
        resolve();
      } else {
        reject(new Error(`Step ${name} failed with exit code ${code}`));
      }
    });
    child.on('error', reject);
  });
}

async function main() {
  console.log('======================================================');
  console.log(`⚡ Axion Pre-Market Daily ML Scanner: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST`);
  console.log('======================================================');

  if (!fs.existsSync(pythonBin)) {
    throw new Error(`Python virtual environment not found at: ${pythonBin}`);
  }

  // 1. Run Python ML Daily Scan with latest market data
  await runStep('ML Prediction Engine', pythonBin, [
    path.join('stock-ai', 'src', 'daily_scan.py'),
    '--universe', 'core50',
    '--refresh-data',
    '--fast'
  ]);

  // 2. Synchronize Predictions directly into MongoDB
  await runStep('MongoDB Prediction Sync', 'node', [
    path.join('scripts', 'sync-predictions-to-mongo.mjs')
  ]);

  // 3. Evaluate 5-Minute Momentum Radar & Spikes
  await runStep('Momentum Radar Snapshot', 'node', [
    '--env-file-if-exists=.env.local',
    '--import', 'tsx',
    path.join('scripts', 'momentum-radar-worker.ts'),
    '--once'
  ]);

  console.log('\n======================================================');
  console.log('🎉 Pre-Market Daily Scan & MongoDB Sync Fully Completed!');
  console.log('======================================================\n');
}

main().catch((err) => {
  console.error('\n❌ Daily scan failed:', err.message);
  process.exit(1);
});
