const fs = require('fs');
const path = require('path');

// Read FALLBACK_PRICES from lib/stock-fetcher.ts
const fetcherContent = fs.readFileSync(path.join(__dirname, '../lib/stock-fetcher.ts'), 'utf8');
const fallbackMatch = fetcherContent.match(/export const FALLBACK_PRICES: Record<string, number> = \{([\s\S]*?)\};/);
const prices = {};

if (fallbackMatch) {
  const lines = fallbackMatch[1].split('\n');
  for (const line of lines) {
    const m = line.match(/^\s*["']?([A-Za-z0-9&_\-]+)["']?\s*:\s*([0-9.]+)/);
    if (m) {
      prices[m[1]] = Number(m[2]);
    }
  }
}

console.log('Loaded fallback prices count:', Object.keys(prices).length);
console.log('Sample prices:', { ITC: prices.ITC, RELIANCE: prices.RELIANCE, TCS: prices.TCS, HDFCBANK: prices.HDFCBANK, LT: prices.LT });

// Now read lib/stock-data.ts and replace prices in INITIAL_STOCKS
const stockDataPath = path.join(__dirname, '../lib/stock-data.ts');
let stockDataContent = fs.readFileSync(stockDataPath, 'utf8');

// Match each stock block inside INITIAL_STOCKS
let updatedCount = 0;
stockDataContent = stockDataContent.replace(
  /(\{\s*ticker:\s*["']([^"']+)["'],\s*name:\s*["']([^"']+)["'],\s*currentPrice:\s*)([0-9.]+)(,\s*change:\s*)([-0-9.]+)(,\s*changePercent:\s*)([-0-9.]+)(,\s*high:\s*)([0-9.]+)(,\s*low:\s*)([0-9.]+)(,\s*volume:\s*[0-9]+,\s*history:\s*generateInitialHistory\()([0-9.]+)(\))/g,
  (match, p1, ticker, name, p2, p3, oldChg, p4, oldPct, p5, oldHigh, p6, oldLow, p7, oldHist, p8) => {
    const realPrice = prices[ticker];
    if (realPrice !== undefined) {
      updatedCount++;
      const pct = Number(oldPct) || 0.5;
      const chg = Number(((realPrice * pct) / 100).toFixed(2));
      const high = Number((realPrice * 1.015).toFixed(2));
      const low = Number((realPrice * 0.985).toFixed(2));
      return `${p1}${realPrice}${p3}${chg}${p4}${pct}${p5}${high}${p6}${low}${p7}${realPrice}${p8}`;
    }
    return match;
  }
);

fs.writeFileSync(stockDataPath, stockDataContent, 'utf8');
console.log(`Updated ${updatedCount} stocks in INITIAL_STOCKS in lib/stock-data.ts with real prices.`);
