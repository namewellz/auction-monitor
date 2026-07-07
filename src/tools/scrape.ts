import { config } from '../config.js';
import { createScraperFactory } from '../scrapers/createScraperFactory.js';

const url = process.argv[2];

if (!url) {
  console.error('Usage: npm run scrape -- <url>');
  process.exit(1);
}

const factory = createScraperFactory(config);
const scraper = factory.forUrl(url);
const data = await scraper.scrape(url);

console.log(
  JSON.stringify(
    {
      site: scraper.site,
      url,
      data,
    },
    null,
    2,
  ),
);
