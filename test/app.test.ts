import { beforeEach, expect, test } from "bun:test";
import { createApp } from "../src/app.tsx";
import { openStore, type Ledger, type Store } from "../src/store.ts";
import { SAMPLE } from "./fixtures.ts";

let store: Store;
let ledger: Ledger;
let app: ReturnType<typeof createApp>;
let cookie: string;
beforeEach(() => {
  store = openStore(":memory:");
  app = createApp(store);
  const user = store.addUser("test", "empreinte-factice", false);
  ledger = store.forUser(user.id);
  cookie = `__Host-finance-session=${store.createSession(user.id)}`;
});

const get = (path: string) => app.request(path, { headers: { cookie } });

const post = (path: string, fields: Record<string, string>, headers: Record<string, string> = {}) => {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.set(k, v);
  return app.request(path, { method: "POST", body, headers: { cookie, ...headers } });
};

test("tableau de bord vide", async () => {
  const res = await get("/");
  expect(res.status).toBe(200);
  expect(await res.text()).toContain("Aucun relevé");
});

test("import : prévisualisation, contrôle, puis tableau de bord", async () => {
  const preview = await post("/import/preview", { csv: SAMPLE });
  expect(await preview.text()).toContain("Contrôle réussi");

  const res = await post("/import", { csv: SAMPLE });
  expect(res.status).toBe(303);
  const html = await (await get("/")).text();
  expect(html).toContain("février 2026");
  expect(html).toMatch(/1\s630,00\s€/);
  expect(html).toContain('id="chart-data"');
});

test("saisie d'un mois, avec erreur puis correction", async () => {
  const epargne = ledger.addAccount("Epargne");
  ledger.saveStatement({ month: "2026-01", accountId: epargne.id, value: 100000, deposits: null });

  const form = await (await get("/saisie")).text();
  expect(form).toContain('value="2026-02"');

  const bad = await post("/saisie", { month: "2026-02", [`value_${epargne.id}`]: "abc", [`deposits_${epargne.id}`]: "0" });
  expect(bad.status).toBe(400);
  expect(await bad.text()).toContain("Montant invalide");

  const ok = await post("/saisie", { month: "2026-02", [`value_${epargne.id}`]: "1 060,00", [`deposits_${epargne.id}`]: "50" });
  expect(ok.status).toBe(303);
  expect(ledger.statementsFor("2026-02").get(epargne.id)).toEqual({ month: "2026-02", accountId: epargne.id, value: 106000, deposits: 5000 });
});

test("capital de départ déduit de la performance", async () => {
  const actions = ledger.addAccount("Actions");
  ledger.saveStatement({ month: "2026-10", accountId: actions.id, value: 230000, deposits: null });
  const res = await post(`/comptes/${actions.id}`, {
    name: "Actions",
    color: "#123456",
    position: "1",
    baseline_month: "2026-10",
    baseline_perf: "15",
    baseline_invested: "",
  });
  expect(res.status).toBe(303);
  expect(ledger.account(actions.id)).toMatchObject({ color: "#123456", baselineInvested: 200000, baselinePerf: 15 });
});

test("formulaire posté depuis un autre site : refusé", async () => {
  const res = await post("/comptes", { name: "Pirate" }, { "sec-fetch-site": "cross-site" });
  expect(res.status).toBe(403);
  expect(ledger.accounts()).toEqual([]);
});

test("import : capital de départ déduit de la performance saisie", async () => {
  // Actions vaut 530,00 € en février (dernier mois importé) : +6 % → 500,00 € investis.
  const res = await post("/import", { csv: SAMPLE, perf_1: "6", invested_0: "1 000" });
  expect(res.status).toBe(303);
  const [epargne, actions] = ledger.accounts();
  expect(epargne).toMatchObject({ baselineMonth: "2026-02", baselineInvested: 100000, baselinePerf: null });
  expect(actions).toMatchObject({ baselineMonth: "2026-02", baselineInvested: 50000, baselinePerf: 6 });

  // Réimport : l'aperçu reprend la performance enregistrée.
  expect(await (await post("/import/preview", { csv: SAMPLE })).text()).toContain('name="perf_1" value="6"');
});

test("import : performance illisible, rien n'est importé", async () => {
  const res = await post("/import", { csv: SAMPLE, perf_1: "abc" });
  expect(res.status).toBe(400);
  expect(await res.text()).toContain("Actions : Pourcentage invalide");
  expect(ledger.accounts()).toEqual([]);
});

test("clôture : crée le relevé final à 0 avec le retrait du solde", async () => {
  const epargne = ledger.addAccount("Epargne");
  ledger.saveStatement({ month: "2026-10", accountId: epargne.id, value: 170000, deposits: 0 });
  const form = await (await get("/comptes")).text();
  expect(form).toContain("crée le relevé de clôture de novembre 2026");

  const res = await post(`/comptes/${epargne.id}`, { name: "Epargne", color: "#123456", position: "1", closed: "on" });
  expect(res.status).toBe(303);
  expect(ledger.account(epargne.id)?.closed).toBe(true);
  expect(ledger.statementsFor("2026-11").get(epargne.id)).toEqual({ month: "2026-11", accountId: epargne.id, value: 0, deposits: -170000 });
  expect(await (await get(res.headers.get("location")!)).text()).toContain("relevé de clôture créé pour novembre 2026");
});

test("compte ouvert en cours de suivi : versements du premier mois obligatoires", async () => {
  const epargne = ledger.addAccount("Epargne");
  ledger.saveStatement({ month: "2026-10", accountId: epargne.id, value: 170000, deposits: 0 });
  const courtier = ledger.addAccount("Courtier");

  const form = await (await get("/saisie?month=2026-11")).text();
  expect(form).toContain("Premier relevé");

  const fields = { month: "2026-11", [`value_${epargne.id}`]: "1700", [`deposits_${epargne.id}`]: "0", [`value_${courtier.id}`]: "500" };
  const bad = await post("/saisie", { ...fields, [`deposits_${courtier.id}`]: "" });
  expect(bad.status).toBe(400);
  expect(await bad.text()).toContain("indique le montant apporté");

  const ok = await post("/saisie", { ...fields, [`deposits_${courtier.id}`]: "500" });
  expect(ok.status).toBe(303);
  expect(ledger.statementsFor("2026-11").get(courtier.id)?.deposits).toBe(50000);
});

test("saisie : une valeur vide est refusée et ne supprime pas le relevé", async () => {
  const epargne = ledger.addAccount("Epargne");
  ledger.saveStatement({ month: "2026-10", accountId: epargne.id, value: 170000, deposits: 0 });
  const form = await (await get("/saisie?month=2026-10")).text();
  expect(form).toMatch(/name="value_\d+" value="1700,00"[^>]*required/);

  const res = await post("/saisie", { month: "2026-10", [`value_${epargne.id}`]: "", [`deposits_${epargne.id}`]: "0" });
  expect(res.status).toBe(400);
  expect(await res.text()).toContain("Valeur obligatoire");
  expect(ledger.statementsFor("2026-10").get(epargne.id)?.value).toBe(170000);
});

test("saisie : suppression explicite d'un relevé", async () => {
  const epargne = ledger.addAccount("Epargne");
  ledger.saveStatement({ month: "2026-10", accountId: epargne.id, value: 170000, deposits: 0 });
  expect(await (await get("/saisie?month=2026-10")).text()).toContain('formaction="/saisie/supprimer"');

  const res = await post("/saisie/supprimer", { month: "2026-10", account: String(epargne.id) });
  expect(res.status).toBe(303);
  expect(ledger.statementsFor("2026-10").size).toBe(0);
  expect(await (await get(res.headers.get("location")!)).text()).toContain("Relevé de Epargne supprimé pour octobre 2026");
});

test("derrière tailscale serve : Host en *.ts.net accepté, redirections relatives", async () => {
  const epargne = ledger.addAccount("Epargne");
  const headers = { cookie, host: "homelab.tail1234.ts.net", "x-forwarded-proto": "https", "sec-fetch-site": "same-origin" };
  expect((await app.request("https://homelab.tail1234.ts.net/", { headers })).status).toBe(200);
  const body = new FormData();
  body.set("month", "2026-10");
  body.set(`value_${epargne.id}`, "10");
  body.set(`deposits_${epargne.id}`, "0");
  const res = await app.request("http://127.0.0.1:3000/saisie", { method: "POST", body, headers });
  expect(res.status).toBe(303);
  expect(res.headers.get("location")).toBe("/?month=2026-10&saved=1");
});

test("performance d'un compte : globale, annuelle et mois par mois", async () => {
  const actions = ledger.addAccount("Actions");
  ledger.updateAccount({ ...actions, baselineMonth: "2025-12", baselineInvested: 90000 });
  ledger.saveStatement({ month: "2025-12", accountId: actions.id, value: 100000, deposits: null });
  ledger.saveStatement({ month: "2026-01", accountId: actions.id, value: 110000, deposits: 5000 });
  ledger.saveStatement({ month: "2026-02", accountId: actions.id, value: 112000, deposits: null });
  const html = await (await get(`/comptes/${actions.id}`)).text();
  expect(html).toContain("Performance annuelle");
  expect(html).toContain("Mois par mois");
  // Fin février : investi inconnu (versements de février inconnus), donc un tiret.
  expect(html).toMatch(/investi <span class="na"/);
  // Le tableau de bord mène à la page du compte.
  expect(await (await get("/")).text()).toContain(`href="/comptes/${actions.id}"`);
});

test("performance d'un compte : celui d'un autre utilisateur est introuvable", async () => {
  const other = store.forUser(store.addUser("autre", "empreinte-factice", false).id);
  const hidden = other.addAccount("Secret");
  expect((await get(`/comptes/${hidden.id}`)).status).toBe(404);
});
