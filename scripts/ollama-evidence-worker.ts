import { runOllamaEvidenceCycle } from '../lib/backend-ollama-evidence';

const force = process.argv.includes('--force');
let busy = false;
async function cycle() {
  if (busy) return;
  busy = true;
  try { await runOllamaEvidenceCycle(force); }
  catch (err: any) { process.stderr.write(`Ollama evidence cycle failed: ${err?.message || err}; saved results preserved.\n`); }
  finally { busy = false; }
}
void cycle().then(() => {
  if (!process.argv.includes('--once')) {
    process.stdout.write('Ollama evidence worker active; reviews scheduled after 16:00 IST on weekdays.\n');
    setInterval(() => void cycle(), 60000);
  }
});
