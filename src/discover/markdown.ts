import type { DiscoveryResult } from './types.js';

const USER_AGENT = 'Mozilla/5.0 (compatible; KeyscanCrawler/0.1)';

const ERROR_PHRASES = [
  "this page doesn't exist",
  'page not found',
  "doesn't exist",
  'no such file',
];

/**
 * Probe for markdown files at well-known paths relative to the seed URL:
 * - seed.md (the URL itself with .md appended)
 * - index.md (in the seed's directory)
 * - README.md (in the seed's directory)
 *
 * Returns the first valid markdown URL found, or null.
 */
export async function discoverMarkdown(
  seedUrl: string,
  options?: { timeout?: number }
): Promise<DiscoveryResult | null> {
  const timeout = options?.timeout ?? 10_000;
  const url = new URL(seedUrl);

  // Build candidate URLs
  const candidates = buildCandidates(url);

  for (const candidate of candidates) {
    const result = await probeMarkdownUrl(candidate, timeout);
    if (result) {
      return {
        source: 'markdown',
        urls: [candidate],
      };
    }
  }

  return null;
}

/**
 * Build the list of candidate markdown URLs to probe.
 */
function buildCandidates(url: URL): string[] {
  const candidates: string[] = [];
  const base = url.origin + url.pathname;

  // 1. seed.md — append .md to the path (strip trailing slash first)
  const cleanBase = base.endsWith('/') ? base.slice(0, -1) : base;
  if (cleanBase !== url.origin) {
    candidates.push(`${cleanBase}.md`);
  }

  // 2. index.md in the directory
  const dir = getDirectory(url);
  candidates.push(`${dir}index.md`);

  // 3. README.md in the directory
  candidates.push(`${dir}README.md`);

  // Deduplicate
  return [...new Set(candidates)];
}

/**
 * Get the directory portion of a URL (everything up to and including last /).
 */
function getDirectory(url: URL): string {
  const path = url.pathname;
  const lastSlash = path.lastIndexOf('/');
  const dir = lastSlash >= 0 ? path.slice(0, lastSlash + 1) : '/';
  return url.origin + dir;
}

/**
 * Probe a single markdown URL. Returns true if it's valid markdown (not a soft-404).
 */
async function probeMarkdownUrl(url: string, timeout: number): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    const res = await fetch(url, {
      method: 'GET',
      headers: { 'User-Agent': USER_AGENT },
      redirect: 'follow',
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) return false;

    const ct = (res.headers.get('content-type') ?? '').toLowerCase();
    const body = await res.text();
    const preview = body.slice(0, 2000).toLowerCase();

    // Check for soft-404
    const isHtml = ct.includes('text/html') || preview.startsWith('<!doctype') || preview.startsWith('<html');
    if (isHtml) {
      // HTML response — check for error phrases (soft 404)
      const hasSoftError = ERROR_PHRASES.some(p => preview.includes(p));
      if (hasSoftError) return false;
      // Even without error phrases, HTML is not markdown
      return false;
    }

    // Accept text/markdown or text/plain
    if (ct.includes('text/markdown') || ct.includes('text/plain')) {
      return true;
    }

    // Unknown content type but not HTML — could be markdown served without proper type
    if (!isHtml && body.length > 0) {
      return true;
    }

    return false;
  } catch {
    return false;
  }
}
