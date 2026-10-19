// Import ponctuel de l'historique : bun run import <export.csv> [--force]
import { eur } from "../money.ts";
import { monthLabel } from "../months.ts";
import { applySheet, checkSheet, parseSheet } from "../sheet.ts";
import { openStore } from "../store.ts";

const [path, flag] = process.argv.slice(2);
if (!path) {
  console.error("Usage : bun run import <export.csv> [--force]");
  process.exit(1);
}
const data = parseSheet(await Bun.file(path).text());
const checks = checkSheet(data);
const failed = checks.filter((c) => c.actual !== c.expected);
console.log(`${data.accounts.length} comptes, ${data.months.length} mois (${monthLabel(data.months[0]!)} → ${monthLabel(data.months.at(-1)!)})`);
for (const c of failed) {
  console.log(`✗ ${c.label} ${monthLabel(c.month)} : Sheet ${eur(c.expected)}, recalculé ${c.actual === null ? "—" : eur(c.actual)}`);
}
if (failed.length > 0 && flag !== "--force") {
  console.error(`${failed.length} écart(s) avec le Sheet : rien n'a été importé (--force pour importer quand même).`);
  process.exit(1);
}
if (checks.length > 0 && failed.length === 0) console.log(`✓ ${checks.length} totaux et variations identiques au Sheet`);
applySheet(openStore(process.env.DB_PATH ?? "data/finance.sqlite"), data);
console.log("Import terminé.");
