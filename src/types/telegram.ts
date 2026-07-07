export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

export interface TelegramMessage {
  message_id: number;
  text?: string;
  chat: {
    id: number;
    type: string;
  };
}

export interface TelegramApiResponse<T> {
  ok: boolean;
  result: T;
  description?: string;
}
