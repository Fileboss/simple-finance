import { beforeEach, describe, expect, test } from "bun:test";
import { createApp } from "../src/app.tsx";
import { generatePassword, hashPassword, passwordError, provisionPasswords, validUserName, verifyPassword } from "../src/auth.ts";
import { SESSION_MAX_MS, openStore, type Ledger, type Store } from "../src/store.ts";
import { SAMPLE } from "./fixtures.ts";

const COOKIE = "__Host-finance-session";
const PASSWORD = "un mot de passe assez long";
const OTHER_PASSWORD = "un autre mot de passe assez long";

let store: Store;
let app: ReturnType<typeof createApp>;
beforeEach(() => {
  store = openStore(":memory:");
  app = createApp(store);
});

const form = (fields: Record<string, string>) => {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.set(k, v);
  return body;
};
const sessionCookie = (res: Response) => res.headers.get("set-cookie")!.split(";")[0]!;
const get = (path: string, cookie = "") => app.request(path, { headers: { cookie } });
const post = (path: string, fields: Record<string, string>, cookie = "", headers: Record<string, string> = {}) =>
  app.request(path, { method: "POST", body: form(fields), headers: { cookie, ...headers } });
const login = (name: string, password: string) => post("/login", { name, password });

async function user(name: string, mustChange = false) {
  return store.addUser(name, await hashPassword(PASSWORD), mustChange);
}

test("sans session : tout renvoie vers la connexion, sauf /health et les fichiers statiques", async () => {
  for (const path of ["/", "/saisie", "/comptes", "/import", "/mot-de-passe", "/inconnu"]) {
    const res = await get(path);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/login");
  }
  for (const path of ["/saisie", "/saisie/supprimer", "/comptes", "/comptes/1", "/import", "/import/preview", "/mot-de-passe", "/logout"]) {
    const res = await post(path, { name: "Pirate", csv: SAMPLE });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/login");
  }
  expect((await get("/health")).status).toBe(200);
  expect((await get("/static/style.css")).status).toBe(200);
});

test("connexion : cookie protégé, session stockée hachée, déconnexion", async () => {
  const u = await user("alice");
  const res = await login("ALICE", PASSWORD);
  expect(res.status).toBe(303);
  expect(res.headers.get("location")).toBe("/");
  const header = res.headers.get("set-cookie")!;
  expect(header).toStartWith(`${COOKIE}=`);
  for (const attribute of ["Path=/", "HttpOnly", "Secure", "SameSite=Lax"]) expect(header).toContain(attribute);
  expect(header).not.toContain("Domain");

  const cookie = sessionCookie(res);
  const token = cookie.split("=")[1]!;
  const row = store.db.query<{ token_hash: Uint8Array; user_id: number }, []>("SELECT token_hash, user_id FROM sessions").get()!;
  expect(row.user_id).toBe(u.id);
  expect(Buffer.from(row.token_hash).toString("base64url")).not.toBe(token);

  const home = await get("/", cookie);
  expect(home.status).toBe(200);
  expect(home.headers.get("cache-control")).toBe("no-store");
  expect(await home.text()).toContain("alice");
  expect((await get("/login", cookie)).status).toBe(303);

  const out = await post("/logout", {}, cookie);
  expect(out.headers.get("location")).toBe("/login");
  expect((await get("/", cookie)).status).toBe(303);
});

test("connexion refusée : même réponse pour un compte inconnu, un mot de passe faux ou vide", async () => {
  await user("alice");
  const responses = await Promise.all([login("alice", "mauvais"), login("inconnu", PASSWORD), login("alice", ""), login("", "")]);
  const bodies = await Promise.all(responses.map((r) => r.text()));
  for (const r of responses) {
    expect(r.status).toBe(401);
    expect(r.headers.get("set-cookie")).toBeNull();
  }
  expect(new Set(bodies).size).toBe(1);
  expect(bodies[0]).toContain("Identifiant ou mot de passe incorrect.");
});

test("compte sans mot de passe généré : connexion impossible", async () => {
  store.addUser("nouveau");
  expect((await login("nouveau", PASSWORD)).status).toBe(401);
  expect((await login("nouveau", "")).status).toBe(401);
});

test("échecs répétés : ralentis, mais le propriétaire peut toujours se connecter", async () => {
  await user("alice");
  for (let i = 0; i < 5; i++) expect((await login("alice", "mauvais")).status).toBe(401);
  const start = Date.now();
  expect((await login("alice", PASSWORD)).status).toBe(303);
  expect(Date.now() - start).toBeGreaterThanOrEqual(900);
  // Le succès remet le compteur à zéro.
  const again = Date.now();
  expect((await login("alice", PASSWORD)).status).toBe(303);
  expect(Date.now() - again).toBeLessThan(900);
});

test("session expirée : refusée et supprimée", async () => {
  const u = await user("alice");
  const token = store.createSession(u.id);
  expect(store.sessionUser(token)?.id).toBe(u.id);
  store.db.query("UPDATE sessions SET created_at = ?").run(Date.now() - SESSION_MAX_MS - 1000);
  expect(store.sessionUser(token)).toBeNull();
  expect(store.db.query("SELECT 1 FROM sessions").all()).toEqual([]);
});

test("mot de passe temporaire : seule la page de changement est accessible tant qu'il n'est pas changé", async () => {
  await user("alice", true);
  store.forUser(store.userByName("alice")!.id).addAccount("Actions");
  const res = await login("alice", PASSWORD);
  expect(res.headers.get("location")).toBe("/mot-de-passe");
  const cookie = sessionCookie(res);

  for (const path of ["/", "/saisie", "/comptes", "/import"]) {
    const page = await get(path, cookie);
    expect(page.status).toBe(303);
    expect(page.headers.get("location")).toBe("/mot-de-passe");
  }
  const blocked = await post("/comptes", { name: "Pirate" }, cookie);
  expect(blocked.headers.get("location")).toBe("/mot-de-passe");
  expect(store.forUser(1).accounts().map((a) => a.name)).toEqual(["Actions"]);

  const page = await (await get("/mot-de-passe", cookie)).text();
  expect(page).toContain("Choisis ton mot de passe");
  expect(page).not.toContain('href="/saisie"');
  expect((await post("/logout", {}, cookie)).status).toBe(303);
});

test("changement de mot de passe : contrôles, puis autres sessions révoquées", async () => {
  await user("alice", true);
  const cookie = sessionCookie(await login("alice", PASSWORD));
  const otherDevice = sessionCookie(await login("alice", PASSWORD));

  const attempt = (current: string, password: string, confirm = password) => post("/mot-de-passe", { current, password, confirm }, cookie);
  expect(await (await attempt("mauvais", OTHER_PASSWORD)).text()).toContain("Mot de passe temporaire incorrect");
  expect(await (await attempt(PASSWORD, "trop court")).text()).toContain("au moins 15 caractères");
  expect(await (await attempt(PASSWORD, OTHER_PASSWORD, "différent")).text()).toContain("La confirmation");
  expect(await (await attempt(PASSWORD, PASSWORD)).text()).toContain("doit être différent");
  expect((await get("/", cookie)).status).toBe(303);

  const res = await attempt(PASSWORD, OTHER_PASSWORD);
  expect(res.status).toBe(303);
  expect(res.headers.get("location")).toBe("/?password=1");
  const fresh = sessionCookie(res);
  expect(await (await get("/?password=1", fresh)).text()).toContain("Mot de passe modifié");

  expect((await get("/", cookie)).status).toBe(303);
  expect((await get("/", otherDevice)).status).toBe(303);
  expect((await login("alice", PASSWORD)).status).toBe(401);
  expect((await login("alice", OTHER_PASSWORD)).status).toBe(303);
  expect(store.userByName("alice")!.mustChangePassword).toBe(false);
});

test("formulaire venu d'un autre site ou d'un autre port du même hôte : refusé, même avec une session", async () => {
  await user("alice");
  const cookie = sessionCookie(await login("alice", PASSWORD));
  for (const site of ["cross-site", "same-site"]) {
    expect((await post("/comptes", { name: "Pirate" }, cookie, { "sec-fetch-site": site })).status).toBe(403);
    expect((await post("/logout", {}, cookie, { "sec-fetch-site": site })).status).toBe(403);
    expect((await post("/login", { name: "alice", password: PASSWORD }, "", { "sec-fetch-site": site })).status).toBe(403);
  }
  expect(store.forUser(1).accounts()).toEqual([]);
});

test("en dev : cookie sans Secure ni préfixe", async () => {
  const dev = createApp(store, { secureCookie: false });
  await user("alice");
  const res = await dev.request("/login", { method: "POST", body: form({ name: "alice", password: PASSWORD }) });
  const header = res.headers.get("set-cookie")!;
  expect(header).toStartWith("finance-session=");
  expect(header).not.toContain("Secure");
  expect((await dev.request("/", { headers: { cookie: sessionCookie(res) } })).status).toBe(200);
});

test("provisionPasswords : mot de passe temporaire utilisable, généré une seule fois", async () => {
  await user("alice");
  store.addUser("admin");
  const lines: string[] = [];
  await provisionPasswords(store, (line) => lines.push(line));
  expect(lines).toHaveLength(1);
  expect(lines[0]).toContain("« admin »");
  const password = lines[0]!.match(/temporaire (\S+)/)![1]!;

  const admin = store.userByName("admin")!;
  expect(admin.mustChangePassword).toBe(true);
  expect(await verifyPassword(password, admin.passwordHash)).toBe(true);
  expect(admin.passwordHash).toStartWith("$argon2id$v=19$m=19456,t=2,p=1$");

  await provisionPasswords(store, (line) => lines.push(line));
  expect(lines).toHaveLength(1);
});

test("mots de passe et identifiants : règles", () => {
  const password = generatePassword();
  expect(password).toMatch(/^([a-hjkmnp-z2-9]{4}-){5}[a-hjkmnp-z2-9]{4}$/);
  expect(password).not.toBe(generatePassword());
  expect(passwordError(password)).toBeNull();
  expect(passwordError("x".repeat(14))).toContain("au moins");
  expect(passwordError("x".repeat(1025))).toContain("au plus");
  expect(validUserName("jean.dupont-2_b")).toBe(true);
  for (const name of ["", "zoé", "avec espace", "<b>", "x".repeat(65)]) expect(validUserName(name)).toBe(false);
});

// Isolation : le cœur de la confidentialité entre utilisateurs. Chaque route qui reçoit
// un identifiant de compte est essayée avec celui de l'autre utilisateur.
describe("isolation", () => {
  let aliceLedger: Ledger;
  let bobLedger: Ledger;
  let accountId: number;
  let bob: string;

  beforeEach(async () => {
    const alice = await user("alice");
    aliceLedger = store.forUser(alice.id);
    accountId = aliceLedger.addAccount("Secret Alice", "#123456").id;
    aliceLedger.saveStatement({ month: "2026-01", accountId, value: 987654, deposits: 0 });
    const b = store.addUser("bob", null, false);
    bobLedger = store.forUser(b.id);
    bob = `${COOKIE}=${store.createSession(b.id)}`;
  });
  const intact = () => {
    expect(aliceLedger.accounts().map((a) => a.name)).toEqual(["Secret Alice"]);
    expect(aliceLedger.statements()).toEqual([{ month: "2026-01", accountId, value: 987654, deposits: 0 }]);
    expect(bobLedger.statements()).toEqual([]);
  };

  test("aucune page ne montre les données d'un autre utilisateur", async () => {
    const paths = ["/", "/?month=2026-01", "/saisie", "/saisie?month=2026-01", `/saisie?month=2026-01&deleted=${accountId}`, "/comptes", `/comptes?closed=${accountId}`, "/import"];
    for (const path of paths) {
      const html = await (await get(path, bob)).text();
      expect(html).not.toContain("Secret Alice");
      expect(html).not.toMatch(/9\s876,54/);
    }
  });

  test("impossible de modifier les données d'un autre utilisateur", async () => {
    const edit = await post(`/comptes/${accountId}`, { name: "Volé", color: "#000000", position: "1", closed: "on" }, bob);
    expect(edit.status).toBe(404);
    intact();

    await post("/saisie/supprimer", { month: "2026-01", account: String(accountId) }, bob);
    intact();

    await post("/saisie", { month: "2026-01", [`value_${accountId}`]: "1", [`deposits_${accountId}`]: "0" }, bob);
    intact();
  });

  test("le magasin ignore les comptes d'un autre utilisateur", () => {
    expect(bobLedger.account(accountId)).toBeNull();
    expect(bobLedger.accountByName("Secret Alice")).toBeNull();
    expect(bobLedger.lastStatement(accountId)).toBeNull();
    expect(bobLedger.statementsFor("2026-01").size).toBe(0);
    bobLedger.saveStatement({ month: "2026-02", accountId, value: 1, deposits: 0 });
    bobLedger.importValue("2026-01", accountId, 1);
    bobLedger.deleteStatement("2026-01", accountId);
    bobLedger.updateAccount({ ...aliceLedger.account(accountId)!, name: "Volé" });
    intact();
  });

  test("même nom de compte et import indépendants", async () => {
    expect((await post("/comptes", { name: "Secret Alice" }, bob)).status).toBe(303);
    expect(bobLedger.accounts().map((a) => a.name)).toEqual(["Secret Alice"]);
    expect((await post("/import", { csv: SAMPLE }, bob)).status).toBe(303);
    expect(bobLedger.accounts().map((a) => a.name)).toEqual(["Secret Alice", "Epargne", "Actions"]);
    expect(aliceLedger.accounts().map((a) => a.name)).toEqual(["Secret Alice"]);
    expect(aliceLedger.statements()).toHaveLength(1);
  });
});
