import { getAxionProjectRoot } from './project-root';
import fs from 'fs';
import path from 'path';
import type { LiquidityAudit } from './opportunity-types';

interface UniverseAuditRecord {
  symbol: string;
  eligible: boolean;
  exclusion_reason: string;
  median_turnover_inr: number;
  avg_volume: number;
  latest_close: number;
  circuit_pct: number;
  continuity_pct: number;
}

let auditCache: Map<string, UniverseAuditRecord> | null = null;

function loadUniverseAudit(): Map<string, UniverseAuditRecord> {
  if (auditCache) return auditCache;
  const map = new Map<string, UniverseAuditRecord>();

  const root = getAxionProjectRoot();
  const primaryPath = path.resolve(root, 'stock-ai', 'outputs', 'swing_universe_membership.csv');
  const fallbackPath = path.resolve(root, 'data', 'stock-ai', 'swing_universe_membership.csv');
  const targetPath = fs.existsSync(primaryPath) ? primaryPath : fs.existsSync(fallbackPath) ? fallbackPath : null;

  if (targetPath) {
    try {
      const raw = fs.readFileSync(targetPath, 'utf-8');
      const lines = raw.split('\n');
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const parts = line.split(',');
        if (parts.length >= 8) {
          const sym = parts[0].trim();
          const cleanSym = sym.replace('.NS', '').replace('.BO', '');
          const eligible = parts[1].trim().toLowerCase() === 'true';
          const exclusionReason = parts[2].replace(/"/g, '').trim();
          const turnover = parseFloat(parts[3]) || 0;
          const avgVol = parseFloat(parts[4]) || 0;
          const close = parseFloat(parts[5]) || 0;
          const circuitPct = parseFloat(parts[6]) || 0;
          const continuityPct = parseFloat(parts[7]) || 0;

          const rec: UniverseAuditRecord = {
            symbol: sym,
            eligible,
            exclusion_reason: exclusionReason,
            median_turnover_inr: turnover,
            avg_volume: avgVol,
            latest_close: close,
            circuit_pct: circuitPct,
            continuity_pct: continuityPct,
          };
          map.set(sym, rec);
          map.set(cleanSym, rec);
        }
      }
    } catch (err) {
      console.error('[LiquidityAudit] Failed to load universe membership CSV:', err);
    }
  }
  auditCache = map;
  return map;
}

export function auditStockLiquidity(
  ticker: string,
  currentPrice?: number,
  volumeRatio?: number
): LiquidityAudit {
  const auditMap = loadUniverseAudit();
  const cleanTicker = ticker.replace('.NS', '').replace('.BO', '');
  const rec = auditMap.get(ticker) || auditMap.get(cleanTicker);

  const price = currentPrice !== undefined && Number.isFinite(currentPrice) && currentPrice > 0
    ? currentPrice
    : rec?.latest_close || 0;

  const warnings: string[] = [];
  const isPenny = price > 0 && price < 20;

  if (isPenny) {
    warnings.push(`Penny Stock Warning (₹${price.toFixed(2)} < ₹20): Extreme volatility, low institutional backing, and wide bid-ask spread.`);
  }

  if (rec) {
    const turnoverCr = rec.median_turnover_inr / 1e7;
    const circuitPct = rec.circuit_pct * 100;

    if (rec.median_turnover_inr < 100_000_000 && rec.median_turnover_inr > 0) {
      warnings.push(`Low Daily Turnover (₹${turnoverCr.toFixed(1)} Cr < ₹10 Cr min): Order book is thin; market orders face high slippage.`);
    }

    if (rec.avg_volume < 250_000 && rec.avg_volume > 0) {
      warnings.push(`Low Average Volume (${Math.round(rec.avg_volume).toLocaleString('en-IN')} shares < 250k daily): High liquidity friction.`);
    }

    if (rec.circuit_pct > 0.02) {
      warnings.push(`Circuit Freeze Risk (${circuitPct.toFixed(1)}% session lock frequency): Stop loss or intraday square-off may fail if locked in circuit.`);
    }

    if (rec.continuity_pct < 0.90 && rec.continuity_pct > 0) {
      warnings.push(`Sporadic Trading History (${(rec.continuity_pct * 100).toFixed(0)}% trading day continuity): Irregular trading presence.`);
    }

    if (isPenny) {
      return {
        isLiquid: false,
        status: 'PENNY_STOCK',
        label: '⚠️ Penny Stock (< ₹20)',
        badgeColor: 'rose',
        warnings,
        medianTurnoverCr: Number(turnoverCr.toFixed(1)),
        avgVolume: Math.round(rec.avg_volume),
        isPennyStock: true,
        circuitRiskPct: Number(circuitPct.toFixed(1)),
      };
    }

    if (rec.circuit_pct > 0.05) {
      return {
        isLiquid: false,
        status: 'CIRCUIT_RISK',
        label: '🚨 Circuit Lock Hazard',
        badgeColor: 'rose',
        warnings,
        medianTurnoverCr: Number(turnoverCr.toFixed(1)),
        avgVolume: Math.round(rec.avg_volume),
        isPennyStock: false,
        circuitRiskPct: Number(circuitPct.toFixed(1)),
      };
    }

    if (!rec.eligible) {
      const isTurnoverIssue = rec.exclusion_reason.includes('LOW_TURNOVER') || rec.exclusion_reason.includes('LOW_VOLUME');
      return {
        isLiquid: false,
        status: isTurnoverIssue ? 'LOW_TURNOVER' : 'CIRCUIT_RISK',
        label: isTurnoverIssue ? '⚠️ Low Turnover (< ₹10 Cr)' : '⚠️ Liquidity Risk',
        badgeColor: 'amber',
        warnings,
        medianTurnoverCr: Number(turnoverCr.toFixed(1)),
        avgVolume: Math.round(rec.avg_volume),
        isPennyStock: isPenny,
        circuitRiskPct: Number(circuitPct.toFixed(1)),
      };
    }

    return {
      isLiquid: true,
      status: 'VERIFIED_LIQUID',
      label: `🛡️ Institutional Liquid (₹${turnoverCr.toFixed(0)} Cr)`,
      badgeColor: 'emerald',
      warnings,
      medianTurnoverCr: Number(turnoverCr.toFixed(1)),
      avgVolume: Math.round(rec.avg_volume),
      isPennyStock: false,
      circuitRiskPct: Number(circuitPct.toFixed(1)),
    };
  }

  // Fallback for symbols not present in audit CSV
  if (isPenny) {
    return {
      isLiquid: false,
      status: 'PENNY_STOCK',
      label: '⚠️ Penny Stock (< ₹20)',
      badgeColor: 'rose',
      warnings,
      isPennyStock: true,
    };
  }

  if (volumeRatio !== undefined && volumeRatio < 0.4) {
    warnings.push(`Sub-Normal Volume Ratio (${volumeRatio.toFixed(2)}x 20d avg): Trading interest is subdued.`);
    return {
      isLiquid: false,
      status: 'LOW_VOLUME',
      label: '⚠️ Thin Volume Setup',
      badgeColor: 'amber',
      warnings,
      isPennyStock: false,
    };
  }

  return {
    isLiquid: true,
    status: 'VERIFIED_LIQUID',
    label: '🛡️ Liquid Equity',
    badgeColor: 'emerald',
    warnings,
    isPennyStock: false,
  };
}
