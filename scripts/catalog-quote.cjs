// Export a timestamped snapshot only when its identity and provider evidence agree.
module.exports.catalogQuote = function catalogQuote(row, ticker) {
  const valid = row && row.providerSymbol === ticker && row.currency === 'INR' && row.dataSource === 'provider' &&
    !row.isFallback && Number.isFinite(row.price) && row.price > 0 &&
    Number.isFinite(row.change) && Number.isFinite(row.changePercent) &&
    Number.isFinite(Date.parse(row.quoteAsOf)) && Date.parse(row.quoteAsOf) <= Date.now() + 30000;
  return {
    price: valid ? row.price : 0, currentPrice: valid ? row.price : null,
    change: valid ? row.change : 0, changePercent: valid ? row.changePercent : 0,
    quoteAsOf: valid ? row.quoteAsOf : null, fetchedAt: valid ? row.fetchedAt : null,
    providerSymbol: valid ? row.providerSymbol : null, currency: valid ? 'INR' : null,
    dataSource: valid ? 'provider' : 'unavailable', quoteStatus: valid ? 'historical' : 'unavailable',
    isPriceVerified: !!valid, isFallback: !valid,
  };
};
