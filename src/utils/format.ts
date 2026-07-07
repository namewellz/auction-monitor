export function formatCurrency(value: number | undefined): string {
  if (value === undefined) {
    return 'Nao informado';
  }

  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatDate(value: Date | undefined): string {
  if (!value) {
    return 'Nao informado';
  }

  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Sao_Paulo',
  }).format(value);
}

export function formatRemainingTime(date: Date): string {
  const diffMs = date.getTime() - Date.now();
  if (diffMs <= 0) {
    return 'encerrado';
  }

  const totalMinutes = Math.ceil(diffMs / 60_000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) {
    return `${days}d ${hours}h`;
  }

  if (hours > 0) {
    return `${hours}h${minutes.toString().padStart(2, '0')}m`;
  }

  return `${minutes}m`;
}

export function parseMoney(input: string): number | undefined {
  const normalized = input.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.');
  const value = Number(normalized);
  return Number.isFinite(value) ? value : undefined;
}
