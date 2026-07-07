import type { LotData } from '../../types/lot.js';

export interface CatalogLot {
  url: string;
  data?: LotData;
  classification?: string;
  assetType?: LotData['assetType'];
}

export interface CatalogPage {
  page: number;
  pageSize: number;
  total: number;
  hasNext: boolean;
  lots: CatalogLot[];
}

export interface CatalogProvider {
  readonly site: string;
  readonly source: string;
  scrapePage(page: number): Promise<CatalogPage>;
}
