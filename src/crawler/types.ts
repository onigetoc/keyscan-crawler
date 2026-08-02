import type { ScopeMode } from '../utils/url.js';

export interface CrawlOptions {
  seed: string;
  scope: ScopeMode;
  scopeRoot?: string;
  maxDepth: number;
  maxUrls?: number;
  timeout?: number;
  rateLimit?: number;
  retries?: number;
  probeMd?: boolean; // probe .md alternative for each HTML page
  signal?: AbortSignal;
}

export interface CrawlResult {
  accepted: CrawledUrl[];
  ignored: IgnoredUrl[];
  visited: number;
  duration: number;
}

export interface CrawledUrl {
  url: string;
  depth: number;
  status: number;
  contentType: string | null;
  links: number;
  mdUrl?: string; // markdown alternative URL if detected
  redirectedFrom?: string;
  finalUrl?: string;
}

export interface IgnoredUrl {
  url: string;
  reason: IgnoreReason;
  foundAt: string;
}

export type IgnoreReason = 'out-of-scope' | 'max-depth' | 'already-visited' | 'non-html' | 'error' | 'max-urls';
