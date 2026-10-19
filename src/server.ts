import { createApp } from "./app.tsx";
import { openStore } from "./store.ts";

const store = openStore(process.env.DB_PATH ?? "data/finance.sqlite");
const app = createApp(store);
const port = Number(process.env.PORT ?? 3000);

console.log(`simple-finance : http://localhost:${port}`);

export default { port, fetch: app.fetch };
