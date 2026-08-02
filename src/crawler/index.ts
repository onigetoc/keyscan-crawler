import { parseHTML } from 'linkedom';
import { createScopeFilter } from './scope.js';
import type { CrawlOptions, CrawlResult, CrawledUrl, IgnoredUrl } from './types.js';

export type { CrawlOptions, CrawlResult, CrawledUrl, IgnoredUrl } from './types.js';

const USER_AGENT = 'Mozilla/5.0 (compatible; KeyscanCrawler/0.1)';
const DEFAULT_MAX_URLS = 500;
const DEFAULT_TIMEOUT = 10_000;
const DEFAULT_RATE_LIMIT = 200; // ms

/**
 * BFS crawler with scope filtering, depth limiting, and rate limiting.
 * Uses linkedom for link extraction from HTML pages.
 */
export async function crawl(
  startUrls: string[],
  options: CrawlOptions
): Promise<CrawlResult> {
  const {
    seed,
    scope,
    scopeRoot,
    maxDepth,
    maxUrls = DEFAULT_MAX_URLS,
    timeout = DEFAULT_TIMEOUT,
    rateLimit = DEFAULT_RATE_LIMIT,
    retries = 1,
    probeMd = false,
    signal,
  } = options;

  const isInScope = createScopeFilter(seed, scope, scopeRoot);
  const visited = new Set<string>();
  const accepted: CrawledUrl[] = [];
  const ignored: IgnoredUrl[] = [];
  const start = Date.now();

  // BFS queue: [url, depth, foundAt]
  const queue: Array<[string, number, string]> = [];

  // Seed the queue
  for (const url of startUrls) {
    const normalized = normalizeUrl(url);
    if (normalized && !visited.has(normalized)) {
      visited.add(normalized);
      queue.push([normalized, 0, seed]);
    }
  }

  while (queue.length > 0) {
    // Check abort signal
    if (signal?.aborted) break;

    // Check max URLs limit
    if (accepted.length >= maxUrls) {
      // Mark remaining queue items as ignored
      for (const [url, , foundAt] of queue) {
        ignored.push({ url, reason: 'max-urls', foundAt });
      }
      queue.length = 0;
      break;
    }

    const [url, depth, foundAt] = queue.shift()!;

    // Scope check
    if (!isInScope(url)) {
      ignored.push({ url, reason: 'out-of-scope', foundAt });
      continue;
    }

    // Depth check
    if (depth > maxDepth) {
      ignored.push({ url, reason: 'max-depth', foundAt });
      continue;
    }

    // Rate limiting
    if (rateLimit > 0) {
      await sleep(rateLimit);
    }

    // Fetch the page (with retry)
    let status: number = 0;
    let contentType: string | null = null;
    let body: string | null = null;
    let finalUrl: string | undefined;
    let redirectedFrom: string | undefined;
    let success = false;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeout);

        // Combine with external signal
        const onAbort = () => controller.abort();
        signal?.addEventListener('abort', onAbort, { once: true });

        const res = await fetch(url, {
          method: 'GET',
          headers: { 'User-Agent': USER_AGENT },
          redirect: 'follow',
          signal: controller.signal,
        });
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);

        status = res.status;
        contentType = res.headers.get('content-type');

        // Track redirects
        if (res.redirected && res.url !== url) {
          redirectedFrom = url;
          finalUrl = res.url;
        }

        if (res.ok && isHtml(contentType)) {
          body = await res.text();
        }

        success = true;
        break;
      } catch {
        if (attempt < retries) {
          // Wait briefly before retry
          await sleep(Math.min(rateLimit, 500) || 100);
          continue;
        }
        // All retries exhausted
      }
    }

    if (!success) {
      ignored.push({ url, reason: 'error', foundAt });
      continue;
    }

    // Non-HTML is accepted but not crawled for links
    if (!isHtml(contentType)) {
      accepted.push({ url, depth, status, contentType, links: 0, redirectedFrom, finalUrl });
      continue;
    }

    // Extract links from HTML
    const links = body ? extractLinks(body, url) : [];

    // Probe .md alternative if enabled
    let mdUrl: string | undefined;
    if (probeMd) {
      mdUrl = await probeMdUrl(url, timeout);
    }

    accepted.push({ url, depth, status, contentType, links: links.length, mdUrl, redirectedFrom, finalUrl });

    // Add discovered links to queue
    for (const link of links) {
      const normalized = normalizeUrl(link);
      if (!normalized) continue;
      if (visited.has(normalized)) continue;
      visited.add(normalized);
      queue.push([normalized, depth + 1, url]);
    }
  }

  return {
    accepted,
    ignored,
    visited: visited.size,
    duration: Date.now() - start,
  };
}

/**
 * Extract all href links from an HTML document using linkedom.
 * Returns absolute URLs only.
 */
export function extractLinks(html: string, baseUrl: string): string[] {
  const { document } = parseHTML(html);
  const anchors = document.querySelectorAll('a[href]');
  const links: string[] = [];

  for (const anchor of anchors) {
    const href = anchor.getAttribute('href');
    if (!href) continue;

    // Skip fragments, javascript:, mailto:, tel:
    if (href.startsWith('#') || href.startsWith('javascript:') ||
        href.startsWith('mailto:') || href.startsWith('tel:')) {
      continue;
    }

    try {
      const absolute = new URL(href, baseUrl).toString();
      // Only HTTP(S)
      if (absolute.startsWith('http://') || absolute.startsWith('https://')) {
        links.push(absolute);
      }
    } catch {
      // Invalid URL, skip
    }
  }

  return links;
}

/**
 * Normalize a URL for dedup: strip fragment, normalize trailing slash.
 */
function normalizeUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return null;
  }
}

function isHtml(contentType: string | null): boolean {
  return (contentType ?? '').toLowerCase().includes('text/html');
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const MD_ERROR_PHRASES = [
  "this page doesn't exist",
  'page not found',
  "doesn't exist",
  'no such file',
];

/**
 * Probe if a .md version of a URL exists.
 * Returns the .md URL if valid, undefined otherwise.
 */
async function probeMdUrl(url: string, timeout: number): Promise<string | undefined> {
  const mdUrl = url.endsWith('/') ? `${url.slice(0, -1)}.md` : `${url}.md`;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const res = await fetch(mdUrl, {
      method: 'GET',
      headers: { 'User-Agent': USER_AGENT },
      redirect: 'follow',
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) return undefined;

    const ct = (res.headers.get('content-type') ?? '').toLowerCase();
    const body = await res.text();
    const preview = body.slice(0, 2000).toLowerCase();

    // Reject HTML soft-404
    const isHtmlResp = ct.includes('text/html') || preview.startsWith('<!doctype') || preview.startsWith('<html');
    if (isHtmlResp) {
      if (MD_ERROR_PHRASES.some(p => preview.includes(p))) return undefined;
      return undefined; // HTML is not markdown
    }

    // Accept text/markdown or text/plain with content
    if (body.length > 0) return mdUrl;
    return undefined;
  } catch {
    return undefined;
  }
}
