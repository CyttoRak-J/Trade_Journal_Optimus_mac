import { describe, expect, it } from "vitest";
import { createPropDemo } from "../src/lib/prop-demo";
import { cashMovements, cashSummary, payoutProgress } from "../src/lib/prop-firms";

describe("isolated prop demo preview", () => {
  it("produces deterministic, independent fictional data with useful cash and payout scenarios", () => {
    const demo = createPropDemo("2026-09-07");
    expect(createPropDemo(demo.today)).toEqual(demo);
    expect(new Set(demo.accounts.map((a) => a.firm)).size).toBe(3);
    expect(
      demo.accounts.every((a) => a.firm.endsWith("(Demo)") && a.journalAccountId === null),
    ).toBe(true);
    expect(demo.accounts.some((a) => a.archived && a.status === "breached")).toBe(true);
    expect(demo.accounts.some((a) => a.renewalOn && a.renewalOn > demo.today)).toBe(true);
    expect(new Set(demo.entries.map((e) => e.status))).toEqual(
      new Set(["completed", "approved", "requested", "rejected", "cancelled"]),
    );
    const cash = cashMovements(demo.entries, demo.receipts);
    for (const currency of ["USD", "EUR"]) {
      const summary = cashSummary(cash.filter((c) => c.currency === currency));
      expect(summary.spent).toBeGreaterThan(0);
      expect(summary.received).toBeGreaterThan(summary.spent);
    }
    expect(cashSummary(cash.filter((c) => c.currency === "USD")).refunds).toBe(45000);
    const partial = payoutProgress(demo.entries, demo.receipts, demo.today).find((p) => p.partial);
    expect(partial).toMatchObject({
      overdue: true,
      expected: 111000,
      actual: 45000,
      remaining: 66000,
    });
    expect(demo.receipts.some((r) => r.kind === "reversal")).toBe(true);
    demo.accounts[0]!.name = "Edited copy";
    expect(createPropDemo(demo.today).accounts[0]?.name).not.toBe("Edited copy");
  });
  it.each(["2026-09-07", "2024-02-29", "2027-01-01"])(
    "keeps historical dates and relationships valid relative to %s",
    (today) => {
      const d = createPropDemo(today),
        accounts = new Map(d.accounts.map((a) => [a.id, a])),
        entries = new Map(d.entries.map((e) => [e.id, e]));
      expect(new Set([...d.accounts, ...d.entries, ...d.receipts].map((r) => r.id)).size).toBe(
        d.accounts.length + d.entries.length + d.receipts.length,
      );
      for (const a of d.accounts) {
        expect(a.openedOn <= today).toBe(true);
        if (a.parentId) expect(accounts.get(a.parentId)!.openedOn <= a.openedOn).toBe(true);
      }
      for (const e of d.entries) {
        expect(e.occurredOn <= today).toBe(true);
        if (e.accountId) expect(e.occurredOn >= accounts.get(e.accountId)!.openedOn).toBe(true);
        if (e.parentId)
          expect(entries.get(e.parentId)!.amountMinor).toBeGreaterThanOrEqual(e.amountMinor);
      }
      for (const r of d.receipts) {
        expect(r.occurredOn <= today).toBe(true);
        expect(r.occurredOn >= entries.get(r.payoutId)!.occurredOn).toBe(true);
      }
    },
  );
});
