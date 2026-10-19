import { Database } from "bun:sqlite";
import { mkdirSync, rmSync } from "node:fs";
import { dirname } from "node:path";

// Couleurs par défaut des comptes, dans l'ordre du graphique du Sheet.
export const PALETTE = ["#4285f4", "#db4437", "#f4b400", "#0f9d58", "#ff6d01", "#46bdc6", "#ab47bc", "#ec407a", "#8d6e63", "#5c6bc0"];

export interface Account {
  id: number;
  name: string;
  color: string;
  position: number;
  closed: boolean;
  baselineMonth: string | null;
  baselineInvested: number | null;
  /** Performance affichée (en %) ayant servi à calculer baselineInvested, pour mémoire. */
  baselinePerf: number | null;
}

export interface Statement {
  month: string;
  accountId: number;
  value: number;
  deposits: number | null;
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    color TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    closed INTEGER NOT NULL DEFAULT 0,
    baseline_month TEXT,
    baseline_invested INTEGER,
    baseline_perf REAL
  )`,
  `CREATE TABLE IF NOT EXISTS statements (
    month TEXT NOT NULL,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    value INTEGER NOT NULL,
    deposits INTEGER,
    PRIMARY KEY (month, account_id)
  )`,
];

interface AccountRow {
  id: number;
  name: string;
  color: string;
  position: number;
  closed: number;
  baseline_month: string | null;
  baseline_invested: number | null;
  baseline_perf: number | null;
}

const toAccount = (r: AccountRow): Account => ({
  id: r.id,
  name: r.name,
  color: r.color,
  position: r.position,
  closed: r.closed === 1,
  baselineMonth: r.baseline_month,
  baselineInvested: r.baseline_invested,
  baselinePerf: r.baseline_perf,
});

export function openStore(path: string): Store {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  return new Store(new Database(path, { create: true, strict: true }));
}

export class Store {
  constructor(readonly db: Database) {
    db.run("PRAGMA journal_mode = WAL");
    db.run("PRAGMA foreign_keys = ON");
    for (const sql of SCHEMA) db.run(sql);
  }

  accounts(): Account[] {
    return this.db.query<AccountRow, []>("SELECT * FROM accounts ORDER BY position, id").all().map(toAccount);
  }

  account(id: number): Account | null {
    const row = this.db.query<AccountRow, [number]>("SELECT * FROM accounts WHERE id = ?").get(id);
    return row ? toAccount(row) : null;
  }

  accountByName(name: string): Account | null {
    const row = this.db.query<AccountRow, [string]>("SELECT * FROM accounts WHERE name = ?").get(name);
    return row ? toAccount(row) : null;
  }

  addAccount(name: string, color?: string): Account {
    const { n, next } = this.db
      .query<{ n: number; next: number }, []>("SELECT count(*) AS n, coalesce(max(position), 0) + 1 AS next FROM accounts")
      .get()!;
    const row = this.db
      .query<AccountRow, [string, string, number]>("INSERT INTO accounts (name, color, position) VALUES (?, ?, ?) RETURNING *")
      .get(name, color ?? PALETTE[n % PALETTE.length]!, next)!;
    return toAccount(row);
  }

  updateAccount(a: Account): void {
    this.db
      .query(
        `UPDATE accounts SET name = ?, color = ?, position = ?, closed = ?,
           baseline_month = ?, baseline_invested = ?, baseline_perf = ? WHERE id = ?`,
      )
      .run(a.name, a.color, a.position, a.closed ? 1 : 0, a.baselineMonth, a.baselineInvested, a.baselinePerf, a.id);
  }

  statements(): Statement[] {
    return this.db
      .query<Statement, []>("SELECT month, account_id AS accountId, value, deposits FROM statements ORDER BY month, account_id")
      .all();
  }

  statementsFor(month: string): Map<number, Statement> {
    const rows = this.db
      .query<Statement, [string]>("SELECT month, account_id AS accountId, value, deposits FROM statements WHERE month = ?")
      .all(month);
    return new Map(rows.map((s) => [s.accountId, s]));
  }

  saveStatement(s: Statement): void {
    this.db
      .query(
        `INSERT INTO statements (month, account_id, value, deposits) VALUES (?, ?, ?, ?)
         ON CONFLICT (month, account_id) DO UPDATE SET value = excluded.value, deposits = excluded.deposits`,
      )
      .run(s.month, s.accountId, s.value, s.deposits);
  }

  /** Import de l'historique : met à jour la valeur sans toucher aux versements déjà saisis. */
  importValue(month: string, accountId: number, value: number): void {
    this.db
      .query(
        `INSERT INTO statements (month, account_id, value, deposits) VALUES (?, ?, ?, NULL)
         ON CONFLICT (month, account_id) DO UPDATE SET value = excluded.value`,
      )
      .run(month, accountId, value);
  }

  deleteStatement(month: string, accountId: number): void {
    this.db.query("DELETE FROM statements WHERE month = ? AND account_id = ?").run(month, accountId);
  }

  transaction(fn: () => void): void {
    this.db.transaction(fn)();
  }

  /** Copie cohérente de la base, même pendant que l'app écrit. */
  backup(path: string): void {
    mkdirSync(dirname(path), { recursive: true });
    rmSync(path, { force: true });
    this.db.query("VACUUM INTO ?").run(path);
  }
}
