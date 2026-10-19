// Tous les montants sont des centimes entiers. Les flottants n'apparaissent
// qu'à l'affichage et dans les ratios (pourcentages).

/**
 * Lit un montant saisi ou exporté par le Sheet : « 14 180,00 € », « -55,99 »,
 * « 1234.5 ». Renvoie des centimes, ou null pour une chaîne vide.
 */
export function parseCents(input: string): number | null {
  let s = input.replace(/[\s  €]/g, "").replace(/−/g, "-");
  if (s === "") return null;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  const m = /^([+-]?)(\d+)(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) throw new Error(`Montant invalide : « ${input.trim()} »`);
  const cents = Number(m[2]) * 100 + Number((m[3] ?? "").padEnd(2, "0"));
  return m[1] === "-" && cents !== 0 ? -cents : cents;
}

/** Lit un pourcentage : « 15 », « +15,23 % ». Renvoie le nombre de points (15.23). */
export function parsePercent(input: string): number | null {
  const s = input.replace(/[\s  %+]/g, "").replace(/−/g, "-").replace(",", ".");
  if (s === "") return null;
  if (!/^-?\d+(\.\d+)?$/.test(s)) throw new Error(`Pourcentage invalide : « ${input.trim()} »`);
  return Number(s);
}

/** Centimes vers la forme éditable d'un champ : 1718000 → « 17000,00 ». */
export function centsToInput(cents: number): string {
  const abs = Math.abs(cents);
  return `${cents < 0 ? "-" : ""}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, "0")}`;
}

/** Capital investi déduit de la performance affichée par l'appli du compte. */
export function investedFromPerformance(valueCents: number, perfPercent: number): number {
  if (perfPercent <= -100) throw new Error("La performance doit être supérieure à -100 %");
  return Math.round(valueCents / (1 + perfPercent / 100));
}

const EUR = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" });
const EUR_SIGNED = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", signDisplay: "exceptZero" });
const PCT_SIGNED = new Intl.NumberFormat("fr-FR", {
  style: "percent",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  signDisplay: "exceptZero",
});

export const eur = (cents: number) => EUR.format(cents / 100);
export const signedEur = (cents: number) => EUR_SIGNED.format(cents / 100);
export const signedPct = (ratio: number) => PCT_SIGNED.format(ratio);
