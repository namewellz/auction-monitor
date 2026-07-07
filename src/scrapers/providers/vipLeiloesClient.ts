const defaultChannelId = 'f47eec16-722a-493c-a8f3-b300016b56db';

export class VipLeiloesClient {
  private cookie: string | undefined;
  private nextRequestAt = 0;
  private requestQueue: Promise<void> = Promise.resolve();

  public constructor(
    private readonly origin = 'https://www.vipleiloes.com.br',
    private readonly minimumIntervalMs = 750,
  ) {}

  public async get(pathOrUrl: string, referer = `${this.origin}/`): Promise<Response> {
    return this.request(pathOrUrl, { method: 'GET', referer });
  }

  public async getAjax(pathOrUrl: string, referer = `${this.origin}/`): Promise<Response> {
    return this.request(pathOrUrl, { method: 'GET', referer, ajax: true });
  }

  public async postForm(pathOrUrl: string, form: URLSearchParams, referer = `${this.origin}/pesquisa`): Promise<Response> {
    return this.request(pathOrUrl, { method: 'POST', body: form, referer, ajax: true });
  }

  private async request(
    pathOrUrl: string,
    options: { method: 'GET' | 'POST'; body?: URLSearchParams; referer: string; ajax?: boolean },
  ): Promise<Response> {
    const url = new URL(pathOrUrl, this.origin);
    await this.ensureCookie(`${url.pathname}${url.search}`);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await this.throttle();
      const response = await fetch(url, {
        method: options.method,
        redirect: 'manual',
        headers: this.headers(options.referer, options.ajax ?? false, options.body !== undefined),
        ...(options.body ? { body: options.body } : {}),
        signal: AbortSignal.timeout(30_000),
      });

      if (response.status === 429) {
        const retryAfter = Number(response.headers.get('retry-after'));
        await delay(Number.isFinite(retryAfter) ? retryAfter * 1000 : 3_000 * (attempt + 1));
        continue;
      }

      if (isChannelRedirect(response)) {
        this.cookie = undefined;
        await this.ensureCookie(`${url.pathname}${url.search}`);
        continue;
      }

      return response;
    }

    throw new Error(`VIP Leiloes request exhausted retries: ${url}`);
  }

  private async ensureCookie(returnUrl: string): Promise<void> {
    if (this.cookie) return;
    const channelUrl = new URL(`/canal?returnUrl=${encodeURIComponent(returnUrl)}`, this.origin);
    const response = await fetch(channelUrl, {
      redirect: 'manual',
      headers: this.headers(`${this.origin}/`, false, false, false),
      signal: AbortSignal.timeout(20_000),
    });
    const setCookie = response.headers.get('set-cookie');
    this.cookie = setCookie?.match(/__CBCanal=([^;]+)/)?.[0]
      ?? `__CBCanal=${encodeURIComponent(JSON.stringify({ CanalId: defaultChannelId }))}`;
  }

  private headers(referer: string, ajax: boolean, form: boolean, includeCookie = true): Record<string, string> {
    return {
      Accept: ajax ? 'text/html,application/json;q=0.9,*/*;q=0.8' : 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
      'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      Referer: referer,
      ...(ajax ? { 'X-Requested-With': 'XMLHttpRequest' } : {}),
      ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      ...(includeCookie && this.cookie ? { Cookie: this.cookie } : {}),
    };
  }

  private async throttle(): Promise<void> {
    const previous = this.requestQueue;
    let release: (() => void) | undefined;
    this.requestQueue = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    const wait = Math.max(0, this.nextRequestAt - Date.now());
    if (wait > 0) await delay(wait);
    this.nextRequestAt = Date.now() + this.minimumIntervalMs;
    release?.();
  }
}

function isChannelRedirect(response: Response): boolean {
  return response.status >= 300
    && response.status < 400
    && (response.headers.get('location') ?? '').startsWith('/canal');
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
