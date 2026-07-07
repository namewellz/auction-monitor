declare module 'cycletls' {
  export interface CycleTLSResponse {
    status: number;
    body: string;
  }

  export interface CycleTLSClient {
    (url: string, options: Record<string, unknown>, method: string): Promise<CycleTLSResponse>;
    exit(): Promise<void>;
  }

  export default function initCycleTLS(): Promise<CycleTLSClient>;
}
