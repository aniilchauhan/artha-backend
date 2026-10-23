import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const EQUITY_URL = 'https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv';
const SME_URL = 'https://nsearchives.nseindia.com/emerge/corporates/content/SME_EQUITY_L.csv';

const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

export async function fetchCsv(url, { fetchImpl = fetch, timeoutMs = 30_000 } = {}) {
  console.log(`Fetching ${url}...`);
  const controller = new AbortController();
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`Timed out fetching ${url} after ${timeoutMs}ms.`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([deadline, (async () => {
      const response = await fetchImpl(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': userAgent,
          'Accept': 'text/csv,application/csv,text/plain,*/*',
        },
      });
      if (!response.ok) {
        throw new Error(`Failed to fetch ${url}: HTTP ${response.status} ${response.statusText}`);
      }
      return await response.text();
    })()]);
  } finally {
    clearTimeout(timer);
  }
}

export function parseNseCsv(csv) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let index = 0; index < csv.length; index++) {
    const character = csv[index];
    if (character === '"') {
      if (quoted && csv[index + 1] === '"') { field += '"'; index++; }
      else quoted = !quoted;
    } else if (character === ',' && !quoted) { row.push(field.trim()); field = ''; }
    else if ((character === '\r' || character === '\n') && !quoted) {
      if (character === '\r' && csv[index + 1] === '\n') index++;
      row.push(field.trim());
      if (row.some(value => value.length)) rows.push(row);
      row = []; field = '';
    } else field += character;
  }
  if (quoted) throw new Error('The NSE identity CSV has an unterminated quoted field.');
  row.push(field.trim());
  if (row.some(value => value.length)) rows.push(row);

  const headers = rows.shift()?.map(value => value.trim().toUpperCase().replace(/_/g, ' ')) || [];
  const symbolIndex = headers.indexOf('SYMBOL');
  const nameIndex = headers.indexOf('NAME OF COMPANY');
  const seriesIndex = headers.indexOf('SERIES');
  if (symbolIndex < 0 || nameIndex < 0 || seriesIndex < 0) {
    throw new Error(`Missing required headers. Found: ${headers.join(', ')}`);
  }
  if (rows.some(r => !r[symbolIndex] || !r[nameIndex] || !r[seriesIndex])) {
    throw new Error('The NSE identity CSV contains an incomplete identity row.');
  }
  return rows;
}

/** Stage every file before replacing any live file; restore prior contents on a caught write failure. */
export function replaceCatalogFiles(dataDir, files, fileSystem = fs) {
  const lockPath = path.join(dataDir, '.nse-catalog-refresh.lock');
  const lock = fileSystem.openSync(lockPath, 'wx');
  let stagingDir;
  const changed = [];
  try {
    stagingDir = fileSystem.mkdtempSync(path.join(dataDir, '.nse-catalog-refresh-'));
    const staged = files.map(({ name, contents }) => {
      const target = path.join(dataDir, name);
      const stagedPath = path.join(stagingDir, name);
      const previous = fileSystem.existsSync(target) ? fileSystem.readFileSync(target) : null;
      fileSystem.writeFileSync(stagedPath, contents, 'utf8');
      return { target, stagedPath, previous };
    });
    for (const entry of staged) {
      fileSystem.renameSync(entry.stagedPath, entry.target);
      changed.push(entry);
    }
  } catch (error) {
    const failures = [];
    for (const { target, previous } of changed.reverse()) {
      try {
        if (previous === null) fileSystem.unlinkSync(target);
        else fileSystem.writeFileSync(target, previous);
      } catch (failure) { failures.push(failure); }
    }
    if (failures.length) throw new AggregateError([error, ...failures], 'Catalog update and rollback failed; check the data files before scanning.');
    throw error;
  } finally {
    try {
      if (stagingDir) fileSystem.rmSync(stagingDir, { recursive: true, force: true });
    } finally {
      fileSystem.closeSync(lock);
      fileSystem.unlinkSync(lockPath);
    }
  }
}

export async function main() {
  const [equityCsv, smeCsv] = await Promise.all([
    fetchCsv(EQUITY_URL),
    fetchCsv(SME_URL),
  ]);

  const equityRows = parseNseCsv(equityCsv);
  console.log(`Parsed ${equityRows.length} main-board equity rows.`);

  const smeRows = parseNseCsv(smeCsv);
  console.log(`Parsed ${smeRows.length} SME equity rows.`);

  if (equityRows.length < 1500) {
    throw new Error(`Main-board equity rows count suspiciously low (${equityRows.length}). Aborting update.`);
  }
  if (smeRows.length < 100) {
    throw new Error(`SME equity rows count suspiciously low (${smeRows.length}). Aborting update.`);
  }

  // Today's date in YYYY-MM-DD
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

  const sourceMeta = {
    snapshotDate: today,
    sources: [
      {
        path: 'data/nse-equities.csv',
        url: EQUITY_URL,
      },
      {
        path: 'data/nse-sme-equities.csv',
        url: SME_URL,
      },
    ],
  };

  replaceCatalogFiles(path.join(rootDir, 'data'), [
    { name: 'nse-equities.csv', contents: equityCsv },
    { name: 'nse-sme-equities.csv', contents: smeCsv },
    { name: 'nse-catalog-source.json', contents: JSON.stringify(sourceMeta, null, 2) + '\n' },
  ]);
  console.log(`Saved both catalogs and source metadata with snapshotDate: ${today}`);
  console.log('NSE Catalog refreshed successfully!');
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch(err => {
    console.error('Error refreshing NSE catalog:', err);
    process.exitCode = 1;
  });
}
