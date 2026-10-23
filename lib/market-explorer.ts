export interface MarketExplorerStockLike {
  marketCap?: number;
  changePercent?: number;
  ticker?: string;
  name?: string;
}

export function getSmallCapMomentumStocks<T extends MarketExplorerStockLike>(
  stocks: T[],
  threshold = 2,
): T[] {
  return stocks
    .filter(stock => (stock.marketCap ?? 0) < 20000 && Number(stock.changePercent ?? 0) >= threshold)
    .sort((a, b) => Number(b.changePercent ?? 0) - Number(a.changePercent ?? 0));
}
