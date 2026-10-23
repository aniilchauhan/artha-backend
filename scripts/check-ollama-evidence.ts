import { ollamaRuntime } from '../lib/backend-ollama-evidence';
import { collectPredictionAiContext } from '../lib/prediction-ai-service';
import { generateOllamaEvidence, prepareOllamaEvidence } from '../lib/ollama-evidence-review';

async function main() {
  const started = Date.now();
  const model = await ollamaRuntime();
  process.stdout.write(JSON.stringify({ state: 'runtime_ready', model: model.name, digest: model.digest }) + '\n');
  const ticker = process.argv.find(arg => arg.startsWith('--ticker='))?.slice('--ticker='.length);
  if (!ticker) return;
  const context = prepareOllamaEvidence(await collectPredictionAiContext(ticker));
  const review = await generateOllamaEvidence(context, model.name, model.digest);
  process.stdout.write(JSON.stringify({ state: 'review_validated', ticker: review.assessment.ticker,
    model: review.assessment.model, elapsedMs: Date.now() - started, historyAsOf: context.historyAsOf,
    citations: review.assessment.evidence.map(e => e.metric), holdingStatuses: review.holdingConsiderations.map(h => h.status),
    published: false }) + '\n');
}
void main().catch(error => {
  const safeMessages = ['Numeric claims must use supplied evidence values, not generated prose', 'Missing holding coverage',
    'Unsupported company holding consideration', 'Financial evidence required', 'Local Ollama is unavailable or timed out.'];
  const reason = error instanceof SyntaxError ? 'Model output was not complete valid JSON.' :
    error instanceof Error && safeMessages.includes(error.message) ? error.message : 'Runtime, source coverage or validated output unavailable.';
  process.stderr.write('Ollama evidence check failed: ' + reason + '\n'); process.exitCode = 1;
});
