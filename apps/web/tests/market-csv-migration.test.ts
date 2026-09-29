import { afterAll, expect, it } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const previousDir = process.env.JOURNAL_DATA_DIR;
const scratch = mkdtempSync(join(tmpdir(), "journal-csv-upgrade-"));
process.env.JOURNAL_DATA_DIR = scratch;
const legacy = new Database(join(scratch, "journal.db"));
legacy.exec(`CREATE TABLE market_csv_datasets (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, symbol TEXT NOT NULL,
  resolution TEXT NOT NULL, currency TEXT NOT NULL, price_basis TEXT NOT NULL,
  bars_json TEXT NOT NULL, imported_at TEXT NOT NULL
)`);
const barsJson = JSON.stringify([
  { time: 1735689600000, open: 100, high: 104, low: 98, close: 102, volume: 0 },
]);
legacy
  .prepare("INSERT INTO market_csv_datasets VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
  .run("legacy", "legacy.csv", "TEST", "1m", "USD", "raw", barsJson, "2025-01-01");
legacy.close();
const { db, marketCsvDatasets } = await import("../src/db");
const { csvDatasets } = await import("../src/server/market-data/csv");
it("backfills existing CSV metadata without modifying candle data", () => {
  expect(csvDatasets()).toMatchObject([
    { id: "legacy", count: 1, from: "2025-01-01T00:00:00.000Z", to: "2025-01-01T00:01:00.000Z" },
  ]);
  expect(db.select().from(marketCsvDatasets).get()?.barsJson).toBe(barsJson);
});
afterAll(() => {
  db.$client.close();
  if (previousDir === undefined) delete process.env.JOURNAL_DATA_DIR;
  else process.env.JOURNAL_DATA_DIR = previousDir;
  rmSync(scratch, { recursive: true, force: true });
});
