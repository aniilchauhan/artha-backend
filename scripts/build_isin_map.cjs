const fs = require('fs');
const path = require('path');

const csvPath = path.join(__dirname, '..', 'nse_2500_stocks_master.csv');
const lines = fs.readFileSync(csvPath, 'utf8').split(/\r?\n/).filter(l => l.trim());

const isinMap = {};
const nameMap = {};
const symbolMap = {};

function cleanName(str) {
  if (!str) return '';
  return str.toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .replace(/(LIMITED|LTD|PRIVATE|PVT|CORP|CORPORATION|INDIA)$/g, '');
}

for (let i = 1; i < lines.length; i++) {
  const line = lines[i];
  const parts = [];
  let inQ = false, cur = '';
  for (let c = 0; c < line.length; c++) {
    if (line[c] === '"') inQ = !inQ;
    else if (line[c] === ',' && !inQ) { parts.push(cur.trim()); cur = ''; }
    else cur += line[c];
  }
  parts.push(cur.trim());

  const symbol = parts[1]?.toUpperCase()?.trim();
  const name = parts[2]?.trim();
  const isin = parts[15]?.trim()?.toUpperCase();

  if (symbol && isin && isin.startsWith('IN')) {
    isinMap[isin] = { symbol, name };
  }
  if (symbol && name) {
    const cleaned = cleanName(name);
    if (cleaned) nameMap[cleaned] = symbol;
    symbolMap[symbol] = { symbol, name };
  }
}

// Add common aliases & variants
nameMap['RELIANCE'] = 'RELIANCE';
nameMap['TCS'] = 'TCS';
nameMap['MOREPENLAB'] = 'MOREPENLAB';
nameMap['MOREPENLABORATORIES'] = 'MOREPENLAB';
nameMap['MOREPENLABSLTD'] = 'MOREPENLAB';

const outPath = path.join(__dirname, '..', 'data', 'isin_symbol_map.json');
fs.writeFileSync(outPath, JSON.stringify({ isinMap, nameMap, symbolMap }));
console.log('ISIN count:', Object.keys(isinMap).length, 'Name count:', Object.keys(nameMap).length, 'File size:', fs.statSync(outPath).size);
