import type { CheckResult, ContentType, MarkdownProbe } from './types.js';

export type { CheckResult, ContentType, MarkdownProbe } from './types.js';

const ERROR_PHRASES = [
  "this page doesn't exist",
  'page not found',
  "doesn't exist",
  'no such file',
];

const DEFAULT_TIMEOUT = 10_000;
const USER_AGENT = 'Mozilla/5.0 (compatible; KeyscanCrawler/0.1)';

/**
 * Preflight check on a URL: determines status, content type, accessibility,
 * and probes for a markdown alternative (.md) with soft-404 detection.
 */
export async function preflight(url: string, options?: { timeout?: number }): Promise<CheckResult> {
  const timeout = options?.timeout ?? DEFAULT_TIMEOUT;

  let status = 0;
  let statusText = '';
  let contentTypeHeader: string | null = null;
  let finalUrl = url;
  let redirected = false;
  let body: string | null = null;
  let method: 'HEAD' | 'GET' = 'HEAD';

  // HEAD first, fallback GET
  try {
    const res = await fetchWithTimeout(url, 'HEAD', timeout);
    status = res.status;
    statusText = res.statusText;
    contentTypeHeader = res.headers.get('content-type');
    finalUrl = res.url;
    redirected = res.redirected;

    if (status === 405 || status === 501) {
      const getRes = await fetchWithTimeout(url, 'GET', timeout);
      status = getRes.status;
      statusText = getRes.statusText;
      contentTypeHeader = getRes.headers.get('content-type');
      finalUrl = getRes.url;
      redirected = getRes.redirected;
      body = await getRes.text();
      method = 'GET';
    }
  } catch {
    return {
      url,
      finalUrl: url,
      status: 0,
      statusText: 'Network Error',
      contentType: null,
      detectedType: 'unknown',
      accessible: false,
      redirected: false,
      markdownAlternative: null,
    };
  }

  const detectedType = detectContentType(contentTypeHeader);
  const accessible = status >= 200 && status < 400;

  // Probe markdown alternative if the original is HTML
  let markdownAlternative: MarkdownProbe | null = null;
  if (accessible && detectedType === 'html') {
    markdownAlternative = await probeMarkdown(url, timeout);
  }

  return {
    url,
    finalUrl,
    status,
    statusText,
    contentType: contentTypeHeader,
    detectedType,
    accessible,
    redirected,
    markdownAlternative,
  };
}

/**
 * Detect the content type category from a Content-Type header value.
 */
export function detectContentType(contentType: string | null): ContentType {
  if (!contentType) return 'unknown';
  const ct = contentType.toLowerCase();

  if (ct.includes('text/html')) return 'html';
  if (ct.includes('text/markdown')) return 'markdown';
  if (ct.includes('application/pdf')) return 'pdf';
  if (ct.includes('text/plain')) return 'text';
  return 'unknown';
}

/**
 * Probe for a markdown alternative at url.md.
 * Detects soft-404 pages via ERROR_PHRASES in the response body.
 */
async function probeMarkdown(baseUrl: string, timeout: number): Promise<MarkdownProbe> {
  const mdUrl = baseUrl.endsWith('.md') ? baseUrl : `${baseUrl.replace(/\/+$/, '')}.md`;

  try {
    const res = await fetchWithTimeout(mdUrl, 'GET', timeout);
    const body = await res.text();
    const preview = body.slice(0, 2000).toLowerCase();

    const isSoft404 = res.ok && isSoftError(preview, res.headers.get('content-type'));

    return {
      url: mdUrl,
      exists: res.ok && !isSoft404 && isMarkdownContent(res.headers.get('content-type'), preview),
      isSoft404,
      status: res.status,
    };
  } catch {
    return {
      url: mdUrl,
      exists: false,
      isSoft404: false,
      status: 0,
    };
  }
}

function isSoftError(preview: string, contentType: string | null): boolean {
  const ct = (contentType ?? '').toLowerCase();
  const isHtml = ct.includes('text/html') || preview.startsWith('<!doctype') || preview.startsWith('<html');

  if (!isHtml) return false;
  return ERROR_PHRASES.some(phrase => preview.includes(phrase));
}

function isMarkdownContent(contentType: string | null, preview: string): boolean {
  const ct = (contentType ?? '').toLowerCase();
  if (ct.includes('text/markdown')) return true;
  if (ct.includes('text/plain')) return true;
  // If HTML is served, it's not real markdown
  if (ct.includes('text/html')) return false;
  if (preview.startsWith('<!doctype') || preview.startsWith('<html')) return false;
  return true;
}

async function fetchWithTimeout(url: string, method: 'HEAD' | 'GET', timeout: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, {
      method,
      headers: { 'User-Agent': USER_AGENT },
      redirect: 'follow',
      signal: controller.signal,
    });
    return res;
  } finally {
    clearTimeout(timer);
  }
}
