/**
 * fetch-and-seed-ipos.js
 * 
 * Invokes the comprehensive Indian IPO Harvester & Post-Listing Quantitative Engine (`sync-all-ipo-stocks.mjs`).
 * Ingests 100+ authentic Indian IPO stocks across 2023–2026, calculates anchor lock-in metrics,
 * writes to `data/stock-ai/post_ipo_breakouts.json`, and seeds MongoDB `ipos`.
 * 
 * Usage:
 *   node scripts/fetch-and-seed-ipos.js
 */

import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const scriptPath = path.join(__dirname, 'sync-all-ipo-stocks.mjs');

console.log('🚀 Launching Axion Comprehensive IPO Harvester Engine...\n');

const child = spawn(process.execPath, [scriptPath, ...process.argv.slice(2)], {
  stdio: 'inherit',
  cwd: path.resolve(__dirname, '..'),
});

child.on('close', code => {
  if (code !== 0) {
    console.error(`\n❌ IPO sync process exited with code ${code}`);
    process.exit(code);
  } else {
    console.log('\n✅ IPO sync and seed completed successfully!');
  }
});
