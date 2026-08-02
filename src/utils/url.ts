export type ScopeMode = 'dir' | 'parent' | 'domain' | 'subdomain' | 'external';

/**
 * Resolve the root path for a given seed URL based on scope mode.
 * Returns the base URL that acts as the boundary for crawling.
 *
 * If scopeRoot is provided (from smart detection), it's used directly for 'dir' mode.
 */
export function resolveRootPath(seed: string, scope: ScopeMode, scopeRoot?: string): string {
  if (scopeRoot && scope === 'dir') {
    return scopeRoot;
  }

  const url = new URL(seed);

  switch (scope) {
    case 'dir': {
      // Same directory as the seed URL
      const path = url.pathname;
      const lastSlash = path.lastIndexOf('/');
      url.pathname = lastSlash > 0 ? path.slice(0, lastSlash + 1) : '/';
      url.search = '';
      url.hash = '';
      return url.toString();
    }
    case 'parent': {
      // One level up from the seed directory
      const path = url.pathname;
      const lastSlash = path.lastIndexOf('/');
      const dir = lastSlash > 0 ? path.slice(0, lastSlash) : '/';
      const parentSlash = dir.lastIndexOf('/');
      url.pathname = parentSlash > 0 ? dir.slice(0, parentSlash + 1) : '/';
      url.search = '';
      url.hash = '';
      return url.toString();
    }
    case 'domain': {
      url.pathname = '/';
      url.search = '';
      url.hash = '';
      return url.toString();
    }
    case 'subdomain': {
      url.pathname = '/';
      url.search = '';
      url.hash = '';
      return url.toString();
    }
    case 'external': {
      return '*';
    }
  }
}

/**
 * Check if a URL is inside the allowed scope relative to the seed.
 * scopeRoot overrides the resolved root for 'dir' mode (used by smart detection).
 */
export function isInsideScope(url: string, seed: string, scope: ScopeMode, scopeRoot?: string): boolean {
  if (scope === 'external') return true;

  try {
    const target = new URL(url);
    const seedUrl = new URL(seed);

    // Strip fragments for comparison
    target.hash = '';

    switch (scope) {
      case 'subdomain': {
        return target.host === seedUrl.host;
      }
      case 'domain': {
        const targetDomain = getRegistrableDomain(target.hostname);
        const seedDomain = getRegistrableDomain(seedUrl.hostname);
        return targetDomain === seedDomain;
      }
      case 'parent': {
        if (target.host !== seedUrl.host) return false;
        const rootPath = resolveRootPath(seed, 'parent');
        const rootUrl = new URL(rootPath);
        return target.pathname.startsWith(rootUrl.pathname);
      }
      case 'dir': {
        if (target.host !== seedUrl.host) return false;
        const rootPath = resolveRootPath(seed, 'dir', scopeRoot);
        const rootUrl = new URL(rootPath);
        return target.pathname.startsWith(rootUrl.pathname);
      }
    }
  } catch {
    return false;
  }
}

/**
 * Detect if a seed URL acts as a directory by checking if any links
 * on the page are "children" of the seed (start with seed path + /).
 *
 * Returns the scope root (seed + /) if it's a directory, or null if it's a leaf page.
 */
export function detectScopeRoot(seedUrl: string, links: string[]): string {
  const seed = new URL(seedUrl);
  const seedPath = seed.pathname.endsWith('/')
    ? seed.pathname
    : seed.pathname + '/';

  // Check if any link starts with seedPath (= child of seed)
  const hasChildren = links.some(link => {
    try {
      const u = new URL(link);
      return u.host === seed.host && u.pathname.startsWith(seedPath) && u.pathname !== seedPath;
    } catch {
      return false;
    }
  });

  if (hasChildren) {
    // Seed is a directory — scope root is seed + /
    seed.pathname = seedPath;
    seed.search = '';
    seed.hash = '';
    return seed.toString();
  }

  // Seed is a file — scope root is its parent directory (default behavior)
  return resolveRootPath(seedUrl, 'dir');
}

/**
 * Extract a rough "registrable domain" (last 2 parts).
 * This is a simple heuristic — doesn't handle co.uk etc.
 */
function getRegistrableDomain(hostname: string): string {
  const parts = hostname.split('.');
  if (parts.length <= 2) return hostname;
  return parts.slice(-2).join('.');
}

/**
 * Folder name for a URL's domain: registrable domain without the TLD,
 * and without subdomains or a leading `www`.
 *
 * Examples:
 *   https://learn.microsoft.com/...  -> "microsoft"
 *   https://docs.obsidian.md/...     -> "obsidian"
 *   https://www.cnbc.com/...         -> "cnbc"
 */
export function domainFolder(url: string): string {
  const hostname = new URL(url).hostname.replace(/^www\./i, '');
  const parts = hostname.split('.').filter(Boolean);

  let registrable = parts;
  if (parts.length > 2) {
    registrable = parts.slice(-2);
  }
  registrable = registrable.slice(0, -1);

  return sanitizeFilename(registrable.join('.') || hostname) || 'domain';
}

/**
 * Markdown file name for a URL's page: last path segment (or "index").
 * Examples:
 *   https://learn.microsoft.com/en-us/windows/powertoys/advanced-paste -> "advanced-paste.md"
 *   https://react.dev/learn/                                            -> "index.md"
 */
export function docFilename(url: string): string {
  const parsed = new URL(url);
  let path = parsed.pathname;
  if (path.endsWith('/')) path = path.slice(0, -1);

  const segments = path.split('/').filter(Boolean);
  let base = segments.length > 0 ? segments[segments.length - 1] : 'index';
  try {
    base = decodeURIComponent(base);
  } catch {
    // leave as-is if not valid percent-encoding
  }
  base = base.replace(/\.(md|markdown|html?)$/i, '');
  base = sanitizeFilename(base);

  return `${base || 'index'}.md`;
}

/**
 * Make a string safe to use as a file name (Windows-friendly).
 */
export function sanitizeFilename(name: string): string {
  return name
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/\.\./g, '_')
    .replace(/[. ]+$/g, '')
    .trim();
}
