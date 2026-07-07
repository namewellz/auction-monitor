import type { LotData } from '../../types/lot.js';

export interface LeiloVehiclePayload {
  id?: string;
  retomada?: string;
  anoModelo?: number;
  anoFabricacao?: number;
  modelo?: string;
  infocarModelo?: string;
  infocarMarca?: string;
  km?: number;
  cor?: string;
  combustivel?: string;
  valorMercado?: number;
  possuiChave?: boolean;
  prazoDocumento?: number;
  itensDetalhados?: {
    tipo?: string;
    quilometragem?: number;
    bateria?: string;
    chaveReserva?: string;
    manualProprietario?: string;
    observacoes?: string;
    leve?: Record<string, unknown>;
    moto?: Record<string, unknown>;
    pesado?: Record<string, unknown>;
  };
}

const detailLabels: Record<string, string> = {
  abs: 'ABS', tetoSolar: 'Teto solar', centralMultimidia: 'Central multimídia',
  controleVolante: 'Controle no volante', cameraRe: 'Câmera de ré',
  sensorEstacionamento: 'Sensor de estacionamento', tipoRoda: 'Roda', estepe: 'Estepe',
  macaco: 'Macaco', chaveRoda: 'Chave de roda', retrovisor: 'Retrovisor', bancos: 'Bancos',
  blindado: 'Blindado', kitGnv: 'GNV', alarme: 'Alarme', airbag: 'Airbag',
  bateria: 'Bateria', chaveReserva: 'Chave reserva', manualProprietario: 'Manual do proprietário',
  observacoes: 'Observações da vistoria', dianteiroEsquerdo: 'Pneu dianteiro esquerdo',
  dianteiroDireito: 'Pneu dianteiro direito', traseiroEsquerdo: 'Pneu traseiro esquerdo',
  traseiroDireito: 'Pneu traseiro direito',
};

const standardKeys = new Set(['direcao', 'tipoCambio', 'arCondicionado', 'vidros']);

export function mapLeiloVehicleDetails(vehicle: LeiloVehiclePayload | undefined): Partial<LotData> {
  if (!vehicle) return {};
  const equipment = vehicle.itensDetalhados?.leve
    ?? vehicle.itensDetalhados?.moto
    ?? vehicle.itensDetalhados?.pesado;
  const additionalDetails: Record<string, string> = {};

  addDetail(additionalDetails, 'Valor de mercado', formatMoney(vehicle.valorMercado));
  addDetail(additionalDetails, 'Prazo estimado da documentação', vehicle.prazoDocumento === undefined
    ? undefined
    : `${vehicle.prazoDocumento} dias úteis`);
  addDetail(additionalDetails, detailLabels.bateria!, vehicle.itensDetalhados?.bateria);
  addDetail(additionalDetails, detailLabels.chaveReserva!, vehicle.itensDetalhados?.chaveReserva);
  addDetail(additionalDetails, detailLabels.manualProprietario!, vehicle.itensDetalhados?.manualProprietario);
  addDetail(additionalDetails, detailLabels.observacoes!, vehicle.itensDetalhados?.observacoes);

  if (equipment) {
    for (const [key, value] of Object.entries(equipment)) {
      if (standardKeys.has(key)) continue;
      if (key === 'pneus' && isRecord(value)) {
        for (const [tire, condition] of Object.entries(value)) {
          addDetail(additionalDetails, detailLabels[tire] ?? humanize(tire), condition);
        }
        continue;
      }
      addDetail(additionalDetails, detailLabels[key] ?? humanize(key), value);
    }
  }

  return {
    ...(vehicle.cor ? { color: vehicle.cor } : {}),
    ...(vehicle.combustivel ? { fuel: vehicle.combustivel } : {}),
    ...(vehicle.possuiChave !== undefined ? { keyAvailable: vehicle.possuiChave ? 'Sim' : 'Não' } : {}),
    ...(stringValue(equipment?.tipoCambio) ? { transmission: stringValue(equipment?.tipoCambio)! } : {}),
    ...(stringValue(equipment?.direcao) ? { steering: stringValue(equipment?.direcao)! } : {}),
    ...(stringValue(equipment?.arCondicionado) ? { airConditioning: stringValue(equipment?.arCondicionado)! } : {}),
    ...(stringValue(equipment?.vidros) ? { windows: stringValue(equipment?.vidros)! } : {}),
    ...(Object.keys(additionalDetails).length ? { additionalDetails } : {}),
  };
}

function addDetail(target: Record<string, string>, label: string, value: unknown): void {
  const normalized = stringValue(value);
  if (normalized) target[label] = normalized;
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim() || undefined;
  if (typeof value === 'number' && Number.isFinite(value)) return value.toLocaleString('pt-BR');
  if (typeof value === 'boolean') return value ? 'Sim' : 'Não';
  return undefined;
}

function formatMoney(value: number | undefined): string | undefined {
  return value === undefined ? undefined : value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function humanize(value: string): string {
  return value.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (letter) => letter.toUpperCase());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
