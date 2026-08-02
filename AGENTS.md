# AGENTS.md

TypeScript CLI crawler (`keyscan-crawl`) that preflights a URL, discovers candidate pages, and BFS-crawls within a scope. Runtime is `tsx` + Node `fetch`; HTML parsing via `linkedom`. No framework, no server.

## Commands

- `bun run dev <URL> [flags]` — run the CLI (`src/cli.ts`). Args pass straight through with bun; with npm you'd need `npm run dev -- <URL> ...`.
- `bun run test` — vitest (114 tests across 6 files in `tests/`). Single file: `bunx vitest run tests/scope.test.ts`.
- `bunx tsc --noEmit` — typecheck (no dedicated script). `bun run build` is `tsc` → `dist/` (rootDir `src`); only build when asked.
- `keyscan-crawl` (global binary) requires `npm link` first; it maps to `bin/keyscan-crawl.cmd` → `npx tsx src/cli.ts`.
- Quick smoke checks: `--max-urls 3` — this hits the real network, so keep it small.

## Pipeline (src/cli.ts, `run()`)

1. `preflight` (`src/check/`) — HEAD-then-GET fetch; probes `{seed}.md` for a markdown alternative.
2. Smart dir detection — refetches the seed page to look for child links; sets `scopeRoot` for `dir` scope.
3. `discover` (`src/discover/`) — **only** llms.txt → sitemap.xml → http-fallback. `discoverMarkdown` (`src/discover/markdown.ts`) is imported but never called — the README's "markdown discovery" step is stale; only its unit test references it.
4. BFS crawl (`src/crawler/`) — scope/depth/max-urls limits; a `.md` is probed per page only when preflight found one (`probeMd`), recorded as `mdUrl`.
5. JSON auto-saved to `crawled/{hostname}_{ts}.json`. `--download` writes markdown to `<dir>/<domain>/<page>.md` (default dir `docs`), skipping existing files.

Scope logic is centralized in `src/utils/url.ts` (`isInsideScope`, `resolveRootPath`, `detectScopeRoot`, `domainFolder`, `docFilename`); `crawler/scope.ts` just wraps `isInsideScope`.

## Testing quirks

- Every test stubs the Node global `fetch` via `vi.stubGlobal('fetch', mockFetch)` + a `makeResponse()` helper — never hit the real network.
- `tests/cli.test.ts` asserts on ordered `mockResolvedValueOnce` chains: adding a network call anywhere in the pipeline breaks those call-order tests.
- Tests in `tests/` mirror `src/` structure; tsconfig excludes `tests/`.

## Conventions & gotchas

- Windows (win32) shell — use PowerShell syntax. Use `bun`, not npm.
- No `.gitignore` and no commits yet: `node_modules/`, `dist/`, `crawled/`, `docs/`, `.kiro/` are all untracked — don't commit them.
- Soft-404 detection matches whole phrases (`"page not found"`, `"doesn't exist"`), never bare tokens like `404` or `not found` — real docs pages get rejected otherwise. Preserve this in new probes.
- `--download`/`-D` takes an optional arg and is pre-parsed in `cli.ts` before `node:util` `parseArgs` (parseArgs can't express optional-arg flags).
- Imports use `.js` extensions (ESM + bundler module resolution) even though sources are `.ts`.
- Keep source files under ~800 lines (repo rule in `.kiro/steering/rules.md`).
- Git (`.kiro/steering/rules.md`): never `git checkout` another branch unless asked; the user commits to `main` when ready; backups are commit + push from the current branch.
- README is stale on counts: it says "101 tests / 5 test files"; actual is 114 / 6.
