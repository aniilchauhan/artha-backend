// Legacy sync populated company collections with generated facts. Keep the entry
// point fail-closed so old scripts cannot write fabricated records. The profile
// endpoint now reads provider observations directly and never serves legacy rows.
export async function syncStockData(_ticker: string): Promise<boolean> {
  throw new Error('Legacy company sync is disabled: records lack field-level provenance.');
}
