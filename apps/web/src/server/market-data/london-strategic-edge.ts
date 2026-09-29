import { RESOLUTIONS, type MarketBar } from "@/lib/market-data";
import { MarketDataError, type MarketDataProvider } from "./provider";

import { readJson } from "./http";

const BASE = "https://api.londonstrategicedge.com/vault";
const MAX_PAGES = 12;
const MAX_BARS = 20_000;
const DAY = 86_400_000;
const utcDate = (time: number) => new Date(time).toISOString().slice(0, 10);

async function read(path: string, key: string, signal?: AbortSignal): Promise<unknown> {
  return readJson(
    `${BASE}${path}`,
    {
      "x-api-key": key,
      "User-Agent": "LuxAlgo-Trade-Journal/market-data",
    },
    signal,
    { timeoutMs: 60_000, cache: path !== "/usage" },
  );
}

export function parseLseBars(value: unknown): MarketBar[] {
  if (!Array.isArray(value)) throw new MarketDataError("Unexpected market data response.");
  const bars = value.map((item: unknown) => {
    if (!item || typeof item !== "object") throw new MarketDataError("Invalid market data candle.");
    const row = item as Record<string, unknown>;
    const raw = row.ts ?? row.timestamp ?? row.minute;
    // The vault returns UTC SQL timestamps without a zone.
    const stamp = typeof raw === "string" ? raw.replace(" ", "T") : "";
    const time = Date.parse(/[zZ]$|[+-]\d{2}:\d{2}$/.test(stamp) ? stamp : `${stamp}Z`);
    const number = (v: unknown) =>
      typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
    const bar = {
      time,
      open: number(row.open),
      high: number(row.high),
      low: number(row.low),
      close: number(row.close),
      volume: row.volume == null ? 0 : number(row.volume),
    };
    if (
      !Object.values(bar).every(Number.isFinite) ||
      bar.volume < 0 ||
      bar.low > Math.min(bar.open, bar.close) ||
      bar.high < Math.max(bar.open, bar.close) ||
      bar.low > bar.high
    ) {
      throw new MarketDataError("Invalid market data candle. Estimates were not calculated.");
    }
    return bar;
  });
  const unique = new Map<number, MarketBar>();
  for (const bar of bars) {
    const prior = unique.get(bar.time);
    if (prior && JSON.stringify(prior) !== JSON.stringify(bar))
      throw new MarketDataError("Conflicting candles returned by the provider.");
    unique.set(bar.time, bar);
  }
  return [...unique.values()].sort((a, b) => a.time - b.time);
}

export const londonStrategicEdge: MarketDataProvider = {
  id: "london-strategic-edge",
  name: "London Strategic Edge",
  environmentKey: "LSE_API_KEY",
  async test(key) {
    await read("/usage", key);
  },
  async history(request, key) {
    const step = RESOLUTIONS[request.resolution];
    const firstBar = Math.floor(request.from / step) * step;
    const lastBar = Math.floor((request.to - 1) / step) * step;
    let cursor = Math.floor(request.from / DAY) * DAY;
    const end = (Math.floor((request.to - 1) / DAY) + 1) * DAY;
    // The live vault accepts YYYY-MM-DD only, despite the SDK's ISO timestamp examples.
    // Keep each window near 1,000 possible bars (at least one whole UTC day).
    const windowDays = Math.max(1, Math.floor((1000 * step) / DAY));
    const bars: MarketBar[] = [];
    let clipped = false;
    const signal = request.signal
      ? AbortSignal.any([request.signal, AbortSignal.timeout(90_000)])
      : AbortSignal.timeout(90_000);
    for (let page = 0; page < MAX_PAGES / 2 && cursor < end && bars.length < MAX_BARS; page++) {
      const windowEnd = Math.min(end, cursor + windowDays * DAY);
      const params = new URLSearchParams({
        symbol: request.symbol,
        timeframe: request.resolution,
        start: utcDate(cursor),
        end: utcDate(windowEnd),
        order: "asc",
        limit: "5000",
      });
      if (request.dataset) params.set("dataset", request.dataset);
      const headPath = `/candles?${params}`;
      params.set("order", "desc");
      const pair = new AbortController();
      const pageSignal = AbortSignal.any([signal, pair.signal]);
      let pages: unknown[];
      try {
        pages = await Promise.all([
          read(headPath, key, pageSignal),
          read(`/candles?${params}`, key, pageSignal),
        ]);
      } finally {
        pair.abort();
      }
      const [head, tail] = pages.map(parseLseBars) as [MarketBar[], MarketBar[]];
      // Check both ends: a plan can silently cap rows below the requested 5,000.
      // Overlapping ascending/descending pages cover the window's recorded rows;
      // non-overlapping pages cannot establish coverage and must not yield estimates.
      const headTimes = new Set(head.map((bar) => bar.time));
      if (
        head.length !== tail.length ||
        (head.length > 0 && !tail.some((bar) => headTimes.has(bar.time)))
      )
        clipped = true;
      const unique = new Map<number, MarketBar>();
      for (const bar of [...head, ...tail]) {
        const prior = unique.get(bar.time);
        if (prior && JSON.stringify(prior) !== JSON.stringify(bar))
          throw new MarketDataError("Conflicting candles returned by the provider.");
        unique.set(bar.time, bar);
      }
      const rows = [...unique.values()].sort((a, b) => a.time - b.time);
      if (rows.some((bar) => bar.time % step !== 0))
        throw new MarketDataError("Provider returned candles at an unexpected resolution.");
      if (rows.some((bar) => bar.time < cursor || bar.time >= windowEnd))
        throw new MarketDataError("Provider returned candles outside the requested date window.");
      const eligible = rows.filter((bar) => bar.time >= firstBar && bar.time <= lastBar);
      bars.push(...eligible);
      cursor = windowEnd;
    }
    if (bars.length > MAX_BARS)
      throw new MarketDataError("Provider exceeded the requested candle limit.");
    return {
      provider: this.name,
      symbol: request.symbol,
      resolution: request.resolution,
      bars,
      fetchedAt: new Date().toISOString(),
      truncated: clipped || cursor < end,
      warnings: [
        "Provider prices may differ from your execution venue. Verify the exact instrument, contract, quote currency and price adjustment basis.",
        "LSE stock and ETF candles are split adjusted. Historical fills must use the same adjustment basis for estimates.",
        ...(clipped || cursor < end
          ? [
              "History reached a provider or request limit. Select a coarser resolution; estimates are unavailable for incomplete history.",
            ]
          : []),
      ],
    };
  },
};
