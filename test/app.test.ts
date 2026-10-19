import { beforeEach, expect, test } from "bun:test";
import { createApp } from "../src/app.tsx";
import { openStore, type Store } from "../src/store.ts";
import { SAMPLE } from "./fixtures.ts";

let store: Store;
let app: ReturnType<typeof createApp>;
beforeEach(() => {
  store = openStore(":memory:");
  app = createApp(store);
});

const post = (path: string, fields: Record<string, string>, headers: Record<string, string> = {}) => {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.set(k, v);
  return app.request(path, { method: "POST", body, headers });
};

test("tableau de bord vide", async () => {
  const res = await app.request("/");
  expect(res.status).toBe(200);
  expect(await res.text()).toContain("Aucun relevé");
});

test("import : prévisualisation, contrôle, puis tableau de bord", async () => {
  const preview = await post("/import/preview", { csv: SAMPLE });
  expect(await preview.text()).toContain("Contrôle réussi");

  const res = await post("/import", { csv: SAMPLE });
  expect(res.status).toBe(303);
  const html = await (await app.request("/")).text();
  expect(html).toContain("février 2026");
  expect(html).toMatch(/1\s630,00\s€/);
  expect(html).toContain('id="chart-data"');
});

test("saisie d'un mois, avec erreur puis correction", async () => {
  const livret = store.addAccount("Livret");
  store.saveStatement({ month: "2026-01", accountId: livret.id, value: 100000, deposits: null });

  const form = await (await app.request("/saisie")).text();
  expect(form).toContain('value="2026-02"');

  const bad = await post("/saisie", { month: "2026-02", [`value_${livret.id}`]: "abc", [`deposits_${livret.id}`]: "0" });
  expect(bad.status).toBe(400);
  expect(await bad.text()).toContain("Montant invalide");

  const ok = await post("/saisie", { month: "2026-02", [`value_${livret.id}`]: "1 060,00", [`deposits_${livret.id}`]: "50" });
  expect(ok.status).toBe(303);
  expect(store.statementsFor("2026-02").get(livret.id)).toEqual({ month: "2026-02", accountId: livret.id, value: 106000, deposits: 5000 });
});

test("capital de départ déduit de la performance", async () => {
  const pea = store.addAccount("PEA");
  store.saveStatement({ month: "2026-10", accountId: pea.id, value: 719268, deposits: null });
  const res = await post(`/comptes/${pea.id}`, {
    name: "PEA",
    color: "#123456",
    position: "1",
    baseline_month: "2026-10",
    baseline_perf: "15",
    baseline_invested: "",
  });
  expect(res.status).toBe(303);
  expect(store.account(pea.id)).toMatchObject({ color: "#123456", baselineInvested: 625450, baselinePerf: 15 });
});

test("formulaire posté depuis un autre site : refusé", async () => {
  const res = await post("/comptes", { name: "Pirate" }, { "sec-fetch-site": "cross-site" });
  expect(res.status).toBe(403);
  expect(store.accounts()).toEqual([]);
});

test("import : capital de départ déduit de la performance saisie", async () => {
  // PEA vaut 530,00 € en février (dernier mois importé) : +6 % → 500,00 € investis.
  const res = await post("/import", { csv: SAMPLE, perf_1: "6", invested_0: "1 000" });
  expect(res.status).toBe(303);
  const [livret, pea] = store.accounts();
  expect(livret).toMatchObject({ baselineMonth: "2026-02", baselineInvested: 100000, baselinePerf: null });
  expect(pea).toMatchObject({ baselineMonth: "2026-02", baselineInvested: 50000, baselinePerf: 6 });

  // Réimport : l'aperçu reprend la performance enregistrée.
  expect(await (await post("/import/preview", { csv: SAMPLE })).text()).toContain('name="perf_1" value="6"');
});

test("import : performance illisible, rien n'est importé", async () => {
  const res = await post("/import", { csv: SAMPLE, perf_1: "abc" });
  expect(res.status).toBe(400);
  expect(await res.text()).toContain("PEA : Pourcentage invalide");
  expect(store.accounts()).toEqual([]);
});

test("clôture : crée le relevé final à 0 avec le retrait du solde", async () => {
  const livret = store.addAccount("Livret");
  store.saveStatement({ month: "2026-10", accountId: livret.id, value: 170000, deposits: 0 });
  const form = await (await app.request("/comptes")).text();
  expect(form).toContain("crée le relevé de clôture de novembre 2026");

  const res = await post(`/comptes/${livret.id}`, { name: "Livret", color: "#123456", position: "1", closed: "on" });
  expect(res.status).toBe(303);
  expect(store.account(livret.id)?.closed).toBe(true);
  expect(store.statementsFor("2026-11").get(livret.id)).toEqual({ month: "2026-11", accountId: livret.id, value: 0, deposits: -170000 });
  expect(await (await app.request(res.headers.get("location")!)).text()).toContain("relevé de clôture créé pour novembre 2026");
});

test("compte ouvert en cours de suivi : versements du premier mois obligatoires", async () => {
  const livret = store.addAccount("Livret");
  store.saveStatement({ month: "2026-10", accountId: livret.id, value: 170000, deposits: 0 });
  const tr = store.addAccount("Trade Republic");

  const form = await (await app.request("/saisie?month=2026-11")).text();
  expect(form).toContain("Premier relevé");

  const fields = { month: "2026-11", [`value_${livret.id}`]: "1700", [`deposits_${livret.id}`]: "0", [`value_${tr.id}`]: "500" };
  const bad = await post("/saisie", { ...fields, [`deposits_${tr.id}`]: "" });
  expect(bad.status).toBe(400);
  expect(await bad.text()).toContain("indique le montant apporté");

  const ok = await post("/saisie", { ...fields, [`deposits_${tr.id}`]: "500" });
  expect(ok.status).toBe(303);
  expect(store.statementsFor("2026-11").get(tr.id)?.deposits).toBe(50000);
});

test("saisie : une valeur vide est refusée et ne supprime pas le relevé", async () => {
  const livret = store.addAccount("Livret");
  store.saveStatement({ month: "2026-10", accountId: livret.id, value: 170000, deposits: 0 });
  const form = await (await app.request("/saisie?month=2026-10")).text();
  expect(form).toMatch(/name="value_\d+" value="1700,00"[^>]*required/);

  const res = await post("/saisie", { month: "2026-10", [`value_${livret.id}`]: "", [`deposits_${livret.id}`]: "0" });
  expect(res.status).toBe(400);
  expect(await res.text()).toContain("Valeur obligatoire");
  expect(store.statementsFor("2026-10").get(livret.id)?.value).toBe(170000);
});

test("saisie : suppression explicite d'un relevé", async () => {
  const livret = store.addAccount("Livret");
  store.saveStatement({ month: "2026-10", accountId: livret.id, value: 170000, deposits: 0 });
  expect(await (await app.request("/saisie?month=2026-10")).text()).toContain('formaction="/saisie/supprimer"');

  const res = await post("/saisie/supprimer", { month: "2026-10", account: String(livret.id) });
  expect(res.status).toBe(303);
  expect(store.statementsFor("2026-10").size).toBe(0);
  expect(await (await app.request(res.headers.get("location")!)).text()).toContain("Relevé de Livret supprimé pour octobre 2026");
});

test("derrière tailscale serve : Host en *.ts.net accepté, redirections relatives", async () => {
  const livret = store.addAccount("Livret");
  const headers = { host: "homelab.tail1234.ts.net", "x-forwarded-proto": "https", "sec-fetch-site": "same-origin" };
  expect((await app.request("https://homelab.tail1234.ts.net/", { headers })).status).toBe(200);
  const body = new FormData();
  body.set("month", "2026-10");
  body.set(`value_${livret.id}`, "10");
  body.set(`deposits_${livret.id}`, "0");
  const res = await app.request("http://127.0.0.1:3000/saisie", { method: "POST", body, headers });
  expect(res.status).toBe(303);
  expect(res.headers.get("location")).toBe("/?month=2026-10&saved=1");
});
