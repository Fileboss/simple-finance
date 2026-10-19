// Calculs du tableau de bord (voir « Calculs » dans le README). Fonctions pures :
// elles ne lisent que les comptes et relevés passés en argument.

import { monthRange } from "./months.ts";

export interface AccountInput {
  id: number;
  /** Capital investi (centimes) à la fin de baselineMonth, déduit de la performance affichée. */
  baselineMonth: string | null;
  baselineInvested: number | null;
}

export interface StatementInput {
  month: string;
  accountId: number;
  value: number;
  /** Versements nets du mois ; null = inconnu (historique importé). */
  deposits: number | null;
}

/** Valeurs d'un compte (ou du total) pour un mois. null = non disponible. */
export interface Point {
  month: string;
  /** false si le compte n'a pas de relevé ce mois-ci (valeur et versements comptés à 0). */
  held: boolean;
  value: number;
  deposits: number | null;
  variation: number | null;
  variationPct: number | null;
  gain: number | null;
  ret: number | null;
  ytdVariation: number | null;
  ytdVariationPct: number | null;
  ytdGain: number | null;
  ytdRet: number | null;
  /** Capital investi cumulé (versements depuis le départ). */
  invested: number | null;
  /** Plus-value cumulée : valeur − capital investi. */
  totalGain: number | null;
}

export interface Computed {
  /** Mois contigus, du premier au dernier relevé. */
  months: string[];
  byAccount: Map<number, Point[]>;
  total: Point[];
}

export function compute(accounts: AccountInput[], statements: StatementInput[]): Computed {
  if (statements.length === 0) return { months: [], byAccount: new Map(), total: [] };
  const sorted = statements.map((s) => s.month).sort();
  const months = monthRange(sorted[0]!, sorted.at(-1)!);
  const index = new Map(months.map((m, i) => [m, i]));

  const byAccount = new Map<number, Point[]>();
  const raw = accounts.map((a) => {
    const held = months.map(() => false);
    const value = months.map(() => 0);
    const deposits: (number | null)[] = months.map(() => 0);
    for (const s of statements) {
      if (s.accountId !== a.id) continue;
      const i = index.get(s.month)!;
      held[i] = true;
      value[i] = s.value;
      deposits[i] = s.deposits;
    }
    const invested = investedSeries(a, months, held, deposits);
    byAccount.set(a.id, series(months, held, value, deposits, invested));
    return { held, value, deposits, invested };
  });

  // Total : valeurs, versements et capital s'additionnent ; un seul inconnu rend la somme inconnue.
  const total = series(
    months,
    months.map(() => true),
    months.map((_, i) => sum(raw.map((r) => r.value[i]!))),
    months.map((_, i) => sumOrNull(raw.map((r) => r.deposits[i]!))),
    months.map((_, i) =>
      sumOrNull(raw.filter((r) => r.held.slice(0, i + 1).some(Boolean)).map((r) => r.invested[i]!)),
    ),
  );
  return { months, byAccount, total };
}

/**
 * Capital investi cumulé d'un compte. Point de départ : le capital déduit de la
 * performance (baseline), sinon le mois d'ouverture si le compte a été ouvert
 * pendant le suivi (valeur précédente nulle, versements du mois connus).
 */
function investedSeries(a: AccountInput, months: string[], held: boolean[], deposits: (number | null)[]) {
  const out: (number | null)[] = months.map(() => null);
  let start = -1;
  let base: number | null = null;
  if (a.baselineMonth !== null && a.baselineInvested !== null) {
    start = months.indexOf(a.baselineMonth);
    base = a.baselineInvested;
  } else {
    const first = held.indexOf(true);
    if (first > 0) {
      start = first;
      base = deposits[first]!;
    }
  }
  if (start < 0) return out;
  out[start] = base;
  for (let i = start + 1; i < months.length; i++) {
    const prev = out[i - 1]!;
    const d = deposits[i]!;
    out[i] = prev === null || d === null ? null : prev + d;
  }
  return out;
}

function series(
  months: string[],
  held: boolean[],
  value: number[],
  deposits: (number | null)[],
  invested: (number | null)[],
): Point[] {
  const rets: (number | null)[] = [];
  return months.map((month, i) => {
    const v = value[i]!;
    const d = deposits[i]!;
    const prev = i > 0 ? value[i - 1]! : null;
    const variation = prev === null ? null : v - prev;
    const gain = variation === null || d === null ? null : variation - d;
    // Dietz modifié simplifié : versements supposés en milieu de mois.
    const denom = prev === null || d === null ? 0 : prev + d / 2;
    const ret = gain !== null && denom > 0 ? gain / denom : null;
    rets.push(ret);

    // Depuis janvier : référence = relevé de janvier de l'année du mois.
    const jan = i - (Number(month.slice(5)) - 1);
    let ytdVariation = null, ytdVariationPct = null, ytdGain = null, ytdRet = null;
    if (jan >= 0 && i > jan) {
      const ref = value[jan]!;
      ytdVariation = v - ref;
      ytdVariationPct = ref !== 0 ? ytdVariation / ref : null;
      const d = sumOrNull(deposits.slice(jan + 1, i + 1));
      ytdGain = d === null ? null : ytdVariation - d;
      ytdRet = rets.slice(jan + 1, i + 1).reduce<number | null>((acc, r) => (acc === null || r === null ? null : acc * (1 + r)), 1);
      if (ytdRet !== null) ytdRet -= 1;
    }

    const inv = invested[i]!;
    return {
      month,
      held: held[i]!,
      value: v,
      deposits: d,
      variation,
      variationPct: variation !== null && prev ? variation / prev : null,
      gain,
      ret,
      ytdVariation,
      ytdVariationPct,
      ytdGain,
      ytdRet,
      invested: inv,
      totalGain: inv === null ? null : v - inv,
    };
  });
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

function sumOrNull(xs: (number | null)[]): number | null {
  let s = 0;
  for (const x of xs) {
    if (x === null) return null;
    s += x;
  }
  return s;
}
