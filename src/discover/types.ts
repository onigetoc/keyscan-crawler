export type DiscoverySource = 'llms-txt' | 'sitemap' | 'markdown' | 'http-fallback';

export interface DiscoveryResult {
  source: DiscoverySource;
  urls: string[];
  raw?: string;
}
