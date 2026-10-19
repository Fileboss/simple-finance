import { describe, expect, test } from "bun:test";
import { compute, type AccountInput, type StatementInput } from "../src/calc.ts";

// A : suivi depuis décembre, capital de départ connu fin janvier.
// B : ouvert en février pendant le suivi.
const accounts: AccountInput[] = [
  { id: 1, baselineMonth: "2026-01", baselineInvested: 105000 },
  { id: 2, baselineMonth: null, baselineInvested: null },
];
const statements: StatementInput[] = [
  { month: "2025-12", accountId: 1, value: 100000, deposits: null },
  { month: "2026-01", accountId: 1, value: 110000, deposits: 5000 },
  { month: "2026-02", accountId: 1, value: 120000, deposits: 0 },
  { month: "2026-03", accountId: 1, value: 115000, deposits: -10000 },
  { month: "2026-02", accountId: 2, value: 50000, deposits: 50000 },
  { month: "2026-03", accountId: 2, value: 51000, deposits: 0 },
];
const { months, byAccount, total } = compute(accounts, statements);
const a = byAccount.get(1)!;
const b = byAccount.get(2)!;

describe("compute", () => {
  test("mois contigus du premier au dernier relevé", () => {
    expect(months).toEqual(["2025-12", "2026-01", "2026-02", "2026-03"]);
  });

  test("premier mois : pas de variation", () => {
    expect(a[0]).toMatchObject({ value: 100000, variation: null, gain: null, ret: null });
  });

  test("variation brute, gain hors versements et rendement de Dietz", () => {
    expect(a[1]).toMatchObject({ variation: 10000, variationPct: 0.1, gain: 5000 });
    expect(a[1]!.ret).toBeCloseTo(5000 / (100000 + 2500), 12);
    // Retrait de 100 € : la variation brute est négative mais le gain positif.
    expect(a[3]).toMatchObject({ variation: -5000, gain: 5000 });
    expect(a[3]!.ret).toBeCloseTo(5000 / (120000 - 5000), 12);
  });

  test("depuis janvier : référence = relevé de janvier, rendements chaînés", () => {
    expect(a[1]).toMatchObject({ ytdVariation: null, ytdGain: null, ytdRet: null });
    expect(a[2]).toMatchObject({ ytdVariation: 10000, ytdGain: 10000 });
    expect(a[3]).toMatchObject({ ytdVariation: 5000, ytdGain: 15000 });
    expect(a[3]!.ytdVariationPct).toBeCloseTo(5000 / 110000, 12);
    expect(a[3]!.ytdRet).toBeCloseTo((1 + 10000 / 110000) * (1 + 5000 / 115000) - 1, 12);
  });

  test("compte ouvert dans le mois : rendement nul si la valeur égale le versement", () => {
    expect(b[1]).toMatchObject({ held: false, value: 0, variation: 0 });
    expect(b[2]).toMatchObject({ held: true, variation: 50000, gain: 0, ret: 0, variationPct: null });
  });

  test("capital investi : départ déduit, puis versements cumulés", () => {
    expect(a.map((p) => p.invested)).toEqual([null, 105000, 105000, 95000]);
    expect(a[3]!.totalGain).toBe(20000);
    expect(b.map((p) => p.invested)).toEqual([null, null, 50000, 50000]);
    expect(b[3]!.totalGain).toBe(1000);
  });

  test("total : sommes, puis mêmes formules", () => {
    expect(total.map((p) => p.value)).toEqual([100000, 110000, 170000, 166000]);
    expect(total[2]).toMatchObject({ deposits: 50000, variation: 60000, gain: 10000 });
    expect(total[2]!.ret).toBeCloseTo(10000 / (110000 + 25000), 12);
    expect(total[3]!.gain).toBe(a[3]!.gain! + b[3]!.gain!);
    // B n'existe pas encore en janvier : il ne rend pas le capital total inconnu.
    expect(total.map((p) => p.invested)).toEqual([null, 105000, 155000, 145000]);
  });

  test("versements inconnus : gain et rendement non disponibles, variation brute conservée", () => {
    const r = compute(
      [{ id: 1, baselineMonth: null, baselineInvested: null }],
      [
        { month: "2026-01", accountId: 1, value: 1000, deposits: null },
        { month: "2026-02", accountId: 1, value: 1500, deposits: null },
        { month: "2026-03", accountId: 1, value: 1600, deposits: 0 },
      ],
    ).total;
    expect(r[1]).toMatchObject({ variation: 500, gain: null, ret: null, ytdVariation: 500, ytdGain: null, ytdRet: null });
    expect(r[2]).toMatchObject({ variation: 100, gain: 100, ytdVariation: 600, ytdGain: null, ytdRet: null });
  });

  test("aucun relevé", () => {
    expect(compute(accounts, [])).toEqual({ months: [], byAccount: new Map(), total: [] });
  });
});
