import { parseTradeDate } from './date-parser';
import { resolveStockIdentity } from './stock-master';

export type ImportedTrade = {
  id: string;
  timestamp: string;
  ticker: string;
  displayName?: string;
  isin?: string;
  matchSource?: 'isin' | 'symbol' | 'name' | 'alias' | 'fallback';
  reportedPnl?: number;
  action: 'BUY' | 'SELL';
  quantity: number;
  price: number;
  brokerage: number;
  taxes: number;
  netValue: number;
  holdingDays?: number;
  importBatchId?: string;
};

export interface RejectedRowInfo {
  rowNumber: number;
  rawLine?: string;
  cells: string[];
  reason: string;
}

export interface DuplicateTradeInfo {
  trade: ImportedTrade;
  existingId: string;
  reason: string;
}

export interface ImportAnalysisResult {
  fileName?: string;
  totalRows: number;
  validTrades: ImportedTrade[];
  matchedTrades: ImportedTrade[];
  unmatchedTrades: ImportedTrade[];
  duplicateTrades: DuplicateTradeInfo[];
  rejectedRows: RejectedRowInfo[];
  summary: {
    totalRows: number;
    validCount: number;
    duplicateCount: number;
    rejectedCount: number;
    buyCount: number;
    sellCount: number;
    totalBuyValue: number;
    totalSellValue: number;
    estimatedRealizedPnl: number;
  };
}

export function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let value = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      cells.push(value.trim());
      value = '';
    } else {
      value += char;
    }
  }
  cells.push(value.trim());
  return cells;
}

export function numberValue(value: string | undefined): number {
  const cleaned = (value ?? '').trim().replace(/[₹,]/g, '');
  if (!cleaned || cleaned === '-' || cleaned === '--' || cleaned.toLowerCase() === 'na') return 0;
  return Number(cleaned.replace(/^\((.*)\)$/, '-$1'));
}

export function normaliseTicker(value: string | undefined): string {
  return (value ?? '')
    .trim()
    .toUpperCase()
    .replace(/\.NS$/, '')
    .replace(/\.BO$/, '')
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 25);
}

/**
 * Parses broker CSV or Excel exported text with comprehensive validation,
 * ISIN mapping, Indian date handling, and rejection tracking.
 */
export function analyzePortfolioImport(
  csv: string,
  existingTransactions: { id: string; ticker: string; action: string; quantity: number; price: number; timestamp?: string }[] = [],
  fileName?: string
): ImportAnalysisResult {
  const lines = csv.replace(/^\uFEFF/, '').split(/\r?\n/).filter(line => line.trim());
  if (lines.length < 2) {
    throw new Error('Import file needs a header row and at least one trade.');
  }

  const normalized = (line: string) => splitCsvLine(line).map(h => h.toLowerCase().replace(/[^a-z0-9]/g, ''));

  const headerIndex = lines.findIndex(line => {
    const headers = normalized(line);
    const has = (names: string[]) => headers.some(h => names.some(n => h === n || h.includes(n)));
    const hasSymbol = has(['ticker', 'symbol', 'instrument', 'scrip', 'script', 'stockname', 'companyname', 'stock', 'isin']);
    const hasDate = has(['date', 'timestamp', 'datetime']);
    const hasQuantity = has(['quantity', 'qty', 'shares']);
    const hasPrice = has(['price', 'rate', 'average', 'avg']);
    return hasSymbol && ((hasDate && hasQuantity) || (hasQuantity && hasPrice));
  });

  if (headerIndex < 0) {
    throw new Error('Could not find the header row. Expected trade date, symbol/instrument/ISIN, action, quantity, and price columns.');
  }

  const headers = normalized(lines[headerIndex]);
  const locate = (...names: string[]) => {
    const exact = headers.findIndex(h => names.includes(h));
    if (exact >= 0) return exact;
    return headers.findIndex(h => names.some(n => n.length > 3 && h.includes(n)));
  };

  const find = (...names: string[]) => {
    const index = locate(...names);
    if (index < 0) throw new Error(`Excel is missing a ${names[0]} column.`);
    return index;
  };

  const optional = (...names: string[]) => {
    const index = locate(...names);
    return index < 0 ? undefined : index;
  };

  const dateCol = optional('date', 'tradedate', 'buydate', 'selldate', 'timestamp', 'datetime', 'tradetime');
  const buyDateCol = optional('buydate', 'dateofacquisition', 'purchasedate', 'dateofpurchase');
  const sellDateCol = optional('selldate', 'dateofsale', 'saledate', 'dateofexit');
  const isinCol = optional('isin', 'isincode', 'isinnumber');
  const tickerCol = find('ticker', 'symbol', 'instrument', 'scrip', 'scripname', 'script', 'stockname', 'companyname', 'stock');
  const actionCol = optional('action', 'side', 'type', 'buysell', 'transactiontype', 'ordertype');
  const quantityCol = optional('quantity', 'qty', 'shares', 'filledquantity', 'executedquantity');
  const priceCol = optional('price', 'rate', 'averageprice', 'avgprice', 'avgbuyprice', 'averagebuyprice', 'executionprice');
  const buyQuantityCol = optional('buyquantity', 'buyqty');
  const sellQuantityCol = optional('sellquantity', 'sellqty');
  const buyPriceCol = optional('buyprice', 'buyaverageprice', 'buyavgprice', 'buyrate', 'costprice', 'acquisitionprice', 'buypriceperunit');
  const sellPriceCol = optional('sellprice', 'sellaverageprice', 'sellavgprice', 'sellrate', 'exitprice', 'saleprice', 'sellpriceperunit');
  const buyValueCol = optional('buyvalue', 'buyamount', 'buycost', 'costofacquisition', 'totalbuyprice', 'purchasevalue');
  const sellValueCol = optional('sellvalue', 'sellamount', 'saleproceeds', 'totalsellprice', 'sellconsideration', 'salevalue');
  const reportedPnlCol = optional('realisedpl', 'realizedpl', 'realisedpnl', 'realizedpnl', 'pnl', 'profitloss', 'profit', 'grosspl', 'netpl', 'gainloss', 'gain', 'netprofit', 'grossprofit', 'capitalgain', 'capgain', 'stcg', 'ltcg');
  const chargesCol = optional('charges', 'totalcharges', 'expenses', 'othercharges', 'regulatorycharges', 'taxandcharges', 'fees', 'transfercharges', 'expenditure');
  const brokerageCol = optional('brokerage', 'brokeragecharges');
  const taxesCol = optional('taxes', 'totaltaxes', 'stt', 'securitiestransactiontax');
  const holdingDaysCol = optional('holdingperioddays', 'holdingperiod', 'periodofholding', 'holdingdays', 'termindays');

  const effectivePriceCol = buyPriceCol !== undefined && sellPriceCol !== undefined ? undefined : priceCol;
  const isHoldingsSnapshot = actionCol === undefined && buyQuantityCol === undefined && sellQuantityCol === undefined;

  if (actionCol === undefined && !isHoldingsSnapshot && (buyQuantityCol === undefined || sellQuantityCol === undefined)) {
    throw new Error('File is missing an Action/Buy-Sell column.');
  }
  if (quantityCol === undefined && (buyQuantityCol === undefined || sellQuantityCol === undefined)) {
    throw new Error('File is missing a Quantity column.');
  }
  if (priceCol === undefined && (buyPriceCol === undefined || sellPriceCol === undefined) && (buyValueCol === undefined || sellValueCol === undefined)) {
    throw new Error('File is missing a Price column.');
  }

  const existingIds = new Set(existingTransactions.map(t => t.id));
  const existingKeySet = new Set(
    existingTransactions.map(t => `${t.ticker}|${t.action}|${t.quantity}|${t.price}|${t.timestamp || ''}`)
  );

  const validTrades: ImportedTrade[] = [];
  const matchedTrades: ImportedTrade[] = [];
  const unmatchedTrades: ImportedTrade[] = [];
  const duplicateTrades: DuplicateTradeInfo[] = [];
  const rejectedRows: RejectedRowInfo[] = [];

  const rawDataRows = lines.slice(headerIndex + 1);

  rawDataRows.forEach((line, rowIndex) => {
    const rowNumber = headerIndex + rowIndex + 2;
    const cells = splitCsvLine(line);

    const rawStockStr = cells[tickerCol]?.trim() || '';
    const rawIsin = isinCol !== undefined ? cells[isinCol]?.trim() : '';

    // Detect Groww/Broker Subtotals or Section Headers
    const isSubtotalRow = /^(total|subtotal|unrealised|realised|net total|grand total)$/i.test(rawStockStr) ||
      (cells[0] && /^(total|subtotal|unrealised_trades)$/i.test(cells[0].trim()));
    if (isSubtotalRow) {
      rejectedRows.push({
        rowNumber,
        rawLine: line,
        cells,
        reason: 'Subtotal / summary row skipped (not a trade)',
      });
      return;
    }

    if (!rawStockStr && !rawIsin) {
      rejectedRows.push({
        rowNumber,
        rawLine: line,
        cells,
        reason: 'Empty row or missing stock symbol / ISIN',
      });
      return;
    }

    // Resolve stock identity against 2,500+ NSE master list
    const resolved = resolveStockIdentity({
      isin: rawIsin,
      symbol: rawStockStr,
      name: rawStockStr,
    });

    const canonicalTicker = resolved?.symbol || normaliseTicker(rawStockStr);
    const displayName = resolved?.name || rawStockStr;
    const matchSource = resolved?.matchSource || 'fallback';

    const rawBuyQty = buyQuantityCol === undefined ? 0 : numberValue(cells[buyQuantityCol]);
    const rawSellQty = sellQuantityCol === undefined ? 0 : numberValue(cells[sellQuantityCol]);

    // Handle Groww dual-sided Buy & Sell row (Closed position / Capital Gains report)
    const hasBuyRateOrVal = buyPriceCol !== undefined || buyValueCol !== undefined;
    const hasSellRateOrVal = sellPriceCol !== undefined || sellValueCol !== undefined;
    const hasBothBuyAndSell = buyDateCol !== undefined && sellDateCol !== undefined &&
      cells[buyDateCol]?.trim() && cells[sellDateCol]?.trim() &&
      hasBuyRateOrVal && hasSellRateOrVal;

    if (hasBothBuyAndSell) {
      const qty = quantityCol !== undefined ? numberValue(cells[quantityCol]) : (rawBuyQty || rawSellQty);
      const buyRate = buyPriceCol !== undefined
        ? numberValue(cells[buyPriceCol])
        : (buyValueCol !== undefined && qty > 0 ? numberValue(cells[buyValueCol]) / qty : 0);
      const sellRate = sellPriceCol !== undefined
        ? numberValue(cells[sellPriceCol])
        : (sellValueCol !== undefined && qty > 0 ? numberValue(cells[sellValueCol]) / qty : 0);
      const rawBuyDate = cells[buyDateCol]?.trim() || '';
      const rawSellDate = cells[sellDateCol]?.trim() || '';

      if (qty <= 0 || buyRate <= 0 || sellRate <= 0) {
        rejectedRows.push({
          rowNumber,
          rawLine: line,
          cells,
          reason: `Invalid trade metrics (Quantity=${qty}, Buy Price=${buyRate}, Sell Price=${sellRate})`,
        });
        return;
      }

      const parsedBuyDate = parseTradeDate(rawBuyDate);
      const parsedSellDate = parseTradeDate(rawSellDate);

      const buyIso = parsedBuyDate?.isoDate || rawBuyDate;
      const sellIso = parsedSellDate?.isoDate || rawSellDate;
      const pnlVal = reportedPnlCol !== undefined ? numberValue(cells[reportedPnlCol]) : (qty * (sellRate - buyRate));
      const rowCharges = chargesCol !== undefined ? numberValue(cells[chargesCol]) : 0;
      const rowBrokerage = brokerageCol !== undefined ? numberValue(cells[brokerageCol]) : 0;
      const rowTaxes = taxesCol !== undefined ? numberValue(cells[taxesCol]) : (rowCharges > rowBrokerage ? rowCharges - rowBrokerage : rowCharges);
      const rowHoldingDays = holdingDaysCol !== undefined ? numberValue(cells[holdingDaysCol]) : undefined;

      const buyTrade: ImportedTrade = {
        id: `csv-${rowIndex}-${canonicalTicker}-BUY-${qty}-${buyRate}-${buyIso}`,
        timestamp: buyIso,
        ticker: canonicalTicker,
        action: 'BUY',
        quantity: qty,
        price: buyRate,
        brokerage: rowBrokerage > 0 ? rowBrokerage / 2 : 0,
        taxes: rowTaxes > 0 ? rowTaxes / 2 : 0,
        netValue: qty * buyRate,
      };
      if (displayName && displayName !== canonicalTicker && rawStockStr !== canonicalTicker) {
        buyTrade.displayName = displayName;
      }

      const sellTrade: ImportedTrade = {
        id: `csv-${rowIndex}-${canonicalTicker}-SELL-${qty}-${sellRate}-${sellIso}`,
        timestamp: sellIso,
        ticker: canonicalTicker,
        action: 'SELL',
        quantity: qty,
        price: sellRate,
        brokerage: rowBrokerage > 0 ? rowBrokerage / 2 : 0,
        taxes: rowTaxes > 0 ? rowTaxes / 2 : 0,
        netValue: qty * sellRate,
        holdingDays: rowHoldingDays && rowHoldingDays >= 0 ? rowHoldingDays : undefined,
      };
      if (reportedPnlCol !== undefined) sellTrade.reportedPnl = pnlVal;
      if (displayName && displayName !== canonicalTicker && rawStockStr !== canonicalTicker) {
        sellTrade.displayName = displayName;
      }

      // Check duplicates for buy & sell
      for (const trade of [buyTrade, sellTrade]) {
        const tradeKey = `${trade.ticker}|${trade.action}|${trade.quantity}|${trade.price}|${trade.timestamp}`;
        if (existingIds.has(trade.id) || existingKeySet.has(tradeKey)) {
          duplicateTrades.push({
            trade,
            existingId: trade.id,
            reason: `Identical ${trade.action} for ${trade.quantity} shares of ${trade.ticker} already exists in ledger`,
          });
        } else {
          validTrades.push(trade);
          if (resolved) matchedTrades.push(trade);
          else unmatchedTrades.push(trade);
        }
      }
      return;
    }

    // Standard single-trade row (BUY or SELL)
    const side = isHoldingsSnapshot
      ? 'BUY'
      : actionCol === undefined
      ? (rawBuyQty > 0 ? 'BUY' : 'SELL')
      : cells[actionCol]?.toUpperCase();

    const normalizedSide = side === 'B' ? 'BUY' : side === 'S' ? 'SELL' : side;
    if (normalizedSide !== 'BUY' && normalizedSide !== 'SELL') {
      rejectedRows.push({
        rowNumber,
        rawLine: line,
        cells,
        reason: `Unrecognized action/side: "${side || 'blank'}" (Expected BUY or SELL)`,
      });
      return;
    }

    const qty = quantityCol === undefined
      ? (normalizedSide === 'BUY' ? rawBuyQty : rawSellQty)
      : numberValue(cells[quantityCol]);

    const rate = effectivePriceCol === undefined
      ? (buyPriceCol !== undefined && sellPriceCol !== undefined
          ? numberValue(cells[normalizedSide === 'BUY' ? buyPriceCol : sellPriceCol])
          : numberValue(cells[normalizedSide === 'BUY' ? buyValueCol! : sellValueCol!]) / qty)
      : numberValue(cells[effectivePriceCol!]);

    if (!Number.isFinite(qty) || qty <= 0) {
      rejectedRows.push({
        rowNumber,
        rawLine: line,
        cells,
        reason: `Quantity must be greater than 0 (found: ${cells[quantityCol ?? 0] || 'blank'})`,
      });
      return;
    }

    if (!Number.isFinite(rate) || rate <= 0) {
      rejectedRows.push({
        rowNumber,
        rawLine: line,
        cells,
        reason: `Price must be greater than 0 (found: ${cells[priceCol ?? 0] || 'blank'})`,
      });
      return;
    }

    const rawDateStr = (normalizedSide === 'SELL' ? sellDateCol : buyDateCol) !== undefined
      ? cells[(normalizedSide === 'SELL' ? sellDateCol : buyDateCol)!]?.trim()
      : dateCol === undefined ? '' : cells[dateCol]?.trim() || '';

    const parsedDate = parseTradeDate(rawDateStr);
    const timestamp = parsedDate ? parsedDate.isoDate : (rawDateStr || 'Imported snapshot');

    const tradeId = `csv-${rowIndex}-${canonicalTicker}-${normalizedSide}-${qty}-${rate}-${timestamp}`;
    const reportedPnlVal = reportedPnlCol !== undefined ? numberValue(cells[reportedPnlCol]) : undefined;

    const singleRowCharges = chargesCol !== undefined ? numberValue(cells[chargesCol]) : 0;
    const singleRowBrokerage = brokerageCol !== undefined ? numberValue(cells[brokerageCol]) : 0;
    const singleRowTaxes = taxesCol !== undefined ? numberValue(cells[taxesCol]) : singleRowCharges;

    const trade: ImportedTrade = {
      id: tradeId,
      timestamp,
      ticker: canonicalTicker,
      action: normalizedSide,
      quantity: qty,
      price: rate,
      brokerage: singleRowBrokerage,
      taxes: singleRowTaxes,
      netValue: qty * rate,
    };
    if (reportedPnlVal !== undefined) {
      trade.reportedPnl = reportedPnlVal;
    }
    if (displayName && displayName !== canonicalTicker && rawStockStr !== canonicalTicker) {
      trade.displayName = displayName;
    }

    // Check duplicates
    const tradeKey = `${trade.ticker}|${trade.action}|${trade.quantity}|${trade.price}|${trade.timestamp}`;
    if (existingIds.has(trade.id) || existingKeySet.has(tradeKey)) {
      duplicateTrades.push({
        trade,
        existingId: trade.id,
        reason: `Identical ${trade.action} for ${trade.quantity} shares of ${trade.ticker} already exists in ledger`,
      });
    } else {
      validTrades.push(trade);
      if (resolved) matchedTrades.push(trade);
      else unmatchedTrades.push(trade);
    }
  });

  const buyTrades = validTrades.filter(t => t.action === 'BUY');
  const sellTrades = validTrades.filter(t => t.action === 'SELL');
  const totalBuyValue = buyTrades.reduce((sum, t) => sum + t.netValue, 0);
  const totalSellValue = sellTrades.reduce((sum, t) => sum + t.netValue, 0);

  // Estimate realized P&L from valid trades in this import
  let estRealized = 0;
  const tempInventory: Record<string, { qty: number; cost: number }> = {};
  for (const t of validTrades) {
    if (!tempInventory[t.ticker]) tempInventory[t.ticker] = { qty: 0, cost: 0 };
    if (t.action === 'BUY') {
      tempInventory[t.ticker].qty += t.quantity;
      tempInventory[t.ticker].cost += t.netValue;
    } else if (t.action === 'SELL') {
      if (Number.isFinite(t.reportedPnl)) {
        estRealized += t.reportedPnl!;
      } else {
        const avg = tempInventory[t.ticker].qty > 0 ? tempInventory[t.ticker].cost / tempInventory[t.ticker].qty : t.price;
        estRealized += (t.price - avg) * t.quantity;
      }
      tempInventory[t.ticker].qty = Math.max(0, tempInventory[t.ticker].qty - t.quantity);
    }
  }

  return {
    fileName,
    totalRows: rawDataRows.length,
    validTrades,
    matchedTrades,
    unmatchedTrades,
    duplicateTrades,
    rejectedRows,
    summary: {
      totalRows: rawDataRows.length,
      validCount: validTrades.length,
      duplicateCount: duplicateTrades.length,
      rejectedCount: rejectedRows.length,
      buyCount: buyTrades.length,
      sellCount: sellTrades.length,
      totalBuyValue: Math.round(totalBuyValue * 100) / 100,
      totalSellValue: Math.round(totalSellValue * 100) / 100,
      estimatedRealizedPnl: Math.round(estRealized * 100) / 100,
    },
  };
}

/**
 * Backward-compatible wrapper returning only valid imported trades.
 */
export function parsePortfolioCsv(csv: string): ImportedTrade[] {
  const result = analyzePortfolioImport(csv);
  return result.validTrades;
}
