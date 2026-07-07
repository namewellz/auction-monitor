export interface VipNormalizedStatus {
  phase: string;
  result?: string;
}

export function normalizeVipStatus(status: string | undefined): VipNormalizedStatus {
  const normalized = normalize(status);
  if (['abertoparaofertas', 'doulheuma', 'doulheduas', 'doulhedues', 'emdisputa'].includes(normalized)) {
    return { phase: 'OPEN' };
  }
  if (normalized.includes('condicionalnegad') || normalized.includes('condicionalrecusad')) {
    return { phase: 'FINALIZED', result: 'CONDITIONAL_REJECTED' };
  }
  if (normalized.includes('condicional')) {
    return { phase: 'FINALIZED', result: 'CONDITIONAL_PENDING' };
  }
  if (['vendido', 'arrematado', 'pago', 'vendidoporcompreja'].includes(normalized)) {
    return { phase: 'FINALIZED', result: 'SOLD' };
  }
  if (normalized.includes('naoarremat') || normalized.includes('semlance')) {
    return { phase: 'FINALIZED', result: 'UNSOLD' };
  }
  if (normalized.includes('retirado') || normalized.includes('cancelado') || normalized.includes('suspenso')) {
    return { phase: 'FINALIZED', result: 'WITHDRAWN' };
  }
  return { phase: 'UNKNOWN' };
}

export function isVipFinalSale(status: string | undefined): boolean {
  return normalizeVipStatus(status).result === 'SOLD';
}

function normalize(value: string | undefined): string {
  return (value ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[^a-z]/gi, '').toLowerCase();
}
