/** Rebuild delivery positions from the app's newest-first transaction ledger. */
export function holdingsFromLedger(rows: readonly { ticker: string; action: string; quantity: number; price: number; id?: string }[]) {
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('The ledger is empty. No holdings were changed.');
  const holdings: Record<string, { ticker: string; quantity: number; buyPrice: number }> = {};
  const seen = new Set<string>();
  for (const row of [...rows].reverse()) {
    if (row.id && seen.has(row.id)) throw new Error('Duplicate transaction IDs found. No holdings were changed.');
    if (row.id) seen.add(row.id);
    const { ticker, quantity, price, action } = row;
    if (!/^[A-Za-z0-9_-]{1,25}$/.test(ticker) || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(price) || price <= 0 || !['BUY', 'SELL'].includes(action)) {
      throw new Error('The ledger contains an invalid transaction. No holdings were changed.');
    }
    const position = holdings[ticker] ?? { ticker, quantity: 0, buyPrice: 0 };
    if (action === 'BUY') {
      const cost = position.quantity * position.buyPrice + quantity * price;
      position.quantity += quantity;
      position.buyPrice = cost / position.quantity;
    } else {
      if (quantity > position.quantity) throw new Error(`${ticker}: sells exceed earlier buys. The ledger is incomplete; no holdings were changed.`);
      position.quantity -= quantity;
      if (position.quantity === 0) position.buyPrice = 0;
    }
    holdings[ticker] = position;
  }
  return holdings;
}
