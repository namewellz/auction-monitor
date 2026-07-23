import initCycleTLS from 'cycletls';

export interface FetchHtmlOptions {
  headers?: Record<string, string>;
  allowNativeFallback?: boolean;
  preferNative?: boolean;
}

export async function fetchHtml(url: string, options: FetchHtmlOptions = {}): Promise<string> {
  if (options.preferNative) return fetchHtmlNative(url, options.headers);
  const cycleTLS = await initCycleTLS();

  try {
    const response = await cycleTLS(
      url,
      {
        body: '',
        ja3: '771,4865-4866-4867-49195-49199-49196-49200-52393-52392,0-23-65281-10-11-35-16-5-13-18-51-45-43-27-17513,29-23-24,0',
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
        headers: {
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
          ...options.headers,
        },
      },
      'get',
    );

    if (response.status < 200 || response.status >= 300) {
      if (options.allowNativeFallback && response.status === 495) {
        return fetchHtmlNative(url, options.headers);
      }

      throw new Error(`Request failed with status ${response.status}`);
    }

    return response.body;
  } finally {
    await cycleTLS.exit();
  }
}

async function fetchHtmlNative(url: string, headers: Record<string, string> = {}): Promise<string> {
  const response = await fetch(url, {
    headers: {
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
      ...headers,
    },
    signal: AbortSignal.timeout(45_000),
  });

  if (!response.ok) {
    throw new Error(`Native request failed with status ${response.status}`);
  }

  return response.text();
}
