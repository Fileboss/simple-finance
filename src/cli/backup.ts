// Outil de dev : bun run backup <destination.sqlite>
// La sauvegarde de prod est faite côté hôte (dépôt d'infrastructure).
import { backupDatabase } from "../store.ts";

const dest = process.argv[2];
if (!dest) {
  console.error("Usage : bun run backup <destination.sqlite>");
  process.exit(1);
}
const source = process.env.DB_PATH ?? "data/finance.sqlite";
try {
  backupDatabase(source, dest);
} catch (e) {
  console.error(`Impossible de sauvegarder ${source} : ${(e as Error).message}`);
  process.exit(1);
}
console.log(`Sauvegarde de ${source} écrite dans ${dest}`);
