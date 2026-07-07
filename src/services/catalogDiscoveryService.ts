import * as cheerio from 'cheerio';
import { fetchHtml } from '../scrapers/base/cycleTlsClient.js';

interface DiscoveryProfile {
  lotPath: RegExp;
  followPath: RegExp;
}

const profiles: Record<string, DiscoveryProfile> = {
  vipleiloes: {
    lotPath: /^\/evento\/anuncio\/.+-\d+\/?$/i,
    followPath: /^\/evento(?:\/|$)/i,
  },
  leilo: {
    lotPath: /^\/leilao\/.+\/[0-9a-f]{8}-[0-9a-f-]{27,}\/?$/i,
    followPath: /^\/leilao(?:\/|$)/i,
  },
  superbid: {
    lotPath: /^\/oferta\/.+-\d+\/?$/i,
    followPath: /^\/(?:evento|oferta|categorias)(?:\/|$)/i,
  },
};

export class CatalogDiscoveryService {
  public async discoverLotUrls(
    site: string,
    seedUrl: string,
    options: { maxPages: number; maxDepth: number },
  ): Promise<string[]> {
    const profile = profiles[site];
    if (!profile) {
      throw new Error(`No discovery profile registered for site: ${site}`);
    }

    const seed = new URL(seedUrl);
    if (profile.lotPath.test(seed.pathname)) {
      return [canonicalUrl(seed)];
    }

    const queue: Array<{ url: string; depth: number }> = [{ url: canonicalUrl(seed), depth: 0 }];
    const visited = new Set<string>();
    const lots = new Set<string>();

    while (queue.length > 0 && visited.size < options.maxPages) {
      const item = queue.shift();
      if (!item || visited.has(item.url)) continue;
      visited.add(item.url);

      const html = await fetchHtml(item.url, { allowNativeFallback: true });
      const $ = cheerio.load(html);
      for (const href of $('a[href]').map((_, element) => $(element).attr('href')).get()) {
        const candidate = safeUrl(href, item.url);
        if (!candidate || candidate.hostname !== seed.hostname) continue;

        const normalized = canonicalUrl(candidate);
        if (profile.lotPath.test(candidate.pathname)) {
          lots.add(normalized);
        } else if (
          item.depth < options.maxDepth &&
          profile.followPath.test(candidate.pathname) &&
          !visited.has(normalized)
        ) {
          queue.push({ url: normalized, depth: item.depth + 1 });
        }
      }
    }

    return [...lots];
  }
}

function safeUrl(href: string, base: string): URL | undefined {
  try {
    const url = new URL(href, base);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : undefined;
  } catch {
    return undefined;
  }
}

function canonicalUrl(url: URL): string {
  url.hash = '';
  return url.toString();
}
