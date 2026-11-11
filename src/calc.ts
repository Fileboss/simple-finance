// Calculs du tableau de bord (voir « Calculs » dans le README). Fonctions pures :
// elles ne lisent que les comptes et relevés passés en argument.

import { monthRange } from "./months.ts";

export interface AccountInput {
  id: number;
  /** Clôturé : le compte n'existe plus après son dernier relevé (valeur 0). */
  closed: boolean;
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

/**
 * absent : le compte n'existe pas ce mois-là (avant son premier relevé, ou après
 * sa clôture) et n'entre pas dans le total. missing : il existe mais le relevé
 * manque, donc sa valeur est inconnue, jamais 0.
 */
export type State = "absent" | "held" | "missing";

/** Valeurs d'un compte (ou du total) pour un mois. null = non disponible. */
export interface Point {
  month: string;
  state: State;
  /** Pour le total incomplet : somme des valeurs connues, à afficher comme telle. */
  value: number | null;
  /** Total seulement : au moins un compte n'a pas de relevé ce mois-ci. */
  incomplete: boolean;
  deposits: number | null;
  variation: number | null;
  variationPct: number | null;
  gain: number | null;
  ret: number | null;
  ytdVariation: number | null;
  ytdVariationPct: number | null;
  /** Versements de février au mois. */
  ytdDeposits: number | null;
  ytdGain: number | null;
  ytdRet: number | null;
  /** Capital investi cumulé (versements depuis le départ). */
  invested: number | null;
  /** Plus-value cumulée : valeur − capital investi. */
  totalGain: number | null;
  /** Plus-value cumulée rapportée au capital investi. */
  totalGainPct: number | null;
}

export interface Computed {
  /** Mois contigus, du premier au dernier relevé. */
  months: string[];
  byAccount: Map<number, Point[]>;
  total: Point[];
}

interface Lane {
  state: State[];
  value: (number | null)[];
  /** absent → 0, manquant ou inconnu → null. */
  deposits: (number | null)[];
  invested: (number | null)[];
}

export function compute(accounts: AccountInput[], statements: StatementInput[]): Computed {
  if (statements.length === 0) return { months: [], byAccount: new Map(), total: [] };
  const sorted = statements.map((s) => s.month).sort();
  const months = monthRange(sorted[0]!, sorted.at(-1)!);
  const index = new Map(months.map((m, i) => [m, i]));

  const byAccount = new Map<number, Point[]>();
  const lanes = accounts.map((a) => {
    const own = new Map(statements.filter((s) => s.accountId === a.id).map((s) => [index.get(s.month)!, s]));
    const held = [...own.keys()];
    const first = held.length ? Math.min(...held) : Infinity;
    const last = held.length ? Math.max(...held) : -Infinity;
    const state = months.map((_, i): State => {
      if (own.has(i)) return "held";
      if (i < first || (a.closed && i > last)) return "absent";
      return "missing";
    });
    const lane: Lane = {
      state,
      value: months.map((_, i) => own.get(i)?.value ?? null),
      deposits: months.map((_, i) => (state[i] === "absent" ? 0 : (own.get(i)?.deposits ?? null))),
      invested: [],
    };
    lane.invested = investedLane(a, months, lane, first);
    byAccount.set(a.id, series(months, lane));
    return lane;
  });

  // Total : somme des comptes existants. Un relevé manquant le rend incomplet :
  // valeur partielle affichée, mais aucune variation ni aucun gain calculés.
  const incomplete = months.map((_, i) => lanes.some((l) => l.state[i] === "missing"));
  const partial = months.map((_, i) => sum(lanes.map((l) => l.value[i] ?? 0)));
  const existing = (i: number) => lanes.filter((l) => l.state[i] !== "absent");
  const total = series(months, {
    state: incomplete.map((x) => (x ? "missing" : "held")),
    value: months.map((_, i) => (incomplete[i] ? null : partial[i]!)),
    deposits: months.map((_, i) => sumOrNull(existing(i).map((l) => l.deposits[i]!))),
    invested: months.map((_, i) => sumOrNull(existing(i).map((l) => l.invested[i]!))),
  }).map((p, i) => ({ ...p, value: partial[i]!, incomplete: incomplete[i]! }));
  return { months, byAccount, total };
}

/**
 * Capital investi cumulé d'un compte. Point de départ : le capital déduit de la
 * performance (baseline), sinon le mois d'ouverture si le compte a été ouvert
 * pendant le suivi (valeur précédente nulle, versements du mois connus).
 */
function investedLane(a: AccountInput, months: string[], lane: Lane, first: number): (number | null)[] {
  const out: (number | null)[] = months.map(() => null);
  let start = -1;
  let base: number | null = null;
  if (a.baselineMonth !== null && a.baselineInvested !== null) {
    start = months.indexOf(a.baselineMonth);
    base = a.baselineInvested;
  } else if (first > 0 && first < months.length) {
    start = first;
    base = lane.deposits[first]!;
  }
  if (start < 0) return out;
  out[start] = base;
  for (let i = start + 1; i < months.length; i++) {
    const prev = out[i - 1]!;
    const d = lane.deposits[i]!;
    out[i] = lane.state[i] === "absent" || prev === null || d === null ? null : prev + d;
  }
  return out;
}

function series(months: string[], lane: Lane): Point[] {
  const { state, value, deposits } = lane;
  // Valeur de départ du mois i : 0 si le compte n'existait pas encore, inconnue si le relevé manque.
  const start = (i: number) => (i < 0 ? null : state[i] === "absent" ? 0 : value[i]!);
  const rets: (number | null)[] = [];
  return months.map((month, i) => {
    const v = value[i]!;
    const d = deposits[i]!;
    const prev = start(i - 1);
    const variation = v === null || prev === null ? null : v - prev;
    const gain = variation === null || d === null ? null : variation - d;
    // Dietz modifié simplifié : versements supposés en milieu de mois.
    const denom = prev === null || d === null ? 0 : prev + d / 2;
    const ret = gain !== null && denom > 0 ? gain / denom : null;
    // Un mois où le compte n'existe pas est neutre dans le chaînage.
    rets.push(state[i] === "absent" ? 0 : ret);

    // Depuis janvier : référence = relevé de janvier de l'année du mois.
    const jan = i - (Number(month.slice(5)) - 1);
    let ytdVariation = null, ytdVariationPct = null, ytdDeposits = null, ytdGain = null, ytdRet = null;
    if (jan >= 0 && i > jan) {
      const ref = start(jan);
      ytdVariation = v === null || ref === null ? null : v - ref;
      ytdVariationPct = ytdVariation !== null && ref ? ytdVariation / ref : null;
      ytdDeposits = sumOrNull(deposits.slice(jan + 1, i + 1));
      ytdGain = ytdVariation === null || ytdDeposits === null ? null : ytdVariation - ytdDeposits;
      ytdRet = rets.slice(jan + 1, i + 1).reduce<number | null>((acc, r) => (acc === null || r === null ? null : acc * (1 + r)), 1);
      if (ytdRet !== null) ytdRet -= 1;
    }

    const inv = lane.invested[i]!;
    const totalGain = inv === null || v === null ? null : v - inv;
    const point: Point = {
      month,
      state: state[i]!,
      value: v,
      incomplete: false,
      deposits: d,
      variation,
      variationPct: variation !== null && prev ? variation / prev : null,
      gain,
      ret,
      ytdVariation,
      ytdVariationPct,
      ytdDeposits,
      ytdGain,
      ytdRet,
      invested: inv,
      totalGain,
      totalGainPct: totalGain !== null && inv! > 0 ? totalGain / inv! : null,
    };
    return state[i] === "absent" ? { ...point, ...EMPTY, deposits: null } : point;
  });
}

const EMPTY = {
  value: null,
  variation: null,
  variationPct: null,
  gain: null,
  ret: null,
  ytdVariation: null,
  ytdVariationPct: null,
  ytdDeposits: null,
  ytdGain: null,
  ytdRet: null,
  invested: null,
  totalGain: null,
  totalGainPct: null,
};

/** Performance d'une année civile, hors versements. null = non disponible. */
export interface YearPoint {
  year: string;
  /** Mois couverts : le premier mois suivi n'a pas de mois précédent, il est exclu. */
  from: string;
  to: string;
  variation: number | null;
  deposits: number | null;
  /** Somme des gains mensuels : fin d'année − fin de l'année précédente − versements. */
  gain: number | null;
  /** Rendements mensuels chaînés de janvier à décembre (pondéré par le temps). */
  ret: number | null;
}

/**
 * Performance annuelle d'une série (compte ou total), de la plus récente à la plus
 * ancienne. Contrairement à « depuis janvier », le gain de janvier est compté. Un
 * mois inconnu rend l'année indisponible ; un mois où le compte n'existe pas est neutre.
 */
export function yearly(points: Point[]): YearPoint[] {
  const years = new Map<string, YearPoint>();
  for (const [i, p] of points.entries()) {
    if (i === 0 || p.state === "absent") continue;
    const year = p.month.slice(0, 4);
    const y = years.get(year);
    if (!y) {
      years.set(year, { year, from: p.month, to: p.month, variation: p.variation, deposits: p.deposits, gain: p.gain, ret: p.ret });
      continue;
    }
    y.to = p.month;
    y.variation = sumOrNull([y.variation, p.variation]);
    y.deposits = sumOrNull([y.deposits, p.deposits]);
    y.gain = sumOrNull([y.gain, p.gain]);
    y.ret = y.ret === null || p.ret === null ? null : (1 + y.ret) * (1 + p.ret) - 1;
  }
  return [...years.values()].reverse();
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
