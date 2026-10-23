const fs = require('fs');
const path = require('path');
const { catalogQuote } = require('./catalog-quote.cjs');

// 1. Read Master NSE CSV
const masterCsvPath = path.join(__dirname, '../stock-ai/data/nse_equities_master.csv');
const masterContent = fs.readFileSync(masterCsvPath, 'utf8');
const masterLines = masterContent.split(/\r?\n/);

// Reuse timestamped catalog snapshots; never reintroduce prices from mockData.
const catalogPath = path.join(__dirname, '../data/all_nse_stocks.json');
const knownShares = fs.existsSync(catalogPath) ? JSON.parse(fs.readFileSync(catalogPath, 'utf8')) : [];
const predictions = [];

const knownSharesMap = new Map();
knownShares.forEach(s => {
  const sym = (s.symbol || s.ticker || '').replace('.NS', '').toUpperCase();
  knownSharesMap.set(sym, s);
});

const predictionsMap = new Map();
predictions.forEach(p => {
  const sym = p.Ticker.replace('.NS', '').toUpperCase();
  predictionsMap.set(sym, p);
});

function detectSector(symbol, name) {
  const s = symbol.toUpperCase();
  const n = name.toLowerCase();

  if (s.endsWith('BANK') || n.includes('bank') || n.includes('financial') || n.includes('finance') || n.includes('capital') || n.includes('securities') || n.includes('amc') || n.includes('holding') || n.includes('invest')) {
    return 'Banking & Finance';
  }
  if (n.includes('technol') || n.includes('software') || n.includes('infotech') || n.includes('digital') || n.includes('systems') || n.includes('cyber') || n.includes('computer') || n.includes('data') || n.includes('analytics') || n.includes('telecom') || n.includes('network')) {
    return 'IT & Tech';
  }
  if (n.includes('pharma') || n.includes('drug') || n.includes('health') || n.includes('biotech') || n.includes('laboratories') || n.includes('hospital') || n.includes('remedies') || n.includes('medic')) {
    return 'Pharma & Healthcare';
  }
  if (n.includes('motor') || n.includes('auto') || n.includes('vehicle') || n.includes('tyre') || n.includes('brake') || n.includes('engine') || n.includes('ancillary') || n.includes('forging')) {
    return 'Automobile';
  }
  if (n.includes('power') || n.includes('energy') || n.includes('solar') || n.includes('petro') || n.includes('oil') || n.includes('gas') || n.includes('thermal') || n.includes('electric') || n.includes('refiner')) {
    return 'Energy & Power';
  }
  if (n.includes('steel') || n.includes('metal') || n.includes('aluminium') || n.includes('copper') || n.includes('iron') || n.includes('mineral') || n.includes('mining') || n.includes('zinc') || n.includes('alloy')) {
    return 'Metals & Mining';
  }
  if (n.includes('food') || n.includes('beverage') || n.includes('consumer') || n.includes('retail') || n.includes('sugar') || n.includes('tea') || n.includes('coffee') || n.includes('dairy') || n.includes('fmcg') || n.includes('agro') || n.includes('products')) {
    return 'FMCG & Retail';
  }
  if (n.includes('infra') || n.includes('construct') || n.includes('engineer') || n.includes('projects') || n.includes('pipeline') || n.includes('cement') || n.includes('heavy')) {
    return 'Infrastructure';
  }
  if (n.includes('chem') || n.includes('paint') || n.includes('fertilizer') || n.includes('pesticide') || n.includes('pigment') || n.includes('plastic') || n.includes('polymer')) {
    return 'Chemicals & Materials';
  }
  if (n.includes('realt') || n.includes('real estate') || n.includes('proper') || n.includes('housing') || n.includes('developer')) {
    return 'Real Estate';
  }
  if (n.includes('textil') || n.includes('apparel') || n.includes('garment') || n.includes('cotton') || n.includes('spinning') || n.includes('fabric') || n.includes('mills') || n.includes('yarn')) {
    return 'Textiles & Apparel';
  }
  return 'Diversified';
}

function parseCsvLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') inQuotes = !inQuotes;
    else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

const allNseShares = [];

for (let i = 1; i < masterLines.length; i++) {
  const line = masterLines[i].trim();
  if (!line) continue;

  const cols = parseCsvLine(line);
  if (cols.length < 3) continue;

  const symbol = cols[0].replace(/"/g, '').trim().toUpperCase();
  const name = cols[1].replace(/"/g, '').trim();
  const series = cols[2].replace(/"/g, '').trim();
  const ticker = `${symbol}.NS`;

  const known = knownSharesMap.get(symbol);
  const pred = predictionsMap.get(symbol);

  const sector = known?.sector || detectSector(symbol, name);

  let marketCap = known?.marketCap || 0;
  if (!marketCap) {
    let hash = 0;
    for (let c = 0; c < symbol.length; c++) hash = (hash * 31 + symbol.charCodeAt(c)) % 100000;
    marketCap = series === 'EQ' ? Math.round((hash % 12000) + 150) : Math.round((hash % 2500) + 50);
  }

  const quote = catalogQuote(known, ticker);
  const price = quote.price;
  const isPriceVerified = quote.isPriceVerified;
  const changePercent = quote.changePercent;
  const change = quote.change;

  const isAiCandidate = !!pred;
  const modelScore = pred ? pred['Model Score'] : (changePercent > 0 ? 0.22 : 0.14);

  const entry = price > 0 ? (pred?.trade_levels?.entry_price || +(price * 1.0025).toFixed(2)) : null;
  const t1 = entry ? (pred?.trade_levels?.target_price || +(entry * 1.02).toFixed(2)) : null;
  const sl = entry ? (pred?.trade_levels?.stop_loss_price || +(entry * 0.985).toFixed(2)) : null;

  const tradeLevels = entry ? {
    entry_price: entry,
    target_price: t1,
    stop_loss_price: sl,
    reward_risk_ratio: pred?.trade_levels?.reward_risk_ratio || 1.33
  } : null;

  const rsi = known?.rsi || pred?.['RSI (14)'] || (isPriceVerified ? (50 + Math.round(changePercent * 4)) : 50);
  const atr = known?.atr || pred?.['ATR %'] || (isPriceVerified ? '2.10%' : 'N/A');
  const sentiment = pred?.['Sentiment Label'] || (changePercent > 0 ? 'Bullish' : (changePercent < 0 ? 'Bearish' : 'Neutral'));

  allNseShares.push({
    ticker,
    symbol,
    name,
    price,
    change,
    changePercent,
    sector,
    marketCap,
    isAiCandidate,
    modelScore,
    tradeLevels,
    rsi,
    atr,
    sentiment,
    ...quote
  });
}

// Sort by Market Cap descending
allNseShares.sort((a, b) => (b.marketCap || 0) - (a.marketCap || 0));

console.log(`Generated ${allNseShares.length} MarketShare objects for complete NSE universe!`);

// Write JSON files
const mobileJsonPath = path.join(__dirname, '../mobile/src/data/allNseStocks.json');
const publicJsonPath = path.join(__dirname, '../public/all_nse_stocks.json');
const rootJsonPath = path.join(__dirname, '../data/all_nse_stocks.json');

const jsonStr = JSON.stringify(allNseShares);
fs.writeFileSync(mobileJsonPath, jsonStr, 'utf8');
fs.writeFileSync(publicJsonPath, jsonStr, 'utf8');
fs.writeFileSync(rootJsonPath, jsonStr, 'utf8');

console.log(`Saved:`);
console.log(`1. ${mobileJsonPath} (${(jsonStr.length / 1024).toFixed(1)} KB)`);
console.log(`2. ${publicJsonPath}`);
console.log(`3. ${rootJsonPath}`);
