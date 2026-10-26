// Un mois est une chaîne « YYYY-MM », ce qui permet de les comparer et trier
// comme des chaînes.

const NAMES = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const SHORT = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
const PLAIN = NAMES.map(stripAccents);

function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

export function isMonth(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
}

export function addMonths(month: string, n: number): string {
  const t = Number(month.slice(0, 4)) * 12 + Number(month.slice(5)) - 1 + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}

export function monthRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let m = from; m <= to; m = addMonths(m, 1)) out.push(m);
  return out;
}

export function currentMonth(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export const monthLabel = (m: string) => `${NAMES[Number(m.slice(5)) - 1]} ${m.slice(0, 4)}`;
export const shortMonthLabel = (m: string) => `${SHORT[Number(m.slice(5)) - 1]} ${m.slice(2, 4)}`;

/** Lit un en-tête de colonne du Sheet : « décembre 2025 », « Aout 2026 », « 12/2025 », « 2025-12 ». */
export function parseMonthLabel(input: string): string | null {
  const s = stripAccents(input.trim().toLowerCase());
  if (isMonth(s)) return s;
  let m = /^(\d{1,2})[/.-](\d{4})$/.exec(s);
  if (m) {
    const month = `${m[2]}-${m[1]!.padStart(2, "0")}`;
    return isMonth(month) ? month : null;
  }
  m = /^([a-z]+)\.?\s+(\d{4})$/.exec(s);
  if (!m) return null;
  const word = m[1]!;
  let idx = PLAIN.indexOf(word);
  if (idx < 0 && word.length >= 3) {
    const candidates = PLAIN.flatMap((n, i) => (n.startsWith(word) ? [i] : []));
    if (candidates.length === 1) idx = candidates[0]!;
  }
  return idx < 0 ? null : `${m[2]}-${String(idx + 1).padStart(2, "0")}`;
}
