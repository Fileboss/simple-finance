import { describe, expect, test } from "bun:test";
import { compute, type AccountInput, type StatementInput } from "../src/calc.ts";

// A : suivi depuis décembre, capital de départ connu fin janvier.
// B : ouvert en février pendant le suivi.
const accounts: AccountInput[] = [
  { id: 1, closed: false, baselineMonth: "2026-01", baselineInvested: 105000 },
  { id: 2, closed: false, baselineMonth: null, baselineInvested: null },
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

  test("compte ouvert en cours de suivi : inexistant avant, valeur précédente 0 au premier mois", () => {
    expect(b[1]).toMatchObject({ state: "absent", value: null, variation: null, gain: null });
    expect(b[2]).toMatchObject({ state: "held", variation: 50000, gain: 0, ret: 0, variationPct: null });
    // Le total de janvier ne compte pas B et reste complet.
    expect(total[1]).toMatchObject({ incomplete: false, value: 110000 });
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
      [{ id: 1, closed: false, baselineMonth: null, baselineInvested: null }],
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

  test("compte oublié un mois : valeur inconnue, total incomplet, aucun gain ni perte fictifs", () => {
    const r = compute(
      [
        { id: 1, closed: false, baselineMonth: null, baselineInvested: null },
        { id: 2, closed: false, baselineMonth: null, baselineInvested: null },
      ],
      [
        { month: "2026-01", accountId: 1, value: 100000, deposits: 0 },
        { month: "2026-03", accountId: 1, value: 102000, deposits: 0 },
        { month: "2026-01", accountId: 2, value: 50000, deposits: 0 },
        { month: "2026-02", accountId: 2, value: 51000, deposits: 0 },
        { month: "2026-03", accountId: 2, value: 52000, deposits: 0 },
      ],
    );
    const a = r.byAccount.get(1)!;
    expect(a[1]).toMatchObject({ state: "missing", value: null, variation: null, gain: null, ret: null });
    expect(a[2]).toMatchObject({ state: "held", variation: null, gain: null, ret: null });
    // Février : valeur partielle affichée, mais pas de variation (sinon -100 000 € fictifs).
    expect(r.total[1]).toMatchObject({ incomplete: true, value: 51000, variation: null, gain: null, ret: null });
    // Mars : le mois précédent est incomplet, donc pas de variation non plus (sinon +100 000 € fictifs).
    expect(r.total[2]).toMatchObject({ incomplete: false, value: 154000, variation: null, gain: null });
    // Depuis janvier, la variation reste juste ; le gain demande les versements de février, inconnus.
    expect(r.total[2]).toMatchObject({ ytdVariation: 4000, ytdGain: null, ytdRet: null });
  });

  test("compte non clôturé sans relevé au dernier mois : manquant, pas zéro", () => {
    const r = compute(
      [
        { id: 1, closed: false, baselineMonth: null, baselineInvested: null },
        { id: 2, closed: false, baselineMonth: null, baselineInvested: null },
      ],
      [
        { month: "2026-01", accountId: 1, value: 100000, deposits: 0 },
        { month: "2026-01", accountId: 2, value: 50000, deposits: 0 },
        { month: "2026-02", accountId: 2, value: 51000, deposits: 0 },
      ],
    );
    expect(r.byAccount.get(1)![1]!.state).toBe("missing");
    expect(r.total[1]).toMatchObject({ incomplete: true, variation: null, gain: null });
  });

  test("compte clôturé : retrait du solde, gain nul, puis exclu du total", () => {
    const r = compute(
      [
        { id: 1, closed: true, baselineMonth: "2026-01", baselineInvested: 90000 },
        { id: 2, closed: false, baselineMonth: null, baselineInvested: null },
      ],
      [
        { month: "2026-01", accountId: 1, value: 100000, deposits: 0 },
        { month: "2026-02", accountId: 1, value: 0, deposits: -100000 },
        { month: "2026-01", accountId: 2, value: 50000, deposits: 0 },
        { month: "2026-02", accountId: 2, value: 151000, deposits: 100000 },
        { month: "2026-03", accountId: 2, value: 152000, deposits: 0 },
      ],
    );
    const a = r.byAccount.get(1)!;
    expect(a[1]).toMatchObject({ state: "held", value: 0, variation: -100000, gain: 0, ret: 0, invested: -10000, totalGain: 10000 });
    expect(a[2]).toMatchObject({ state: "absent", value: null, gain: null });
    // Février : 1 000 € transférés de A vers B, seul le gain de B (1 000 €) compte.
    expect(r.total[1]).toMatchObject({ incomplete: false, value: 151000, variation: 1000, deposits: 0, gain: 1000 });
    expect(r.total[2]).toMatchObject({ incomplete: false, value: 152000, variation: 1000, gain: 1000 });
    expect(r.total[2]!.ytdGain).toBe(2000);
  });
});
