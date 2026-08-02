# keyscan-crawler

Scope-aware URL crawler with preflight check, smart discovery, and markdown detection. Designed to crawl documentation sites efficiently without pulling in the entire domain.

## Features

- **Smart scope detection** — Automatically determines if a URL is a directory (has children) or a leaf page
- **Discovery pipeline** — Probes `llms.txt`, `sitemap.xml`, and markdown files before falling back to HTML crawling
- **Markdown detection** — Probes `.md` alternatives for each crawled page (useful for scraping raw content)
- **Markdown download** — `--download` saves the markdown pages to `docs/<domain>/<page>.md`
- **Scope filtering** — 5 scope modes to control how far the crawler goes
- **BFS crawl** — Breadth-first traversal with depth limiting, rate limiting, and retry on failure
- **JSON output** — Structured results saved to `crawled/` folder automatically

## Install

```bash
bun install
```

## Global install (npm link)

Link the package so the `keyscan-crawl` binary is available anywhere:

```bash
npm link
keyscan-crawl https://crawlee.dev/js/docs/guides --max-urls 5
```

To unlink:

```bash
npm unlink keyscan-crawler
```

## Usage

```bash
bun run dev <URL> [options]
```

### Examples

```bash
# Crawl a docs section (smart dir detection)
bun run dev https://crawlee.dev/js/docs/guides --max-urls 5

# Crawl with no discovery (just follow links from seed)
bun run dev https://example.com/docs/page --no-discovery --depth 2

# Output JSON to stdout
bun run dev https://docs.astral.sh/uv/ --json --max-urls 3

# Save to a specific file
bun run dev https://example.com/docs --output results.json

# Installed binary (keyscan-crawl)
keyscan-crawl "https://react.dev/learn/editor-setup" --json --max-urls 10 --no-ignored --no-discovery
```

### Example output (truncated)

Running the command above produces JSON like this — the `urls` array continues with the remaining crawled pages:

```json
{
  "version": "0.1.0",
  "seed": "https://react.dev/learn/editor-setup",
  "timestamp": "2026-08-02T16:52:41.212Z",
  "metadata": {
    "scope": "dir",
    "scopeRoot": "https://react.dev/learn/",
    "maxDepth": 3,
    "maxUrls": 10,
    "timeout": 10000,
    "duration": 5950,
    "discoveryTotal": 1,
    "discoveryInScope": 2
  },
  "preflight": {
    "url": "https://react.dev/learn/editor-setup",
    "finalUrl": "https://react.dev/learn/editor-setup",
    "status": 200,
    "statusText": "OK",
    "contentType": "text/html; charset=utf-8",
    "detectedType": "html",
    "accessible": true,
    "redirected": false,
    "markdownAlternative": {
      "url": "https://react.dev/learn/editor-setup.md",
      "exists": true,
      "isSoft404": false,
      "status": 200
    }
  },
  "discovery": {
    "source": "http-fallback",
    "urls": [
      "https://react.dev/learn/editor-setup"
    ]
  },
  "crawl": {
    "visited": 190,
    "accepted": 10,
    "ignored": 180,
    "duration": 5458
  },
  "urls": [
    {
      "url": "https://react.dev/learn/editor-setup",
      "depth": 0,
      "status": 200,
      "contentType": "text/html; charset=utf-8",
      "links": 105,
      "mdUrl": "https://react.dev/learn/editor-setup.md"
    },
    {
      "url": "https://react.dev/learn/tutorial-tic-tac-toe",
      "depth": 1,
      "status": 200,
      "contentType": "text/html; charset=utf-8",
      "links": 113,
      "mdUrl": "https://react.dev/learn/tutorial-tic-tac-toe.md"
    }
  ]
}
```

## CLI Flags

| Flag | Short | Default | Description |
|------|-------|---------|-------------|
| `--scope <mode>` | `-s` | `dir` | Scope mode (see below) |
| `--depth <n>` | `-d` | `3` | Maximum crawl depth from seed |
| `--max-urls <n>` | | `500` | Maximum number of URLs to crawl |
| `--output <file>` | `-o` | auto | Write JSON to specific file path |
| `--json` | `-j` | `false` | Also print JSON to stdout |
| `--no-ignored` | | `false` | Omit ignored URLs from output |
| `--no-discovery` | | `false` | Skip discovery, crawl from seed directly |
| `--download [dir]` | `-D` | off | Download markdown versions of crawled pages to `dir` (default: `docs`) |
| `--timeout <ms>` | | `10000` | Request timeout per URL |
| `--rate-limit <ms>` | | `200` | Delay between requests |
| `--help` | `-h` | | Show help |

## Scope Modes

| Mode | Description |
|------|-------------|
| `dir` | Stay within the detected directory. If the seed has child links, the seed itself is the root. Otherwise, its parent directory is the root. |
| `parent` | One level up from the seed's directory |
| `domain` | Entire registrable domain (includes all subdomains) |
| `subdomain` | Exact subdomain only (e.g. `docs.example.com`) |
| `external` | No boundary — follows all links |

### Smart dir detection

When using scope `dir` (default), the crawler fetches the seed page and checks if any outgoing links are children of the seed URL:

- `https://crawlee.dev/js/docs/guides` has links to `/guides/result-storage`, `/guides/configuration`, etc. → scope root = `/js/docs/guides/`
- `https://crawlee.dev/js/docs/guides/result-storage` has no child links → scope root = `/js/docs/guides/`

This means you can point at a section index and get just that section.

## Discovery Pipeline

The crawler runs discovery in this order (first match wins):

1. **llms.txt** — Probes `{scopeRoot}/llms.txt` then `{origin}/llms.txt`
2. **sitemap.xml** — Fetches `{origin}/sitemap.xml`, supports sitemap index
3. **Markdown** — Probes `{seed}.md`, `index.md`, `README.md`
4. **HTTP fallback** — Uses the seed URL directly

Discovery URLs are filtered by scope before being passed to the crawler.

## Markdown Detection

If the seed URL has a `.md` alternative (detected during preflight), the crawler probes `.md` for every HTML page it visits. The output includes `mdUrl` for each page where a markdown version exists:

```json
{
  "url": "https://crawlee.dev/js/docs/guides/avoid-blocking",
  "mdUrl": "https://crawlee.dev/js/docs/guides/avoid-blocking.md",
  "status": 200,
  "depth": 0,
  "links": 82
}
```

This tells a downstream scraper it can fetch the `.md` directly instead of parsing HTML.

## Markdown Download

With `--download` (or `-D`), the crawler saves the markdown version of every crawled page that has one to disk. Only pages with a detected `.md` alternative (`mdUrl`) are downloaded — a `.md` file must actually exist on the site for a page to be fetched; pages without one are skipped. Files are written as `<dir>/<domain>/<page>.md`:

- `dir` defaults to `docs` (`--download`), or you can pick a folder: `-D myfolder`
- `<domain>` is the registrable domain without the TLD and without subdomains (`learn.microsoft.com` → `microsoft`)
- `<page>` is the last path segment of the URL (`/en-us/windows/powertoys/advanced-paste` → `advanced-paste.md`; a directory root becomes `index.md`)

```bash
# Download into docs/microsoft/advanced-paste.md
keyscan-crawl https://learn.microsoft.com/en-us/windows/powertoys/advanced-paste --download

# Custom folder
keyscan-crawl https://learn.microsoft.com/en-us/windows/powertoys --download -D myfolder
```

Existing files are skipped — nothing is re-downloaded or overwritten.

## Output Format

Results are automatically saved to `crawled/{hostname}_{timestamp}.json`:

```json
{
  "version": "0.1.0",
  "seed": "https://crawlee.dev/js/docs/guides",
  "timestamp": "2026-07-27T01:58:27.000Z",
  "metadata": {
    "scope": "dir",
    "scopeRoot": "https://crawlee.dev/js/docs/guides/",
    "maxDepth": 1,
    "maxUrls": 500,
    "timeout": 10000,
    "duration": 4683,
    "discoveryTotal": 3403,
    "discoveryInScope": 20
  },
  "preflight": { ... },
  "discovery": { "source": "sitemap", "urls": [...] },
  "crawl": { "visited": 297, "accepted": 20, "ignored": 277, "duration": 4200 },
  "urls": [ ... ],
  "ignored": [ ... ]
}
```

## Error Handling

- **Timeout**: 10s per request (configurable)
- **Retry**: 1 retry on network failure
- **Max URLs**: Hard cap at 500 (configurable)
- **Graceful shutdown**: Ctrl+C stops crawling and writes partial results
- **Redirect tracking**: Redirected URLs are noted in the output

## Stack

- TypeScript + tsx (runtime)
- vitest (testing)
- linkedom (HTML link extraction)
- Node.js built-in `fetch` (HTTP)

## Tests

```bash
bun run test
```

101 tests across 5 test files covering scope logic, preflight, discovery, crawler, and CLI pipeline.
