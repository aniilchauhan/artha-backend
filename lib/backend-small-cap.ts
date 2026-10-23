import { scanSmallCapUniverse, SMALL_CAP_BATCH_LIMIT } from './small-cap-universe';
import type { SmallCapExchange, SmallCapScanResponse } from './small-cap-types';

export async function calculateSmallCapBatch(
  offset: number = 0,
  exchange: SmallCapExchange = 'all'
): Promise<SmallCapScanResponse> {
  return scanSmallCapUniverse({
    offset,
    limit: SMALL_CAP_BATCH_LIMIT,
    exchange,
  });
}
