import { normalizePredictionTicker } from './prediction-ai';
import { normalizeSearchEvidence, normalizeXEvidence, type DiscoveryCategory } from './prediction-discovery';
import type { PredictionDiscovery } from './prediction-ai-types';

const credential = (value?: string) => value?.trim() && !/^(YOUR_|MY_|your[-_])/i.test(value.trim()) ? value.trim() : '';
type Config = { braveKey?: string; xToken?: string };
type Channel = { sources: PredictionDiscovery['sources']; coverage: PredictionDiscovery['coverage'][number] };

export async function fetchPredictionDiscovery(input: string, fetcher: typeof fetch = fetch,
  config: Config = { braveKey: process.env.BRAVE_SEARCH_API_KEY, xToken: process.env.X_BEARER_TOKEN }): Promise<PredictionDiscovery> {
  const ticker = normalizePredictionTicker(input);
  const braveKey = credential(config.braveKey), xToken = credential(config.xToken);
  const search = async (category: DiscoveryCategory): Promise<Channel> => {
    const missing = { category, status: 'unavailable' as const };
    if (!braveKey) return { sources: [], coverage: { ...missing, detail: 'Web search is not configured. Set BRAVE_SEARCH_API_KEY on the server.' } };
    const site = category === 'instagram' ? 'site:instagram.com' : category === 'x' ? '(site:x.com OR site:twitter.com)' : '-site:x.com -site:twitter.com -site:instagram.com';
    const url = new URL('https://api.search.brave.com/res/v1/web/search');
    url.search = new URLSearchParams({ q: `"${ticker}" (NSE OR stock OR shares OR earnings) ${site}`, count: '10',
      freshness: 'pm', country: 'IN', text_decorations: 'false', spellcheck: 'false' }).toString();
    try {
      const response = await fetcher(url.href, { headers: { Accept: 'application/json', 'X-Subscription-Token': braveKey },
        signal: AbortSignal.timeout(6000), redirect: 'error', cache: 'no-store' });
      if (!response.ok) throw new Error('Search unavailable');
      const body = await response.json();
      if (!Array.isArray(body?.web?.results)) return { sources: [], coverage: { ...missing, detail: 'Search returned no usable result set. Coverage is unknown.' } };
      const sources = normalizeSearchEvidence(ticker, category, body);
      return { sources, coverage: { category, status: sources.length ? 'available' : 'unavailable', detail: sources.length
        ? 'Public search excerpts only; original publication dates and claims are unverified.'
        : 'No matching public excerpts were returned. This does not mean no discussion exists.' } };
    } catch {
      return { sources: [], coverage: { ...missing, detail: 'Web search failed, timed out or reached its quota. Retry or check the server credentials.' } };
    }
  };

  const directX = async (): Promise<Channel | null> => {
    if (!xToken) return null;
    const url = new URL('https://api.x.com/2/tweets/search/recent');
    url.search = new URLSearchParams({ query: `"${ticker}" (NSE OR stock OR shares OR earnings) -is:retweet`, max_results: '10',
      'tweet.fields': 'created_at,author_id,referenced_tweets', expansions: 'author_id', 'user.fields': 'username' }).toString();
    try {
      const response = await fetcher(url.href, { headers: { Authorization: `Bearer ${xToken}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(6000), redirect: 'error', cache: 'no-store' });
      if (!response.ok) return null;
      const body = await response.json();
      if (body?.errors?.length || (!Array.isArray(body?.data) && body?.meta?.result_count !== 0)) return null;
      const sources = normalizeXEvidence(ticker, body);
      return { sources, coverage: { category: 'x', status: sources.length ? 'available' : 'unavailable', detail: sources.length
        ? 'Public posts from X recent search; claims and author identities are not independently verified.'
        : 'X search returned no matching usable posts in the last seven days. Discussion may still exist.' } };
    } catch { return null; }
  };

  // Three bounded search requests, issued sequentially to reduce bursts against search quotas.
  // Direct X runs alongside them; search fallback remains explicitly labelled as excerpts.
  const [indexed, direct] = await Promise.all([
    (async () => { const results: Channel[] = []; for (const category of ['web', 'instagram'] as const) results.push(await search(category)); return results; })(),
    directX(),
  ]);
  const fallback = direct?.sources.length ? null : await search('x');
  const channels = [...indexed, direct?.sources.length ? direct : fallback?.sources.length ? fallback : direct ?? fallback!];
  if (!direct && xToken) channels[2].coverage.detail = `Direct X search failed or was denied. ${channels[2].coverage.detail}`;
  if (!xToken && !braveKey) channels[2].coverage.detail = 'X is not configured. Set X_BEARER_TOKEN for direct search or BRAVE_SEARCH_API_KEY for indexed excerpts.';
  return { sources: channels.flatMap(channel => channel.sources), coverage: channels.map(channel => channel.coverage), limitations: [
    'Web and social coverage is a small relevance-filtered sample, not exhaustive monitoring. Instagram access is limited to publicly indexed post/reel excerpts; private content, stories, comments and video/audio are not read.',
    'Search freshness uses page publication or modification dates, which may differ from the original post date. Undated excerpts cannot establish a current event.',
    'Social posts and search excerpts are unverified claims. Reposts, coordinated promotions and popularity are not independent evidence or proof of future returns. Corroborate material claims with filings or attributable reporting.',
  ] };
}
