import { access, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { CrawledUrl } from '../crawler/types.js';
import { domainFolder, docFilename } from '../utils/url.js';

export interface DownloadOptions {
  timeout?: number;
  rateLimit?: number;
  signal?: AbortSignal;
}

export interface DownloadResult {
  rootDir: string;
  downloaded: Array<{ url: string; file: string }>;
  skipped: Array<{ url: string; file: string; reason: 'exists' | 'no-markdown' }>;
  failed: Array<{ url: string; error: string }>;
}

const DEFAULT_TIMEOUT = 10_000;
const USER_AGENT = 'Mozilla/5.0 (compatible; KeyscanCrawler/0.1)';

/**
 * Download the markdown version of every crawled URL that has one and
 * write it to `<rootDir>/<domain>/<page>.md`. Existing files are skipped.
 */
export async function downloadMarkdown(
  entries: CrawledUrl[],
  rootDir: string,
  options?: DownloadOptions
): Promise<DownloadResult> {
  const timeout = options?.timeout ?? DEFAULT_TIMEOUT;
  const rateLimit = options?.rateLimit ?? 0;
  const result: DownloadResult = { rootDir, downloaded: [], skipped: [], failed: [] };

  for (const entry of entries) {
    if (options?.signal?.aborted) break;

    const source = sourceUrl(entry);
    if (!source) {
      result.skipped.push({ url: entry.url, file: '', reason: 'no-markdown' });
      continue;
    }

    const file = join(rootDir, domainFolder(entry.url), docFilename(entry.url));

    if (await fileExists(file)) {
      result.skipped.push({ url: entry.url, file, reason: 'exists' });
      continue;
    }

    try {
      const body = await fetchMarkdown(source, timeout);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, body, 'utf-8');
      result.downloaded.push({ url: entry.url, file });
    } catch (err) {
      result.failed.push({
        url: entry.url,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    if (rateLimit > 0) {
      await sleep(rateLimit);
    }
  }

  return result;
}

/**
 * Which URL to fetch markdown from: the detected .md alternative,
 * or the URL itself if it's already markdown.
 */
function sourceUrl(entry: CrawledUrl): string | null {
  if (entry.mdUrl) return entry.mdUrl;
  const lower = entry.url.toLowerCase();
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) return entry.url;
  return null;
}

async function fetchMarkdown(url: string, timeout: number): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'User-Agent': USER_AGENT },
      redirect: 'follow',
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
