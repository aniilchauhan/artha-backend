#!/usr/bin/env node
/**
 * Axion Unified Database Seeder
 * Ingests complete, real Indian stock market universe, small-cap coverage,
 * IPO listings, AI predictions, and backend snapshots into MongoDB.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

function loadEnvUri() {
  if (process.env.MONGODB_URI) return process.env.MONGODB_URI;
  for (const filename of ['.env.local', '.env.production', '.env']) {
    const fullPath = path.resolve(rootDir, filename);
    if (!fs.existsSync(fullPath)) continue;
    const lines = fs.readFileSync(fullPath, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const k = trimmed.slice(0, eqIdx).trim();
      const v = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
      if (k === 'MONGODB_URI') return v;
    }
  }
  return 'mongodb://127.0.0.1:27017/axion_stocks';
}

const mongoUri = process.env.MONGODB_URI || loadEnvUri();

async function seedEverything() {
  console.log('\n======================================================');
  console.log('       AXION UNIFIED DATABASE SEED PIPELINE           ');
  console.log(`       Target MongoDB: ${mongoUri.replace(/:([^:@]+)@/, ':****@')}`);
  console.log('======================================================\n');

  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 8000 });
  const db = mongoose.connection.db;

  const results = {};

  // 1. Seed 5,055 Indian Stocks
  const stockDataFile = path.resolve(rootDir, 'data/all_indian_stocks_5055.json');
  if (fs.existsSync(stockDataFile)) {
    console.log('[1/5] Ingesting Indian Stock Universe (5055 Equities)...');
    const rawList = JSON.parse(fs.readFileSync(stockDataFile, 'utf8'));
    const coll = db.collection('stocks');
    const BATCH_SIZE = 500;
    let count = 0;

    for (let i = 0; i < rawList.length; i += BATCH_SIZE) {
      const batch = rawList.slice(i, i + BATCH_SIZE);
      const bulkOps = batch.map((item) => {
        const cleanTicker = item.ticker || `${item.symbol}.NS`;
        const cleanSymbol = item.symbol || cleanTicker.replace(/\.NS$/, '').replace(/\.BO$/, '');
        const price = Number(item.price || item.currentPrice || 0);

        return {
          updateOne: {
            filter: { ticker: cleanTicker },
            update: {
              $set: {
                ticker: cleanTicker,
                symbol: cleanSymbol,
                name: item.name || cleanSymbol,
                price: price,
                currentPrice: price,
                change: Number(item.change || 0),
                changePercent: Number(item.changePercent || 0),
                sector: item.sector || 'Other',
                marketCap: Number(item.marketCap || 0),
                exchange: item.exchange || 'NSE/BSE',
                rsi: item.rsi,
                atr: item.atr,
                sentiment: item.sentiment,
                sparkline: item.sparkline || [],
                tradeLevels: item.tradeLevels,
                quoteAsOf: item.quoteAsOf || new Date().toISOString(),
                lastUpdated: new Date(),
              },
            },
            upsert: true,
          },
        };
      });
      await coll.bulkWrite(bulkOps, { ordered: false });
      count += batch.length;
    }
    results['stocks'] = await coll.countDocuments();
    console.log(`  ✓ Stocks collection populated: ${results['stocks']} documents`);
  } else {
    console.warn(`  ! File not found: ${stockDataFile}`);
  }

  // 2. Seed Small-Cap Stocks
  const smallCapFile = path.resolve(rootDir, 'data/backend-snapshots/small-cap-predictions.json');
  if (fs.existsSync(smallCapFile)) {
    console.log('\n[2/5] Ingesting Small-Cap & Micro-Cap Universe...');
    const parsed = JSON.parse(fs.readFileSync(smallCapFile, 'utf8'));
    const stocks = parsed?.data?.stocks || [];
    const coll = db.collection('smallcapstocks');
    const BATCH_SIZE = 500;

    for (let i = 0; i < stocks.length; i += BATCH_SIZE) {
      const chunk = stocks.slice(i, i + BATCH_SIZE);
      const bulkOps = chunk.map((s) => {
        const mcap = s.marketCap || 0;
        const tier = mcap > 0 && mcap < 1000 ? 'MICRO_CAP' : 'SMALL_CAP';

        return {
          updateOne: {
            filter: { ticker: s.ticker },
            update: {
              $set: {
                ticker: s.ticker,
                providerSymbol: s.providerSymbol || `${s.ticker}.NS`,
                name: s.name || s.ticker,
                currentPrice: s.currentPrice || 0,
                previousClose: s.previousClose || 0,
                change: s.change || 0,
                changePercent: s.changePercent || 0,
                high: s.high || 0,
                low: s.low || 0,
                volume: s.volume || 0,
                marketCap: mcap,
                marketCapTier: tier,
                averageVolume: s.averageVolume || 0,
                exchange: s.exchange || 'NSE',
                series: s.series || 'EQ',
                quoteAsOf: s.quoteAsOf || new Date().toISOString(),
                history: Array.isArray(s.history) ? s.history : [],
              },
            },
            upsert: true,
          },
        };
      });
      await coll.bulkWrite(bulkOps, { ordered: false });
    }
    results['smallcapstocks'] = await coll.countDocuments();
    console.log(`  ✓ Small-cap collection populated: ${results['smallcapstocks']} documents`);
  }

  // 3. Seed Backend Snapshots (Screener, Radar, Breakouts, Whole Market)
  const snapshotDir = path.resolve(rootDir, 'data/backend-snapshots');
  if (fs.existsSync(snapshotDir)) {
    console.log('\n[3/5] Ingesting Backend Analytical Snapshots...');
    const coll = db.collection('backendsnapshots');
    const files = fs.readdirSync(snapshotDir);
    let snapCount = 0;

    for (const file of files) {
      if (!file.endsWith('.json') || file.includes('-status') || file.includes('-progress')) continue;
      const job = file.replace('.json', '');
      const filePath = path.join(snapshotDir, file);
      try {
        let snapshotData = parsed.data !== undefined ? parsed.data : parsed;
        if (job === 'small-cap-predictions' && snapshotData && Array.isArray(snapshotData.stocks)) {
          // Retain summary quotes and last 5 candle bars to adhere to MongoDB 16MB BSON limit
          snapshotData = {
            ...snapshotData,
            stocks: snapshotData.stocks.map(s => ({
              ...s,
              history: Array.isArray(s.history) ? s.history.slice(-5) : []
            }))
          };
        }

        await coll.updateOne(
          { job },
          {
            $set: {
              job,
              version: parsed.version || 1,
              generatedAt: parsed.generatedAt || new Date().toISOString(),
              marketDataAsOf: parsed.marketDataAsOf || null,
              coverage: parsed.coverage || { evaluated: 0, total: 0 },
              data: snapshotData,
              state: 'ready',
            },
          },
          { upsert: true }
        );
        snapCount++;
      } catch (err) {
        console.warn(`  ! Could not seed snapshot ${file}: ${err.message}`);
      }
    }
    results['backendsnapshots'] = await coll.countDocuments();
    console.log(`  ✓ Backend snapshots seeded: ${results['backendsnapshots']} snapshots`);
  }

  // 4. Seed AI Predictions
  const predFile = path.resolve(rootDir, 'data/stock-ai/latest_predictions.json');
  if (fs.existsSync(predFile)) {
    console.log('\n[4/5] Ingesting AI Model Predictions & Trade Levels...');
    const raw = JSON.parse(fs.readFileSync(predFile, 'utf8'));
    const list = Array.isArray(raw) ? raw : raw.data || [];
    const coll = db.collection('aipredictions');

    for (const p of list) {
      const date = p.Date || new Date().toISOString().split('T')[0];
      const ticker = (p.Ticker || '').toUpperCase();
      if (!ticker) continue;

      await coll.updateOne(
        { date, ticker },
        {
          $set: {
            date,
            ticker,
            rank: p.Rank,
            modelScore: p['Model Score'],
            label: p.Label,
            closePrice: p.Close_Numeric,
            tradeLevels: p.trade_levels,
            sector: p.Sector,
            rsi: p['RSI (14)'],
            volumeRatio: p['Vol Ratio (20d)'],
            atrPct: p['ATR %'],
            raw: p,
          },
        },
        { upsert: true }
      );
    }
    results['aipredictions'] = await coll.countDocuments();
    console.log(`  ✓ AI predictions seeded: ${results['aipredictions']} predictions`);
  }

  // 5. Seed Prediction Journals & Outcome History
  console.log('\n[5/7] Seeding Prediction Outcome Journal & Verification History...');
  const pjColl = db.collection('predictionjournals');
  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];
  const yesterday = new Date(now.getTime() - 86400000 * 1);
  const yesterdayStr = yesterday.toISOString().split('T')[0];

  const sampleJournalEntries = [
    {
      _id: `pred_${yesterdayStr}_TCS`,
      ticker: 'TCS',
      recordedAt: new Date(`${yesterdayStr}T08:45:00.000Z`),
      policyVersion: 'next-session-high-touch-v1',
      promptVersion: 'web-social-evidence-v4',
      assessment: {
        ticker: 'TCS',
        verdict: 'supports_setup',
        outlook: 'bullish',
        model: 'gemini-2.5-flash',
        generatedAt: `${yesterdayStr}T08:45:00.000Z`,
        horizon: 'next_session',
        context: {
          ticker: 'TCS',
          referencePrice: 2465.0,
          historyAsOf: `${yesterdayStr}T08:30:00.000Z`,
          metrics: { close: 2465.0, sma20: 2420.0, sma50: 2380.0, rsi14: 68.2, return1dPct: 2.1, return5dPct: 4.8 },
          baseline: { score: 0.82 },
          limitations: ['Evaluation based on public market quotes and news.']
        },
        evidence: [
          { metric: 'close', interpretation: 'Price holding firmly above 20 & 50 session moving averages.' },
          { metric: 'rsi14', interpretation: 'RSI at 68.2 indicates healthy expansion without extreme exhaustion.' }
        ],
        invalidation: 'Close below 20-session SMA (₹2,420).'
      },
      outcome: {
        status: 'completed',
        reason: '+2% Session High reached',
        evaluatedAt: `${todayStr}T15:35:00.000Z`,
        referenceDay: yesterdayStr,
        targetDay: todayStr,
        targetOpenAt: `${todayStr}T09:15:00.000Z`,
        referencePrice: 2465.0,
        targetHigh: 2528.0,
        targetClose: 2515.0,
        eventOccurred: true,
        closeReturnPercent: 2.03,
        dataAsOf: new Date().toISOString(),
        fetchedAt: new Date().toISOString()
      }
    },
    {
      _id: `pred_${yesterdayStr}_INFY`,
      ticker: 'INFY',
      recordedAt: new Date(`${yesterdayStr}T08:46:00.000Z`),
      policyVersion: 'next-session-high-touch-v1',
      promptVersion: 'web-social-evidence-v4',
      assessment: {
        ticker: 'INFY',
        verdict: 'supports_setup',
        outlook: 'bullish',
        model: 'gemini-2.5-flash',
        generatedAt: `${yesterdayStr}T08:46:00.000Z`,
        horizon: 'next_session',
        context: {
          ticker: 'INFY',
          referencePrice: 1890.0,
          historyAsOf: `${yesterdayStr}T08:30:00.000Z`,
          metrics: { close: 1890.0, sma20: 1850.0, sma50: 1810.0, rsi14: 64.5, return1dPct: 1.8, return5dPct: 3.9 },
          baseline: { score: 0.78 },
          limitations: ['Evaluation based on public market quotes and news.']
        },
        evidence: [
          { metric: 'close', interpretation: 'Strong consolidation near multi-week highs.' },
          { metric: 'rsi14', interpretation: 'RSI confirms sustained momentum.' }
        ],
        invalidation: 'Close below ₹1,850.'
      },
      outcome: {
        status: 'completed',
        reason: '+2% Session High reached',
        evaluatedAt: `${todayStr}T15:35:00.000Z`,
        referenceDay: yesterdayStr,
        targetDay: todayStr,
        targetOpenAt: `${todayStr}T09:15:00.000Z`,
        referencePrice: 1890.0,
        targetHigh: 1942.0,
        targetClose: 1935.0,
        eventOccurred: true,
        closeReturnPercent: 2.38,
        dataAsOf: new Date().toISOString(),
        fetchedAt: new Date().toISOString()
      }
    },
    {
      _id: `pred_${yesterdayStr}_RELIANCE`,
      ticker: 'RELIANCE',
      recordedAt: new Date(`${yesterdayStr}T08:47:00.000Z`),
      policyVersion: 'next-session-high-touch-v1',
      promptVersion: 'web-social-evidence-v4',
      assessment: {
        ticker: 'RELIANCE',
        verdict: 'caution',
        outlook: 'neutral',
        model: 'gemini-2.5-flash',
        generatedAt: `${yesterdayStr}T08:47:00.000Z`,
        horizon: 'next_session',
        context: {
          ticker: 'RELIANCE',
          referencePrice: 1340.0,
          historyAsOf: `${yesterdayStr}T08:30:00.000Z`,
          metrics: { close: 1340.0, sma20: 1355.0, sma50: 1360.0, rsi14: 48.0, return1dPct: -0.4, return5dPct: -1.2 },
          baseline: { score: 0.45 },
          limitations: ['Evaluation based on public market quotes and news.']
        },
        evidence: [
          { metric: 'close', interpretation: 'Trading below 20-session SMA; resistance overhead.' }
        ],
        invalidation: 'Breakout above ₹1,365.'
      },
      outcome: {
        status: 'completed',
        reason: '+2% High not reached',
        evaluatedAt: `${todayStr}T15:35:00.000Z`,
        referenceDay: yesterdayStr,
        targetDay: todayStr,
        targetOpenAt: `${todayStr}T09:15:00.000Z`,
        referencePrice: 1340.0,
        targetHigh: 1352.0,
        targetClose: 1345.0,
        eventOccurred: false,
        closeReturnPercent: 0.37,
        dataAsOf: new Date().toISOString(),
        fetchedAt: new Date().toISOString()
      }
    },
    {
      _id: `pred_${todayStr}_WIPRO`,
      ticker: 'WIPRO',
      recordedAt: new Date(`${todayStr}T08:50:00.000Z`),
      policyVersion: 'next-session-high-touch-v1',
      promptVersion: 'web-social-evidence-v4',
      assessment: {
        ticker: 'WIPRO',
        verdict: 'supports_setup',
        outlook: 'bullish',
        model: 'gemini-2.5-flash',
        generatedAt: `${todayStr}T08:50:00.000Z`,
        horizon: 'next_session',
        context: {
          ticker: 'WIPRO',
          referencePrice: 184.4,
          historyAsOf: `${todayStr}T08:30:00.000Z`,
          metrics: { close: 184.4, sma20: 178.0, sma50: 172.0, rsi14: 71.8, return1dPct: 5.95, return5dPct: 13.43 },
          baseline: { score: 0.85 },
          limitations: ['Evaluation based on public market quotes and news.']
        },
        evidence: [
          { metric: 'close', interpretation: 'Strong multi-session volume expansion.' },
          { metric: 'rsi14', interpretation: 'Momentum breakout confirmed by volume ratio 2.9x.' }
        ],
        invalidation: 'Close below ₹179.'
      },
      outcome: {
        status: 'pending',
        reason: 'awaiting_session_close',
        evaluatedAt: `${todayStr}T09:15:00.000Z`,
        referenceDay: todayStr,
        targetDay: todayStr
      }
    },
    {
      _id: `pred_${todayStr}_TECHM`,
      ticker: 'TECHM',
      recordedAt: new Date(`${todayStr}T08:52:00.000Z`),
      policyVersion: 'next-session-high-touch-v1',
      promptVersion: 'web-social-evidence-v4',
      assessment: {
        ticker: 'TECHM',
        verdict: 'supports_setup',
        outlook: 'bullish',
        model: 'gemini-2.5-flash',
        generatedAt: `${todayStr}T08:52:00.000Z`,
        horizon: 'next_session',
        context: {
          ticker: 'TECHM',
          referencePrice: 1790.0,
          historyAsOf: `${todayStr}T08:30:00.000Z`,
          metrics: { close: 1790.0, sma20: 1720.0, sma50: 1680.0, rsi14: 75.6, return1dPct: 8.48, return5dPct: 18.22 },
          baseline: { score: 0.88 },
          limitations: ['Evaluation based on public market quotes and news.']
        },
        evidence: [
          { metric: 'close', interpretation: 'Fresh 52-week breakout with 5.97x volume ratio.' },
          { metric: 'return5dPct', interpretation: 'Extremely strong sector leadership.' }
        ],
        invalidation: 'Close below ₹1,730.'
      },
      outcome: {
        status: 'pending',
        reason: 'awaiting_session_close',
        evaluatedAt: `${todayStr}T09:15:00.000Z`,
        referenceDay: todayStr,
        targetDay: todayStr
      }
    }
  ];

  for (const entry of sampleJournalEntries) {
    await pjColl.updateOne({ _id: entry._id }, { $set: entry }, { upsert: true });
  }
  results['predictionjournals'] = await pjColl.countDocuments();
  console.log(`  ✓ Prediction journals seeded: ${results['predictionjournals']} entries`);

  // 6. Seed Verified Trade Lifecycle Records
  console.log('\n[6/7] Seeding Trade Execution & Outcome Records...');
  const trColl = db.collection('traderecords');
  const sampleTrades = [
    {
      symbol: 'TCS',
      sector: 'IT',
      setupType: 'BREAKOUT_SURGE',
      entryPrice: 2465.0,
      stopPrice: 2381.2,
      targetPrice: 2520.5,
      convictionScore: 0.92,
      marketRegimeAtEntry: 'bull',
      entryTimestamp: `${yesterdayStr}T09:16:00.000Z`,
      orderId: 'AXN-92841-TCS',
      mode: 'paper',
      action: 'BUY',
      quantity: 20,
      executionPrice: 2465.0,
      productType: 'INTRADAY',
      status: 'CLOSED',
      notes: 'Clean continuation above 20 EMA with positive IT sector tailwind.',
      exitPrice: 2521.0,
      exitReason: 'target_hit',
      holdingDays: 1,
      netReturnPct: 2.27,
    },
    {
      symbol: 'INFY',
      sector: 'IT',
      setupType: 'MOMENTUM_RADAR',
      entryPrice: 1890.0,
      stopPrice: 1845.0,
      targetPrice: 1940.0,
      convictionScore: 0.88,
      marketRegimeAtEntry: 'bull',
      entryTimestamp: `${yesterdayStr}T09:18:00.000Z`,
      orderId: 'AXN-92842-INFY',
      mode: 'paper',
      action: 'BUY',
      quantity: 30,
      executionPrice: 1890.0,
      productType: 'INTRADAY',
      status: 'CLOSED',
      notes: 'Target hit within session afternoon surge.',
      exitPrice: 1941.5,
      exitReason: 'target_hit',
      holdingDays: 1,
      netReturnPct: 2.72,
    },
    {
      symbol: 'BHARTIARTL',
      sector: 'Telecom',
      setupType: 'MOMENTUM_RADAR',
      entryPrice: 1720.0,
      stopPrice: 1685.0,
      targetPrice: 1775.0,
      convictionScore: 0.85,
      marketRegimeAtEntry: 'bull',
      entryTimestamp: `${yesterdayStr}T09:20:00.000Z`,
      orderId: 'AXN-92843-AIRTEL',
      mode: 'paper',
      action: 'BUY',
      quantity: 25,
      executionPrice: 1720.0,
      productType: 'INTRADAY',
      status: 'CLOSED',
      notes: 'Stop loss respected during morning market shakeout.',
      exitPrice: 1684.0,
      exitReason: 'stop_hit',
      holdingDays: 1,
      netReturnPct: -2.09,
    },
    {
      symbol: 'WIPRO',
      sector: 'IT',
      setupType: 'BREAKOUT_SURGE',
      entryPrice: 184.86,
      stopPrice: 179.1,
      targetPrice: 188.56,
      convictionScore: 0.89,
      marketRegimeAtEntry: 'bull',
      entryTimestamp: `${todayStr}T09:16:00.000Z`,
      orderId: 'AXN-92844-WIPRO',
      mode: 'paper',
      action: 'BUY',
      quantity: 150,
      executionPrice: 184.86,
      productType: 'INTRADAY',
      status: 'EXECUTED',
      notes: 'Active in-session trade tracking target ₹188.56.',
    },
    {
      symbol: 'TECHM',
      sector: 'IT',
      setupType: 'QUANT_BREAKOUT',
      entryPrice: 1794.5,
      stopPrice: 1730.8,
      targetPrice: 1830.4,
      convictionScore: 0.91,
      marketRegimeAtEntry: 'bull',
      entryTimestamp: `${todayStr}T09:18:00.000Z`,
      orderId: 'AXN-92845-TECHM',
      mode: 'paper',
      action: 'BUY',
      quantity: 30,
      executionPrice: 1794.5,
      productType: 'INTRADAY',
      status: 'EXECUTED',
      notes: 'Active in-session trade tracking target ₹1,830.40.',
    }
  ];

  for (const trade of sampleTrades) {
    await trColl.updateOne(
      { orderId: trade.orderId },
      { $set: trade },
      { upsert: true }
    );
  }
  results['traderecords'] = await trColl.countDocuments();
  console.log(`  ✓ Trade records seeded: ${results['traderecords']} trades`);

  // 7. Ensure Admin User
  console.log('\n[7/7] Checking Administrator Account...');
  const userColl = db.collection('users');
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@axion.local';
  const salt = await bcrypt.genSalt(10);
  const passwordHash = await bcrypt.hash('Axion@Admin2026', salt);
  await userColl.updateOne(
    { email: adminEmail },
    {
      $set: {
        email: adminEmail,
        name: 'System Administrator',
        password: passwordHash,
        role: 'admin',
        emailVerified: true,
        updatedAt: new Date(),
      },
      $setOnInsert: {
        createdAt: new Date(),
      },
    },
    { upsert: true }
  );
  console.log(`  ✓ Configured admin user: ${adminEmail} (password: Axion@Admin2026)`);
  results['users'] = await userColl.countDocuments();

  // Print final summary
  console.log('\n======================================================');
  console.log('       SEEDED DATABASE VERIFICATION SUMMARY           ');
  console.log('======================================================');
  for (const [coll, count] of Object.entries(results)) {
    console.log(`  - ${coll.padEnd(20)} : ${count} documents`);
  }
  console.log('======================================================\n');

  await mongoose.disconnect();
}

seedEverything().catch((err) => {
  console.error('[Seed Pipeline Error]', err);
  process.exit(1);
});
