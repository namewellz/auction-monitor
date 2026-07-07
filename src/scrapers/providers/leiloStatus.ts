const finalSaleStatuses = new Set(['agpagamento', 'pago', 'vendido', 'arrematado']);

export function isLeiloFinalSaleStatus(status: string | undefined): boolean {
  return finalSaleStatuses.has(normalizeStatus(status));
}

function normalizeStatus(status: string | undefined): string {
  return (status ?? '').replace(/[^a-z]/gi, '').toLowerCase();
}
