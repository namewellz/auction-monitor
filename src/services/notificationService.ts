import type { Lot, LotChanges } from '../types/lot.js';
import { formatCurrency, formatDate, formatRemainingTime } from '../utils/format.js';

export interface TelegramSender {
  sendMessage(chatId: number, text: string): Promise<void>;
}

export class NotificationService {
  public constructor(
    private readonly telegram: TelegramSender,
    private readonly chatIds: () => number[],
  ) {}

  public async notifyAll(message: string): Promise<void> {
    await Promise.all(this.chatIds().map((chatId) => this.telegram.sendMessage(chatId, message)));
  }

  public formatAdded(lot: Lot, alreadyExists: boolean): string {
    const prefix = alreadyExists ? 'Lote ja monitorado' : 'Lote adicionado';
    return [
      `${prefix}`,
      '',
      `ID: ${lot.id}`,
      '',
      lot.title,
      '',
      `Lance atual: ${formatCurrency(lot.currentBid)}`,
      `Proximo lance: ${formatCurrency(lot.nextBid)}`,
      '',
      `Encerramento: ${formatDate(lot.auctionEnd)}`,
      '',
      `${lot.city} - ${lot.state}`,
      lot.address,
    ].join('\n');
  }

  public formatList(lots: Lot[]): string {
    if (lots.length === 0) {
      return 'Nenhum lote cadastrado.';
    }

    return lots
      .map((lot) =>
        [
          `${lot.id} - ${lot.title || lot.url}`,
          `Lance: ${formatCurrency(lot.currentBid)}`,
          `Tempo: ${formatRemainingTime(lot.auctionEnd)}`,
          `Status: ${lot.monitoringEnabled ? 'monitorando' : 'pausado'}`,
        ].join('\n'),
      )
      .join('\n\n');
  }

  public formatDetails(lot: Lot): string {
    return [
      `${lot.id} - ${lot.title}`,
      '',
      `Site: ${lot.site}`,
      `URL: ${lot.url}`,
      `Lance atual: ${formatCurrency(lot.currentBid)}`,
      `Proximo lance: ${formatCurrency(lot.nextBid)}`,
      `Limite: ${formatCurrency(lot.maxBidLimit)}`,
      `Encerramento: ${formatDate(lot.auctionEnd)}`,
      `Local: ${lot.city} - ${lot.state}`,
      `Endereco: ${lot.address}`,
      `Patio: ${lot.yardName ?? 'Nao informado'}`,
      `Lote externo: ${lot.lotNumber ?? 'Nao informado'}`,
      `Codigo: ${lot.externalCode ?? 'Nao informado'}`,
      `Funcionando na entrada: ${formatBoolean(lot.runningAtEntry)}`,
      `Procedencia: ${lot.origin ?? 'Nao informado'}`,
      `Observacoes: ${lot.observations ?? 'Nao informado'}`,
      `Monitoramento: ${lot.monitoringEnabled ? 'ativo' : 'pausado'}`,
      `Ultima checagem: ${formatDate(lot.lastCheck)}`,
    ].join('\n');
  }

  public async notifyChanges(lot: Lot, changes: LotChanges): Promise<void> {
    const messages: string[] = [];

    if (changes.bidChanged) {
      messages.push(
        [`Lance atualizado`, '', lot.title, '', `${formatCurrency(changes.previousCurrentBid)} -> ${formatCurrency(lot.currentBid)}`].join(
          '\n',
        ),
      );
    }

    if (changes.endChanged) {
      messages.push([`Leilao prorrogado`, '', `Lote: ${lot.id}`, `Novo encerramento: ${formatDate(lot.auctionEnd)}`].join('\n'));
    }

    if (changes.infoChanged) {
      messages.push(
        [`Informacoes atualizadas`, '', `Lote: ${lot.id}`, `Campos: ${changes.changedFields.join(', ')}`].join('\n'),
      );
    }

    if (lot.maxBidLimit !== undefined && lot.currentBid > lot.maxBidLimit) {
      messages.push(
        [
          'Limite ultrapassado',
          '',
          `Lote: ${lot.id}`,
          '',
          `Limite: ${formatCurrency(lot.maxBidLimit)}`,
          `Lance Atual: ${formatCurrency(lot.currentBid)}`,
        ].join('\n'),
      );
    }

    for (const message of messages) {
      await this.notifyAll(message);
    }
  }
}

function formatBoolean(value: boolean | undefined): string {
  if (value === undefined) {
    return 'Nao informado';
  }

  return value ? 'Sim' : 'Nao';
}
