import type { TelegramApiResponse, TelegramUpdate } from '../types/telegram.js';

export class TelegramClient {
  private readonly baseUrl: string;

  public constructor(token: string) {
    this.baseUrl = `https://api.telegram.org/bot${token}`;
  }

  public async getUpdates(offset: number | undefined): Promise<TelegramUpdate[]> {
    const params = new URLSearchParams({
      timeout: '30',
      allowed_updates: JSON.stringify(['message']),
    });

    if (offset !== undefined) {
      params.set('offset', String(offset));
    }

    const response = await this.request<TelegramUpdate[]>(`getUpdates?${params.toString()}`);
    return response;
  }

  public async sendMessage(chatId: number, text: string): Promise<void> {
    await this.request('sendMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        disable_web_page_preview: true,
      }),
    });
  }

  private async request<T>(method: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${this.baseUrl}/${method}`, init);
    const body = (await response.json()) as TelegramApiResponse<T>;

    if (!response.ok || !body.ok) {
      throw new Error(body.description ?? `Telegram API failed: ${response.status}`);
    }

    return body.result;
  }
}
