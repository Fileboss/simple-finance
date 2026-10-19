import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { applySheet, checkSheet, parseCsv, parseSheet } from "../src/sheet.ts";
import { openStore } from "../src/store.ts";
import { SAMPLE } from "./fixtures.ts";

describe("parseCsv", () => {
  test("guillemets, séparateur et fins de ligne", () => {
    expect(parseCsv('a;"b;c";"d ""e"""\nf;;')).toEqual([["a", "b;c", 'd "e"'], ["f", "", ""]]);
  });
});

describe("parseSheet", () => {
  const data = parseSheet(SAMPLE);

  test("mois, comptes et lignes de contrôle", () => {
    expect(data.months).toEqual(["2025-12", "2026-01", "2026-02"]);
    expect(data.accounts).toEqual([
      { name: "Livret", values: [100000, 110000, 110000] },
      { name: "PEA", values: [50050, 48025, 53000] },
    ]);
    expect(data.total).toEqual([150050, 158025, 163000]);
    expect(data.variation).toEqual([null, 7975, 4975]);
    expect(data.ytdVariation).toEqual([null, null, 4975]);
  });

  test("contrôle : tout retombe sur le Sheet", () => {
    const checks = checkSheet(data);
    expect(checks).toHaveLength(6);
    expect(checks.filter((c) => c.actual !== c.expected)).toEqual([]);
  });

  test("contrôle : un centime d'écart est signalé", () => {
    const wrong = parseSheet(SAMPLE.replace('"1 630,00 €"', '"1 630,01 €"'));
    expect(checkSheet(wrong).filter((c) => c.actual !== c.expected)).toEqual([
      { label: "Total", month: "2026-02", expected: 163001, actual: 163000 },
    ]);
  });

  test("montant illisible : message avec ligne et mois", () => {
    expect(() => parseSheet(SAMPLE.replace('"480,25 €"', "abc"))).toThrow(/Ligne 3 \(« PEA »\), janvier 2026/);
  });

  test("applySheet : crée les comptes, versements inconnus, garde ceux déjà saisis", () => {
    const store = openStore(":memory:");
    const livret = store.addAccount("livret");
    store.saveStatement({ month: "2026-02", accountId: livret.id, value: 1, deposits: 2500 });
    applySheet(store, data);
    expect(store.accounts().map((a) => a.name)).toEqual(["livret", "PEA"]);
    const feb = store.statementsFor("2026-02");
    expect(feb.get(livret.id)).toEqual({ month: "2026-02", accountId: livret.id, value: 110000, deposits: 2500 });
    expect(store.statementsFor("2025-12").get(livret.id)?.deposits).toBeNull();
  });
});

// Export réel du Sheet, gardé hors du dépôt (public) : data/sheet.csv.
const real = "data/sheet.csv";
test.skipIf(!existsSync(real))("export réel du Sheet : totaux et variations identiques", () => {
  const data = parseSheet(readFileSync(real, "utf8"));
  const checks = checkSheet(data);
  expect(checks.length).toBeGreaterThan(0);
  expect(checks.filter((c) => c.actual !== c.expected)).toEqual([]);
});
