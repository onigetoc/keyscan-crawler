import type { DiscoveryResult } from './types.js';

const USER_AGENT = 'Mozilla/5.0 (compatible; KeyscanCrawler/0.1)';
const MAX_SITEMAPS = 10; // Limit recursive sitemap index fetches

/**
 * Fetch and parse sitemap.xml from the origin.
 * Handles sitemap index files (recursive fetch of child sitemaps).
 * Returns null if sitemap doesn't exist or yields no URLs.
 */
export async function discoverSitemap(
  seedUrl: string,
  options?: { timeout?: number }
): Promise<DiscoveryResult | null> {
  const timeout = options?.timeout ?? 10_000;
  const origin = new URL(seedUrl).origin;
  const sitemapUrl = `${origin}/sitemap.xml`;

  try {
    const urls = await fetchSitemap(sitemapUrl, timeout, 0);
    if (urls.length === 0) return null;

    return {
      source: 'sitemap',
      urls: [...new Set(urls)], // deduplicate
    };
  } catch {
    return null;
  }
}

/**
 * Fetch a single sitemap URL and extract <loc> entries.
 * If it's a sitemap index, recursively fetches child sitemaps.
 */
async function fetchSitemap(url: string, timeout: number, depth: number): Promise<string[]> {
  if (depth > MAX_SITEMAPS) return [];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  let body: string;
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'User-Agent': USER_AGENT },
      redirect: 'follow',
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) return [];

    const ct = (res.headers.get('content-type') ?? '').toLowerCase();
    if (!ct.includes('xml') && !ct.includes('text/')) return [];

    body = await res.text();
  } catch {
    clearTimeout(timer);
    return [];
  }

  // Check if this is a sitemap index
  if (isSitemapIndex(body)) {
    return parseSitemapIndex(body, timeout, depth);
  }

  return parseSitemapUrls(body);
}

/**
 * Detect if the XML is a sitemap index (contains <sitemapindex>).
 */
function isSitemapIndex(xml: string): boolean {
  return xml.includes('<sitemapindex');
}

/**
 * Parse a sitemap index: extract child sitemap URLs from <loc> inside <sitemap>,
 * then recursively fetch each child.
 */
async function parseSitemapIndex(xml: string, timeout: number, depth: number): Promise<string[]> {
  const childUrls = extractLocs(xml);
  const allUrls: string[] = [];

  for (const childUrl of childUrls.slice(0, MAX_SITEMAPS)) {
    const urls = await fetchSitemap(childUrl, timeout, depth + 1);
    allUrls.push(...urls);
  }

  return allUrls;
}

/**
 * Parse a regular sitemap: extract all <loc> URLs.
 */
export function parseSitemapUrls(xml: string): string[] {
  return extractLocs(xml);
}

/**
 * Extract all content from <loc>...</loc> tags via regex.
 * Simple and effective for sitemap XML — no need for a full parser.
 */
function extractLocs(xml: string): string[] {
  const urls: string[] = [];
  const regex = /<loc>\s*(.*?)\s*<\/loc>/gi;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(xml)) !== null) {
    const url = match[1].trim();
    if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
      urls.push(url);
    }
  }

  return urls;
}
