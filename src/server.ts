import { createApp } from "./app.tsx";
import { provisionPasswords } from "./auth.ts";
import { openStore } from "./store.ts";

const store = openStore(process.env.DB_PATH ?? "data/finance.sqlite");
await provisionPasswords(store);
const app = createApp(store, { secureCookie: process.env.INSECURE_COOKIE !== "1" });
const port = Number(process.env.PORT ?? 3000);

console.log(`simple-finance : écoute sur le port ${port}`);

export default { port, fetch: app.fetch };
