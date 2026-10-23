import { fetchStockQuotes, stockSymbol } from './stock-fetcher';
import { isProviderStock } from './market-quote';

// Every displayed current price must come from the same validated quote pipeline.
// A failed refresh omits the priced row rather than preserving a bundled baseline.
export async function refreshStockRows<T extends { ticker: string }>(rows: T[]) {
  const quotes = await fetchStockQuotes(rows.map(row => row.ticker));
  return rows.flatMap((row, index) => {
    const quote = quotes[index];
    if (!quote || !isProviderStock(quote) || quote.providerSymbol !== stockSymbol(row.ticker)) return [];
    const { sector, ...observation } = quote;
    return [{ ...row, ...observation, ...(sector ? { sector } : {}), ticker: quote.ticker }];
  });
}
