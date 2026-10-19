// Reprise de l'historique depuis l'export CSV du Google Sheet : une ligne par
// compte, une colonne par mois, puis la ligne « Total » et les lignes de
// variation, qui servent de contrôle.

import { compute } from "./calc.ts";
import { investedFromPerformance, parseCents } from "./money.ts";
import { monthLabel, parseMonthLabel } from "./months.ts";
import type { Store } from "./store.ts";

export interface SheetData {
  months: string[];
  accounts: { name: string; values: (number | null)[] }[];
  /** Lignes de contrôle du Sheet, alignées sur months (null si absentes). */
  total: (number | null)[] | null;
  variation: (number | null)[] | null;
  ytdVariation: (number | null)[] | null;
}

export interface Check {
  label: string;
  month: string;
  expected: number;
  actual: number | null;
}

export function parseCsv(text: string): string[][] {
  text = text.replace(/^﻿/, "");
  const header = text.slice(0, text.search(/\r?\n|$/));
  const delim = [";", "\t", ","].find((d) => header.includes(d)) ?? ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delim) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

const normalize = (s: string) =>
  s.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ");

export function parseSheet(text: string): SheetData {
  const rows = parseCsv(text);
  const h = rows.findIndex((r) => r.slice(1).some((c) => parseMonthLabel(c) !== null));
  if (h < 0) throw new Error("Aucune ligne d'en-tête avec des mois (ex. « décembre 2025 ») n'a été trouvée.");
  const cols = rows[h]!.flatMap((c, j) => {
    const month = j > 0 ? parseMonthLabel(c) : null;
    return month ? [{ j, month }] : [];
  });

  const accounts: SheetData["accounts"] = [];
  let total: (number | null)[] | null = null;
  let variation: (number | null)[] | null = null;
  let ytdVariation: (number | null)[] | null = null;
  for (const [r, row] of rows.slice(h + 1).entries()) {
    const label = (row[0] ?? "").trim();
    if (!label) continue;
    const norm = normalize(label);
    if (total !== null && norm.includes("%")) continue;
    const values = cols.map(({ j, month }) => {
      try {
        return parseCents(row[j] ?? "");
      } catch (e) {
        throw new Error(`Ligne ${h + r + 2} (« ${label} »), ${monthLabel(month)} : ${(e as Error).message}`);
      }
    });
    if (total === null) {
      if (norm === "total") total = values;
      else accounts.push({ name: label, values });
    } else if (norm.includes("janvier")) ytdVariation = values;
    else if (/^plu/.test(norm)) variation = values;
  }
  if (accounts.length === 0) throw new Error("Aucun compte trouvé sous la ligne des mois.");

  // On écarte les mois encore vides (ex. la colonne du mois à venir).
  const keep = cols.map((_, k) => accounts.some((a) => a.values[k] !== null));
  const pick = <T,>(xs: T[]) => xs.filter((_, k) => keep[k]);
  return {
    months: pick(cols.map((c) => c.month)),
    accounts: accounts.map((a) => ({ name: a.name, values: pick(a.values) })),
    total: total && pick(total),
    variation: variation && pick(variation),
    ytdVariation: ytdVariation && pick(ytdVariation),
  };
}

/**
 * Recalcule le total et les variations brutes avec les calculs de l'app et les
 * compare aux lignes du Sheet. Toute différence, même d'un centime, est remontée.
 */
export function checkSheet(data: SheetData): Check[] {
  const accounts = data.accounts.map((_, id) => ({ id, closed: false, baselineMonth: null, baselineInvested: null }));
  const statements = data.accounts.flatMap((a, id) =>
    a.values.flatMap((value, k) => (value === null ? [] : [{ month: data.months[k]!, accountId: id, value, deposits: null }])),
  );
  const { months, total } = compute(accounts, statements);
  const point = (m: string) => total[months.indexOf(m)];
  const rows: [string, (number | null)[] | null, (m: string) => number | null][] = [
    ["Total", data.total, (m) => (point(m)?.incomplete ? null : (point(m)?.value ?? null))],
    ["Variation", data.variation, (m) => point(m)?.variation ?? null],
    ["Variation depuis janvier", data.ytdVariation, (m) => point(m)?.ytdVariation ?? null],
  ];
  return rows.flatMap(([label, expected, actual]) =>
    (expected ?? []).flatMap((e, k) => (e === null ? [] : [{ label, month: data.months[k]!, expected: e, actual: actual(data.months[k]!) }])),
  );
}

/** Capital investi de départ saisi à l'import : performance affichée (%) ou montant. */
export interface Baseline {
  perf: number | null;
  invested: number | null;
}

/** Dernier mois importé d'un compte : c'est à cette date que l'appli affiche sa performance. */
export function lastValue(data: SheetData, index: number): { month: string; value: number } | null {
  const values = data.accounts[index]!.values;
  for (let k = values.length - 1; k >= 0; k--) {
    const value = values[k];
    if (value !== null && value !== undefined) return { month: data.months[k]!, value };
  }
  return null;
}

/**
 * Crée les comptes manquants et enregistre les valeurs, avec des versements
 * inconnus. baselines (alignées sur data.accounts) fixent le capital de départ
 * au dernier mois importé de chaque compte.
 */
export function applySheet(store: Store, data: SheetData, baselines: (Baseline | undefined)[] = []): void {
  store.transaction(() => {
    data.accounts.forEach((a, i) => {
      const account = store.accountByName(a.name) ?? store.addAccount(a.name);
      a.values.forEach((value, k) => {
        if (value !== null) store.importValue(data.months[k]!, account.id, value);
      });
      const b = baselines[i];
      const last = lastValue(data, i);
      if (!b || !last || (b.perf === null && b.invested === null)) return;
      store.updateAccount({
        ...account,
        baselineMonth: last.month,
        baselineInvested: b.perf !== null ? investedFromPerformance(last.value, b.perf) : b.invested,
        baselinePerf: b.perf,
      });
    });
  });
}
