import type { DiscoveryResult } from './types.js';
import { discoverLlmsTxt } from './llms-txt.js';
import { discoverSitemap } from './sitemap.js';
import { discoverMarkdown } from './markdown.js';

export type { DiscoveryResult, DiscoverySource } from './types.js';

export interface DiscoverOptions {
  timeout?: number;
  scopeRoot?: string;
}

/**
 * Run the discovery sequence in order (first-match wins):
 * 1. llms.txt (scope root + origin root)
 * 2. sitemap.xml
 * 3. fallback: the seed URL itself (crawl HTML for links)
 *
 * NOTE: Markdown detection is NOT a discovery source.
 * It's handled per-page during crawl (mdUrl field) and in preflight.
 * A single .md file doesn't give us the list of all pages to crawl.
 */
export async function discover(
  seedUrl: string,
  options?: DiscoverOptions
): Promise<DiscoveryResult> {
  const timeout = options?.timeout ?? 10_000;

  // 1. llms.txt (probe scope root first, then origin)
  const llms = await discoverLlmsTxt(seedUrl, { timeout, scopeRoot: options?.scopeRoot });
  if (llms) return llms;

  // 2. sitemap.xml
  const sitemap = await discoverSitemap(seedUrl, { timeout });
  if (sitemap) return sitemap;

  // 3. fallback — crawl from the seed URL
  return {
    source: 'http-fallback',
    urls: [seedUrl],
  };
}
