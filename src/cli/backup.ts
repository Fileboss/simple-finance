// Sauvegarde cohérente pour restic : bun run backup [destination]
import { openStore } from "../store.ts";

const dest = process.argv[2] ?? "data/backup/finance.sqlite";
openStore(process.env.DB_PATH ?? "data/finance.sqlite").backup(dest);
console.log(`Sauvegarde écrite dans ${dest}`);
