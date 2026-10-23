import { reconcilePendingHorizonPredictions } from '../lib/horizon-history';

async function main() {
  try {
    const result = await reconcilePendingHorizonPredictions(25);
    console.log(`[Horizon outcomes] checked ${result.checked} of ${result.selected} due pending predictions.`);
  } catch (error) {
    console.error('[Horizon outcomes] reconciliation failed:', error instanceof Error ? error.message : 'Unknown error');
    process.exitCode = 1;
  }
}

void main();
