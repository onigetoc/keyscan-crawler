import { parseArgs } from 'node:util';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { preflight } from './check/index.js';
import { discover } from './discover/index.js';
import { crawl } from './crawler/index.js';
import { extractLinks } from './crawler/index.js';
import { downloadMarkdown } from './download/index.js';
import { isInsideScope, detectScopeRoot } from './utils/url.js';
import type { ScopeMode } from './utils/url.js';
import type { CrawlResult } from './crawler/types.js';
import type { CheckResult } from './check/types.js';
import type { DiscoveryResult } from './discover/types.js';
import type { DownloadResult } from './download/index.js';

export interface CliOptions {
  url: string;
  scope: ScopeMode;
  depth: number;
  output?: string;
  json: boolean;
  noIgnored: boolean;
  noDiscovery: boolean;
  maxUrls: number;
  timeout: number;
  rateLimit: number;
  download?: string;
}

export interface CrawlOutput {
  version: string;
  seed: string;
  timestamp: string;
  metadata: {
    scope: ScopeMode;
    scopeRoot?: string;
    maxDepth: number;
    maxUrls: number;
    timeout: number;
    duration: number;
    discoveryTotal: number;
    discoveryInScope: number;
  };
  preflight: CheckResult;
  discovery: DiscoveryResult;
  crawl: {
    visited: number;
    accepted: number;
    ignored: number;
    duration: number;
  };
  urls: CrawlResult['accepted'];
  ignored: CrawlResult['ignored'];
}

const VALID_SCOPES: ScopeMode[] = ['dir', 'parent', 'domain', 'subdomain', 'external'];

export function parseCliArgs(argv: string[]): CliOptions {
  const { rest, download } = extractDownload(argv);
  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: {
      scope: { type: 'string', short: 's', default: 'dir' },
      depth: { type: 'string', short: 'd', default: '3' },
      output: { type: 'string', short: 'o' },
      json: { type: 'boolean', short: 'j', default: false },
      'max-urls': { type: 'string', default: '500' },
      timeout: { type: 'string', default: '10000' },
      'rate-limit': { type: 'string', default: '200' },
      'no-ignored': { type: 'boolean', default: false },
      'no-discovery': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });

  if (values.help || positionals.length === 0) {
    printUsage();
    process.exit(0);
  }

  const url = positionals[0];
  const scope = values.scope as ScopeMode;

  if (!VALID_SCOPES.includes(scope)) {
    console.error(`Invalid scope: "${scope}". Valid: ${VALID_SCOPES.join(', ')}`);
    process.exit(1);
  }

  return {
    url,
    scope,
    depth: parseInt(values.depth as string, 10),
    output: values.output as string | undefined,
    json: values.json as boolean,
    noIgnored: values['no-ignored'] as boolean,
    noDiscovery: values['no-discovery'] as boolean,
    maxUrls: parseInt(values['max-urls'] as string, 10),
    timeout: parseInt(values.timeout as string, 10),
    rateLimit: parseInt(values['rate-limit'] as string, 10),
    download,
  };
}

const DOWNLOAD_FLAGS = new Set(['--download', '-D']);

/**
 * Extract the `--download` / `-dw` flag (with optional folder value)
 * before parseArgs, since it takes an optional argument.
 * With no value it defaults to `docs`.
 */
function extractDownload(argv: string[]): { rest: string[]; download?: string } {
  const rest: string[] = [];
  let download: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (DOWNLOAD_FLAGS.has(arg)) {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('-')) {
        download = next;
        i++;
      } else {
        download = 'docs';
      }
      continue;
    }
    rest.push(arg);
  }

  return { rest, download };
}

function printUsage(): void {
  console.log(`
keyscan-crawl - URL crawler with preflight check and discovery

Usage:
  keyscan-crawl <URL> [options]

Options:
  -s, --scope <mode>     Scope: dir|parent|domain|subdomain|external (default: dir)
  -d, --depth <n>        Max crawl depth (default: 3)
  -o, --output <file>    Write JSON output to file
  -j, --json             Print JSON to stdout
  --max-urls <n>         Maximum URLs to crawl (default: 500)
  --no-ignored           Omit ignored URLs from output
  --no-discovery         Skip discovery (llms.txt/sitemap/markdown), crawl from seed directly
  -D, --download [dir]  Download markdown versions of crawled pages to dir (default: docs)
  --timeout <ms>         Request timeout in ms (default: 10000)
  --rate-limit <ms>      Delay between requests in ms (default: 200)
  -h, --help             Show this help
`);
}

/**
 * Main pipeline: check → detect scope → discover → crawl → output
 */
export async function run(options: CliOptions, signal?: AbortSignal): Promise<CrawlOutput> {
  const start = Date.now();

  // 1. Preflight check
  const checkResult = await preflight(options.url, { timeout: options.timeout });

  if (!checkResult.accessible) {
    console.error(`Preflight failed: ${checkResult.status} ${checkResult.statusText}`);
    // Still produce output even if seed is inaccessible
  }

  // 2. Smart scope detection for 'dir' mode
  //    Fetch seed page links to determine if seed is a directory or a file
  let scopeRoot: string | undefined;
  if (options.scope === 'dir' && checkResult.accessible) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), options.timeout);
      const res = await fetch(options.url, {
        method: 'GET',
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; KeyscanCrawler/0.1)' },
        redirect: 'follow',
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (res.ok) {
        const html = await res.text();
        const links = extractLinks(html, options.url);
        scopeRoot = detectScopeRoot(options.url, links);
      }
    } catch {
      // Fall back to default dir behavior
    }
  }

  // 3. Discovery
  let discoveryResult: DiscoveryResult;
  if (options.noDiscovery) {
    discoveryResult = { source: 'http-fallback', urls: [options.url] };
  } else {
    discoveryResult = await discover(options.url, { timeout: options.timeout, scopeRoot });
  }

  // Filter discovery URLs by scope to avoid feeding irrelevant URLs to crawler
  const scopedUrls = discoveryResult.urls.filter(u => isInsideScope(u, options.url, options.scope, scopeRoot));
  let startUrls = scopedUrls.length > 0 ? scopedUrls : [options.url];

  // If seed is a file (not a directory), also crawl the scope root page
  // to discover sibling pages via its navigation links
  if (scopeRoot && options.scope === 'dir') {
    const seedAsDir = options.url.endsWith('/') ? options.url : options.url + '/';
    const seedIsFile = scopeRoot !== seedAsDir;
    if (seedIsFile && !startUrls.includes(scopeRoot)) {
      // Add scope root (the dir page) as a start URL so we can find siblings
      startUrls = [options.url, scopeRoot.endsWith('/') ? scopeRoot.slice(0, -1) : scopeRoot, ...startUrls.filter(u => u !== options.url)];
    }
  }

  // 4. Crawl
  const crawlResult = await crawl(startUrls, {
    seed: options.url,
    scope: options.scope,
    scopeRoot,
    maxDepth: options.depth,
    maxUrls: options.maxUrls,
    timeout: options.timeout,
    rateLimit: options.rateLimit,
    probeMd: checkResult.markdownAlternative?.exists ?? false,
    signal,
  });

  const duration = Date.now() - start;

  // 4. Build output
  const output: CrawlOutput = {
    version: '0.1.0',
    seed: options.url,
    timestamp: new Date().toISOString(),
    metadata: {
      scope: options.scope,
      scopeRoot,
      maxDepth: options.depth,
      maxUrls: options.maxUrls,
      timeout: options.timeout,
      duration,
      discoveryTotal: discoveryResult.urls.length,
      discoveryInScope: startUrls.length,
    },
    preflight: checkResult,
    discovery: discoveryResult,
    crawl: {
      visited: crawlResult.visited,
      accepted: crawlResult.accepted.length,
      ignored: crawlResult.ignored.length,
      duration: crawlResult.duration,
    },
    urls: crawlResult.accepted,
    ignored: options.noIgnored ? [] : crawlResult.ignored,
  };

  return output;
}

// Main entry point when run directly
const isMain = process.argv[1] && (
  process.argv[1].endsWith('cli.ts') ||
  process.argv[1].endsWith('cli.js')
);

if (isMain) {
  const options = parseCliArgs(process.argv.slice(2));

  const controller = new AbortController();
  process.on('SIGINT', () => controller.abort());

  run(options, controller.signal)
    .then(async (output) => {
      const json = JSON.stringify(output, null, 2);

      // Determine output file path
      let outputPath = options.output;
      if (!outputPath) {
        // Always auto-save to crawled/ folder
        const crawledDir = join(process.cwd(), 'crawled');
        await mkdir(crawledDir, { recursive: true });
        const hostname = new URL(options.url).hostname.replace(/[^a-z0-9.-]/gi, '_');
        const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        outputPath = join(crawledDir, `${hostname}_${ts}.json`);
      }

      await writeFile(outputPath, json, 'utf-8');

      // Download markdown versions if --download
      let downloadResult: DownloadResult | null = null;
      if (options.download) {
        downloadResult = await downloadMarkdown(output.urls, options.download, {
          timeout: options.timeout,
          rateLimit: options.rateLimit,
          signal: controller.signal,
        });
      }

      // Print to stdout if --json
      if (options.json) {
        console.log(json);
      }

      // Always show summary
      console.log(`\nkeyscan-crawl complete`);
      console.log(`  Seed:       ${output.seed}`);
      console.log(`  Scope:      ${output.metadata.scope} → ${output.metadata.scopeRoot ?? 'default'}`);
      console.log(`  Discovery:  ${output.discovery.source} (${output.metadata.discoveryTotal} found, ${output.metadata.discoveryInScope} in scope)`);
      if (output.preflight.markdownAlternative?.exists) {
        console.log(`  Markdown:   ${output.preflight.markdownAlternative.url}`);
      }
      console.log(`  Crawled:    ${output.crawl.accepted} URLs`);
      console.log(`  Ignored:    ${output.crawl.ignored}`);
      console.log(`  Duration:   ${output.metadata.duration}ms`);
      console.log(`  Saved to:   ${outputPath}`);
      if (downloadResult) {
        console.log(`  Downloaded: ${downloadResult.downloaded.length} markdown files → ${downloadResult.rootDir}`);
        if (downloadResult.skipped.length > 0) {
          console.log(`  Skipped:    ${downloadResult.skipped.length} (existing / no markdown)`);
        }
        if (downloadResult.failed.length > 0) {
          console.log(`  Failed:     ${downloadResult.failed.length}`);
        }
      }
    })
    .catch((err) => {
      console.error('Fatal error:', err.message);
      process.exit(1);
    });
}
