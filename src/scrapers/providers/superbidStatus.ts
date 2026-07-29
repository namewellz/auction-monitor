export interface SuperbidStatusInput {
  statusId?: number;
  endDateTime?: number;
  endDate?: string;
  price?: number;
  totalBids?: number;
  offerStatus?: {
    removed?: boolean;
    stabbed?: boolean;
    subjudice?: boolean;
    giveYourBid?: boolean;
    sold?: boolean;
    reserved?: boolean;
    closed?: boolean;
    closedToBids?: boolean;
    wantToKnowThePrice?: boolean;
  };
  offerDetail?: {
    reservedPrice?: number;
  };
}

export interface SuperbidResolvedStatus {
  saleStatus: string;
  displayStatus: string;
  terminal: boolean;
}

export function resolveSuperbidStatus(
  offer: SuperbidStatusInput,
  now = Date.now(),
): SuperbidResolvedStatus {
  const flags = offer.offerStatus ?? {};
  const end = offer.endDateTime ?? parseDate(offer.endDate)?.getTime();
  const ended = end !== undefined && end <= now;
  const bid = finite(offer.price);
  const reserve = finite(offer.offerDetail?.reservedPrice);
  const hasBids = (offer.totalBids ?? 0) > 0;
  const reserveMet = hasBids && bid !== undefined && reserve !== undefined && bid >= reserve;

  if (flags.removed || flags.stabbed || flags.subjudice) {
    return status('Retirado', 'Retirado ou suspenso', true);
  }
  if (flags.giveYourBid && !ended) {
    return status('LiberadoLeilao', 'Aberto para lances', false);
  }
  if (flags.sold || reserveMet || offer.statusId === 3) {
    return status('Arrematado', 'Arrematado', true);
  }
  if (flags.reserved || offer.statusId === 11) {
    return status('Condicional', 'Aguardando aprovação do lance condicional', false);
  }
  if (ended && hasBids && reserve !== undefined && bid !== undefined && bid < reserve) {
    if (offer.statusId === 7) {
      return status('CondicionalNegada', 'Lance condicional não aprovado', true);
    }
    return status('Condicional', 'Lance condicional em análise', false);
  }
  if (ended && !hasBids) {
    return status('NaoArrematado', 'Encerrado sem arrematação', true);
  }
  if (offer.statusId === 7) {
    return status('CondicionalNegada', 'Lance condicional não aprovado', true);
  }
  if (offer.statusId === 6 || flags.closed || flags.closedToBids) {
    return status('NaoArrematado', 'Encerrado sem arrematação', true);
  }
  if (flags.wantToKnowThePrice && ended) {
    return status('Condicional', 'Resultado em análise', false);
  }
  return status('LiberadoLeilao', 'Aberto para lances', false);
}

function status(saleStatus: string, displayStatus: string, terminal: boolean): SuperbidResolvedStatus {
  return { saleStatus, displayStatus, terminal };
}

function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function parseDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}-03:00`);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}
