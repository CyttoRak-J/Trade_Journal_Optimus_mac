import { RESOLUTIONS, type MarketHistory } from "./market-data";

/** Only revealed candles and fills are passed to the renderer. */
export function replayFrame<T extends { executedAt: string }>(
  history: MarketHistory,
  fills: T[],
  count: number,
) {
  const visible = history.bars.slice(
    0,
    Math.max(0, Math.min(history.bars.length, Math.floor(count))),
  );
  const through = visible.length
    ? visible.at(-1)!.time + RESOLUTIONS[history.resolution]
    : -Infinity;
  return {
    bars: visible,
    through,
    fills: fills.filter((fill) => Date.parse(fill.executedAt) <= through),
  };
}
