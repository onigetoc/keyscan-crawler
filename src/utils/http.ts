export interface HttpResponse {
  status: number;
  statusText: string;
  headers: Headers;
  url: string;
  redirected: boolean;
  body: string | null;
  method: 'HEAD' | 'GET';
}

const DEFAULT_HEADERS: Record<string, string> = {
  'User-Agent': 'Mozilla/5.0 (compatible; KeyscanCrawler/0.1)',
};

/**
 * Perform a HEAD request first; if the server rejects it (405/501),
 * fallback to a GET request. Returns the response with body only on GET.
 */
export async function headOrGet(
  url: string,
  options?: { timeout?: number; headers?: Record<string, string> }
): Promise<HttpResponse> {
  const timeout = options?.timeout ?? 10_000;
  const headers = { ...DEFAULT_HEADERS, ...options?.headers };

  // Try HEAD first
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    const res = await fetch(url, {
      method: 'HEAD',
      headers,
      redirect: 'follow',
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (res.status !== 405 && res.status !== 501) {
      return {
        status: res.status,
        statusText: res.statusText,
        headers: res.headers,
        url: res.url,
        redirected: res.redirected,
        body: null,
        method: 'HEAD',
      };
    }
  } catch (err: any) {
    // If HEAD itself fails with network error, we still try GET
    if (err?.name === 'AbortError') {
      throw new Error(`Timeout after ${timeout}ms: ${url}`);
    }
  }

  // Fallback to GET
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers,
      redirect: 'follow',
      signal: controller.signal,
    });
    clearTimeout(timer);

    const body = await res.text();

    return {
      status: res.status,
      statusText: res.statusText,
      headers: res.headers,
      url: res.url,
      redirected: res.redirected,
      body,
      method: 'GET',
    };
  } catch (err: any) {
    clearTimeout(timer);
    if (err?.name === 'AbortError') {
      throw new Error(`Timeout after ${timeout}ms: ${url}`);
    }
    throw err;
  }
}
