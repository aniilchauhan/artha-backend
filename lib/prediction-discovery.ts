import { createHash } from 'node:crypto';
import type { PredictionAiContext, PredictionDiscovery, PredictionEvidence } from './prediction-ai-types';

export type DiscoveryCategory = 'web' | 'x' | 'instagram';
const DAY = 86_400_000;
const clean = (value: unknown, limit = 1000): string => typeof value === 'string'
  ? value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit) : '';
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function relatedToStock(text: string, ticker: string): boolean {
  // Tickers can be ordinary words (IDEA, IT). Require market context as well.
  return new RegExp(`(^|[^A-Z0-9])${escape(ticker)}([^A-Z0-9]|$)`, 'i').test(text) &&
    /\b(NSE|BSE|Nifty|stock|stocks|share|shares|earnings|results|dividend|investor|equity)\b/i.test(text);
}

export function discoveryUrl(raw: unknown, category: DiscoveryCategory): string | null {
  try {
    if (typeof raw !== 'string' || raw.length > 2000) return null;
    const url = new URL(raw);
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    if (url.protocol !== 'https:' || url.username || url.password || url.port ||
      !host.includes('.') || /(^|\.)(localhost|local|internal|test|invalid)$/.test(host) ||
      /^[\d.]+$/.test(host) || host.includes(':')) return null;
    if (category === 'x') {
      if (!['x.com', 'twitter.com', 'mobile.twitter.com'].includes(host)) return null;
      const post = url.pathname.match(/^\/(?:[a-zA-Z0-9_]{1,15}|i\/web)\/status\/(\d+)\/?$/);
      return post ? `https://x.com/i/web/status/${post[1]}` : null;
    }
    if (category === 'instagram') {
      if (host !== 'instagram.com') return null;
      const post = url.pathname.match(/^\/(p|reel|tv)\/([A-Za-z0-9_-]+)\/?$/);
      return post ? `https://www.instagram.com/${post[1]}/${post[2]}/` : null;
    }
    // Platform posts must retain their social label, even when returned in general search.
    if (['x.com', 'twitter.com', 'mobile.twitter.com', 'instagram.com'].includes(host)) return null;
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$)/i.test(key)) url.searchParams.delete(key);
    return url.href;
  } catch { return null; }
}

function uniqueSources(items: PredictionEvidence[], limit: number): PredictionEvidence[] {
  const urls = new Set<string>(), texts = new Set<string>();
  return items.filter(item => {
    const fingerprint = String(item.value).toLowerCase().replace(/https?:\/\/\S+/g, '').replace(/[^a-z0-9]/g, '');
    if (urls.has(item.url) || texts.has(fingerprint)) return false;
    urls.add(item.url); texts.add(fingerprint); return true;
  }).slice(0, limit);
}

export function normalizeSearchEvidence(ticker: string, category: DiscoveryCategory, payload: any, now = Date.now()): PredictionEvidence[] {
  if (!Array.isArray(payload?.web?.results)) return [];
  const items: PredictionEvidence[] = [];
  for (const result of payload.web.results.slice(0, 20)) {
    const url = discoveryUrl(result?.url, category);
    const title = clean(result?.title, 240), description = clean(result?.description, 700);
    const value = `${title}: ${description}`;
    if (!url || !title || !description || !relatedToStock(value, ticker)) continue;
    // Page age may reflect an edit, not publication. Never turn retrieval/page age into a post date.
    const pageDate = typeof result.page_age === 'string' ? Date.parse(result.page_age) : NaN;
    if (Number.isFinite(pageDate) && (pageDate > now || now - pageDate > 31 * DAY)) continue;
    items.push({ id: `${category}.${createHash('sha256').update(url).digest('hex').slice(0, 12)}`,
      category, label: category === 'web' ? 'Web search excerpt' : `${category === 'x' ? 'X' : 'Instagram'} indexed public post excerpt`,
      value, unit: null, source: `${new URL(url).hostname} via Brave Search`, url,
      asOf: null, retrievedAt: new Date(now).toISOString(), contentType: 'search_excerpt', verification: 'unverified' });
  }
  return uniqueSources(items, category === 'web' ? 4 : 3);
}

export function normalizeXEvidence(ticker: string, payload: any, now = Date.now()): PredictionEvidence[] {
  if (!Array.isArray(payload?.data)) return [];
  const items: PredictionEvidence[] = [];
  for (const post of payload.data.slice(0, 20)) {
    const value = clean(post?.text);
    const created = typeof post?.created_at === 'string' ? Date.parse(post.created_at) : NaN;
    if (typeof post?.id !== 'string' || !/^\d+$/.test(post.id) || !relatedToStock(value, ticker) ||
      !Number.isFinite(created) || created > now || now - created > 7 * DAY ||
      (Array.isArray(post.referenced_tweets) && post.referenced_tweets.some((ref: any) => ref?.type === 'retweeted'))) continue;
    const author = Array.isArray(payload.includes?.users) ? payload.includes.users.find((user: any) => user.id === post.author_id) : null;
    const handle = typeof author?.username === 'string' && /^[a-zA-Z0-9_]{1,15}$/.test(author.username) ? ` @${author.username}` : '';
    items.push({ id: `x.${post.id}`, category: 'x', label: 'Public X post', value, unit: null,
      source: `X${handle} via X API`, url: `https://x.com/i/web/status/${post.id}`, asOf: new Date(created).toISOString(),
      retrievedAt: new Date(now).toISOString(), contentType: 'social_post', verification: 'unverified' });
  }
  return uniqueSources(items, 3);
}

export function attachPredictionDiscovery(context: PredictionAiContext, discovery?: PredictionDiscovery): PredictionAiContext {
  if (!discovery) return context;
  const existing = context.sources ?? [];
  const existingUrls = new Set(existing.map(source => source.url));
  const sources = [...existing, ...uniqueSources(discovery.sources, 10).filter(source => !existingUrls.has(source.url))];
  return { ...context, sources, coverage: [...(context.coverage ?? []), ...discovery.coverage],
    limitations: [...context.limitations, ...discovery.limitations] };
}
