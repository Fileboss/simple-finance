// Même forme que l'export CSV du Sheet (chiffres fictifs) : espaces insécables,
// virgule décimale, colonne du mois à venir vide, lignes de contrôle sous le total.
const nb = " ";
export const SAMPLE = [
  `,décembre 2025,janvier 2026,février 2026,mars 2026`,
  `Livret,"1${nb}000,00 €","1${nb}100,00 €","1${nb}100,00 €",`,
  `PEA,"500,50 €","480,25 €","530,00 €",`,
  `Total,"1${nb}500,50 €","1${nb}580,25 €","1${nb}630,00 €",`,
  `,,,,`,
  `plusvalue,,"79,75 €","49,75 €",`,
  `plusvalue %,,"5,03%","3,05%",`,
  `pluevalue janvier,,,"49,75 €",`,
  `plus value janvier %,,,"3,15%",`,
].join("\r\n");
