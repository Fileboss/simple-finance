import { afterEach, beforeEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { backupDatabase, openStore } from "../src/store.ts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "simple-finance-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

test("migrations en place : version du schéma, données conservées à la réouverture", () => {
  const path = join(dir, "finance.sqlite");
  const store = openStore(path);
  const user = store.addUser("test");
  store.forUser(user.id).addAccount("Actions");
  store.db.close();
  const again = openStore(path);
  expect(again.db.query<{ user_version: number }, []>("PRAGMA user_version").get()!.user_version).toBe(2);
  expect(again.forUser(user.id).accounts().map((a) => a.name)).toEqual(["Actions"]);
  again.db.close();
  // Un seul fichier de base (plus le journal WAL de SQLite).
  expect(readdirSync(dir).filter((f) => !/-(wal|shm)$/.test(f))).toEqual(["finance.sqlite"]);
});

test("backupDatabase : copie cohérente d'une base existante", () => {
  const path = join(dir, "finance.sqlite");
  const store = openStore(path);
  store.forUser(store.addUser("test").id).addAccount("Actions");
  backupDatabase(path, join(dir, "backup", "copie.sqlite"));
  const copy = new Database(join(dir, "backup", "copie.sqlite"), { readonly: true });
  expect(copy.query<{ name: string }, []>("SELECT name FROM accounts").all()).toEqual([{ name: "Actions" }]);
  copy.close();
});

test("backupDatabase : base absente, échec sans créer de base vide", () => {
  const missing = join(dir, "absente.sqlite");
  expect(() => backupDatabase(missing, join(dir, "copie.sqlite"))).toThrow();
  expect(existsSync(missing)).toBe(false);
  expect(existsSync(join(dir, "copie.sqlite"))).toBe(false);
});

// Base telle que la laisse la version sans comptes utilisateurs.
function legacyDatabase(path: string) {
  const db = new Database(path);
  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA foreign_keys = ON");
  db.run(`CREATE TABLE accounts (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE, color TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0,
    closed INTEGER NOT NULL DEFAULT 0, baseline_month TEXT, baseline_invested INTEGER, baseline_perf REAL)`);
  db.run(`CREATE TABLE statements (
    month TEXT NOT NULL, account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    value INTEGER NOT NULL, deposits INTEGER, PRIMARY KEY (month, account_id))`);
  db.run("PRAGMA user_version = 1");
  return db;
}

test("migration vers les utilisateurs : données conservées, rattachées à un compte sans mot de passe", () => {
  const path = join(dir, "finance.sqlite");
  const legacy = legacyDatabase(path);
  legacy.run("INSERT INTO accounts VALUES (3, 'Actions', '#123456', 2, 0, '2026-01', 100000, 12.5), (7, 'Livret', '#654321', 1, 1, NULL, NULL, NULL)");
  legacy.run("INSERT INTO statements VALUES ('2026-01', 3, 150000, NULL), ('2026-02', 3, 160000, 5000), ('2026-01', 7, 2000, 0)");
  legacy.close();

  const store = openStore(path);
  expect(store.users()).toEqual([{ id: 1, name: "admin", passwordHash: null, mustChangePassword: true }]);
  const ledger = store.forUser(1);
  expect(ledger.accounts()).toEqual([
    { id: 7, name: "Livret", color: "#654321", position: 1, closed: true, baselineMonth: null, baselineInvested: null, baselinePerf: null },
    { id: 3, name: "Actions", color: "#123456", position: 2, closed: false, baselineMonth: "2026-01", baselineInvested: 100000, baselinePerf: 12.5 },
  ]);
  expect(ledger.statements()).toEqual([
    { month: "2026-01", accountId: 3, value: 150000, deposits: null },
    { month: "2026-01", accountId: 7, value: 2000, deposits: 0 },
    { month: "2026-02", accountId: 3, value: 160000, deposits: 5000 },
  ]);
  // Clés étrangères de nouveau actives, cascade comprise.
  expect(() => ledger.saveStatement({ month: "2026-03", accountId: 3, value: 1, deposits: 0 })).not.toThrow();
  expect(() => store.db.run("INSERT INTO statements VALUES ('2026-03', 99, 1, 0)")).toThrow();
  store.db.run("DELETE FROM accounts WHERE id = 7");
  expect(ledger.statements().some((s) => s.accountId === 7)).toBe(false);
  // Le nom de compte est unique par utilisateur.
  const other = store.forUser(store.addUser("autre").id);
  expect(other.addAccount("Actions").name).toBe("Actions");
  expect(() => other.addAccount("ACTIONS")).toThrow();
});

test("migration d'une base sans donnée : aucun utilisateur créé", () => {
  const path = join(dir, "finance.sqlite");
  legacyDatabase(path).close();
  expect(openStore(path).users()).toEqual([]);
  expect(openStore(":memory:").users()).toEqual([]);
});

test("migration en échec : la base reste intacte", () => {
  const path = join(dir, "finance.sqlite");
  const legacy = legacyDatabase(path);
  legacy.run("INSERT INTO accounts (id, name, color) VALUES (1, 'Actions', '#123456')");
  legacy.run("INSERT INTO statements VALUES ('2026-01', 1, 150000, 0)");
  legacy.run("CREATE TABLE accounts_new (id INTEGER)"); // fait échouer une étape, après la création de users
  legacy.close();

  expect(() => openStore(path)).toThrow();
  const db = new Database(path);
  expect(db.query<{ user_version: number }, []>("PRAGMA user_version").get()!.user_version).toBe(1);
  expect(db.query<{ n: number }, []>("SELECT count(*) AS n FROM statements").get()!.n).toBe(1);
  expect(db.query("SELECT name FROM sqlite_master WHERE name = 'users'").all()).toEqual([]);
  db.close();
});

test("base plus récente que le code : refus de démarrer, base intacte", () => {
  const path = join(dir, "finance.sqlite");
  const db = new Database(path);
  db.run("PRAGMA user_version = 99");
  db.close();
  expect(() => openStore(path)).toThrow(/plus récente/);
  const again = new Database(path);
  expect(again.query<{ user_version: number }, []>("PRAGMA user_version").get()!.user_version).toBe(99);
  again.close();
});
