import type { DiscoveryResult } from './types.js';

const USER_AGENT = 'Mozilla/5.0 (compatible; KeyscanCrawler/0.1)';

/**
 * Probe llms.txt at multiple locations (scope root first, then origin root).
 * Returns null if none found or not text.
 */
export async function discoverLlmsTxt(
  seedUrl: string,
  options?: { timeout?: number; scopeRoot?: string }
): Promise<DiscoveryResult | null> {
  const timeout = options?.timeout ?? 10_000;
  const origin = new URL(seedUrl).origin;

  // Build candidates: scope root first (if different from origin), then origin
  const candidates: string[] = [];
  if (options?.scopeRoot && options.scopeRoot !== '*') {
    const scopeBase = options.scopeRoot.endsWith('/') ? options.scopeRoot : options.scopeRoot + '/';
    const scopeLlms = `${scopeBase}llms.txt`;
    if (scopeLlms !== `${origin}/llms.txt`) {
      candidates.push(scopeLlms);
    }
  }
  candidates.push(`${origin}/llms.txt`);

  for (const llmsUrl of candidates) {
    const result = await fetchLlmsTxt(llmsUrl, origin, timeout);
    if (result) return result;
  }

  return null;
}

async function fetchLlmsTxt(llmsUrl: string, origin: string, timeout: number): Promise<DiscoveryResult | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    const res = await fetch(llmsUrl, {
      method: 'GET',
      headers: { 'User-Agent': USER_AGENT },
      redirect: 'follow',
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) return null;

    const contentType = (res.headers.get('content-type') ?? '').toLowerCase();
    if (!contentType.includes('text/')) return null;

    const body = await res.text();
    const urls = parseLlmsTxt(body, origin);

    if (urls.length === 0) return null;

    return {
      source: 'llms-txt',
      urls,
      raw: body,
    };
  } catch {
    return null;
  }
}

/**
 * Parse the body of an llms.txt file, extracting valid HTTP(S) URLs.
 * Lines that are not URLs are ignored.
 * Relative paths are resolved against the origin.
 */
export function parseLlmsTxt(body: string, origin: string): string[] {
  const lines = body.split(/\r?\n/);
  const urls: string[] = [];
  const seen = new Set<string>();

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;

    let resolved: string;
    try {
      if (line.startsWith('http://') || line.startsWith('https://')) {
        resolved = new URL(line).toString();
      } else if (line.startsWith('/')) {
        resolved = new URL(line, origin).toString();
      } else {
        // Skip non-URL lines (titles, descriptions, etc.)
        continue;
      }
    } catch {
      continue;
    }

    if (!seen.has(resolved)) {
      seen.add(resolved);
      urls.push(resolved);
    }
  }

  return urls;
}
