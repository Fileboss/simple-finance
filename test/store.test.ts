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
  store.addAccount("Actions");
  store.db.close();
  const again = openStore(path);
  expect(again.db.query<{ user_version: number }, []>("PRAGMA user_version").get()!.user_version).toBe(1);
  expect(again.accounts().map((a) => a.name)).toEqual(["Actions"]);
  again.db.close();
  // Un seul fichier de base (plus le journal WAL de SQLite).
  expect(readdirSync(dir).filter((f) => !/-(wal|shm)$/.test(f))).toEqual(["finance.sqlite"]);
});

test("backupDatabase : copie cohérente d'une base existante", () => {
  const path = join(dir, "finance.sqlite");
  const store = openStore(path);
  store.addAccount("Actions");
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
