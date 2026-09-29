import type { MarketHistory, Resolution } from "@/lib/market-data";

export interface HistoryRequest {
  symbol: string;
  dataset?: string;
  resolution: Resolution;
  from: number;
  to: number;
  signal?: AbortSignal;
}

/** Adapters supply data only. Chart rendering and analytics do not depend on an adapter. */
export interface MarketDataProvider {
  id: string;
  name: string;
  environmentKey: string;
  history(request: HistoryRequest, apiKey: string): Promise<MarketHistory>;
  test(apiKey: string): Promise<void>;
}

export class MarketDataError extends Error {}
