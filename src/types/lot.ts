export interface BidHistoryEntry {
  sourceKey: string;
  amount: number;
  observedAt: Date;
  bidderAlias?: string;
  bidType?: string;
  sourceOrder?: number;
}

export interface LotData {
  title: string;
  currentBid: number;
  bidderAlias?: string;
  nextBid: number;
  auctionEnd: Date;
  city: string;
  state: string;
  address: string;
  yardName?: string;
  observations?: string;
  lotNumber?: string;
  externalCode?: string;
  runningAtEntry?: boolean;
  origin?: string;
  brand?: string;
  model?: string;
  manufactureYear?: number;
  modelYear?: number;
  mileage?: number;
  consignor?: string;
  saleStatus?: string;
  displayStatus?: string;
  salePhase?: string;
  saleResult?: string;
  classification?: string;
  assetType?: 'car' | 'motorcycle' | 'heavy' | 'real_estate';
  sourceAnnouncementId?: string;
  bidCount?: number;
  color?: string;
  fuel?: string;
  transmission?: string;
  plateFinal?: string;
  plateState?: string;
  airConditioning?: string;
  steering?: string;
  keyAvailable?: string;
  locks?: string;
  windows?: string;
  additionalDetails?: Record<string, string>;
  vehicleDetails?: {
    vehicleCondition?: string;
    engineCondition?: string;
    bodyCondition?: string;
    paintCondition?: string;
    upholsteryCondition?: string;
    tireCondition?: string;
    wheelType?: string;
    doorCount?: number;
    seatType?: string;
    soundSystem?: string;
    chassisCondition?: string;
    vehicleRestrictions?: string;
    taxStatus?: string;
    debtNotes?: string;
    referenceCode?: string;
    extractionConfidence?: 'structured' | 'label_parsed' | 'inferred';
    unmappedDetails?: Record<string, string>;
  };
  finalBid?: number;
  commissionFee?: number;
  buyerFee?: number;
  otherFees?: number;
  totalCost?: number;
  soldAt?: Date;
  eventName?: string;
  eventExternalCode?: string;
  eventUrl?: string;
  auctionStart?: Date;
  imageUrls?: string[];
  videoUrl?: string;
  documentUrls?: string[];
  documents?: Array<{ url: string; label?: string; documentType?: string }>;
  neighborhood?: string;
  neighborhoodNormalized?: string;
  postalCode?: string;
  propertyType?: string;
  occupancyStatus?: string;
  totalAreaM2?: number;
  privateAreaM2?: number;
  latitude?: number;
  longitude?: number;
  acceptsFinancing?: boolean;
  bidHistory?: BidHistoryEntry[];
}

export interface Lot extends LotData {
  id: string;
  site: string;
  url: string;
  maxBidLimit?: number;
  monitoringEnabled: boolean;
  lastCheck?: Date;
  lastBidChange?: Date;
  lastEndChange?: Date;
  createdAt: Date;
}

export interface CreateLotInput extends LotData {
  id: string;
  site: string;
  url: string;
}

export interface LotChanges {
  bidChanged: boolean;
  endChanged: boolean;
  infoChanged: boolean;
  previousCurrentBid?: number;
  previousAuctionEnd?: Date;
  changedFields: string[];
}
