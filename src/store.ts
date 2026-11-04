import { Database } from "bun:sqlite";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { dirname } from "node:path";

// Couleurs par défaut des comptes, dans l'ordre du graphique du Sheet.
export const PALETTE = ["#4285f4", "#db4437", "#f4b400", "#0f9d58", "#ff6d01", "#46bdc6", "#ab47bc", "#ec407a", "#8d6e63", "#5c6bc0"];

const DAY_MS = 24 * 60 * 60 * 1000;
// Sessions : 90 jours sans visite, 180 jours au plus. last_seen_at n'est réécrit qu'une fois par heure.
const SESSION_IDLE_MS = 90 * DAY_MS;
export const SESSION_MAX_MS = 180 * DAY_MS;
const SESSION_TOUCH_MS = 60 * 60 * 1000;

export interface User {
  id: number;
  name: string;
  /** null : mot de passe pas encore généré, connexion impossible (voir provisionPasswords). */
  passwordHash: string | null;
  mustChangePassword: boolean;
}

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

// Migrations en place, numérotées par PRAGMA user_version : la base reste un seul
// fichier SQLite (sauvegardé côté hôte). On ajoute des étapes, on ne les modifie jamais.
const MIGRATIONS: string[][] = [
  [
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
  ],
  // Comptes utilisateurs. Une base qui contient déjà des données les rattache à un
  // utilisateur « admin », sans mot de passe : le serveur en génère un au démarrage.
  // La table accounts est recréée pour que le nom de compte soit unique par utilisateur.
  [
    `CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT,
      must_change_password INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL
    )`,
    `CREATE TABLE sessions (
      token_hash BLOB PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL
    )`,
    `INSERT INTO users (id, name, created_at)
      SELECT 1, 'admin', unixepoch() * 1000 WHERE EXISTS (SELECT 1 FROM accounts)`,
    `CREATE TABLE accounts_new (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL COLLATE NOCASE,
      color TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      closed INTEGER NOT NULL DEFAULT 0,
      baseline_month TEXT,
      baseline_invested INTEGER,
      baseline_perf REAL,
      UNIQUE (user_id, name)
    )`,
    `INSERT INTO accounts_new (id, user_id, name, color, position, closed, baseline_month, baseline_invested, baseline_perf)
      SELECT id, 1, name, color, position, closed, baseline_month, baseline_invested, baseline_perf FROM accounts`,
    `DROP TABLE accounts`,
    `ALTER TABLE accounts_new RENAME TO accounts`,
  ],
];

interface UserRow {
  id: number;
  name: string;
  password_hash: string | null;
  must_change_password: number;
}

const toUser = (r: UserRow): User => ({
  id: r.id,
  name: r.name,
  passwordHash: r.password_hash,
  mustChangePassword: r.must_change_password === 1,
});

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

const tokenHash = (token: string) => createHash("sha256").update(token).digest();

export function openStore(path: string): Store {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  return new Store(new Database(path, { create: true, strict: true }));
}

export class Store {
  constructor(readonly db: Database) {
    db.run("PRAGMA journal_mode = WAL");
    const { user_version: version } = db.query<{ user_version: number }, []>("PRAGMA user_version").get()!;
    // Base plus récente que le code (retour à une ancienne image) : ne rien servir.
    if (version > MIGRATIONS.length) throw new Error(`Base en version ${version}, plus récente que l'app (version ${MIGRATIONS.length}).`);
    if (version < MIGRATIONS.length) {
      // Clés étrangères inactives pendant les migrations : avec elles, le DROP TABLE
      // d'une table recréée déclencherait ON DELETE CASCADE et viderait statements.
      // Ce PRAGMA est sans effet dans une transaction, d'où cet ordre.
      db.run("PRAGMA foreign_keys = OFF");
      db.transaction(() => {
        for (const step of MIGRATIONS.slice(version)) for (const sql of step) db.run(sql);
        if (db.query("PRAGMA foreign_key_check").all().length > 0) throw new Error("Migration : clés étrangères incohérentes.");
        db.run(`PRAGMA user_version = ${MIGRATIONS.length}`);
      })();
    }
    db.run("PRAGMA foreign_keys = ON");
  }

  /** Seul accès aux comptes et aux relevés : tout y est limité à un utilisateur. */
  forUser(userId: number): Ledger {
    return new Ledger(this.db, userId);
  }

  // Utilisateurs

  users(): User[] {
    return this.db.query<UserRow, []>("SELECT * FROM users ORDER BY name").all().map(toUser);
  }

  userByName(name: string): User | null {
    const row = this.db.query<UserRow, [string]>("SELECT * FROM users WHERE name = ?").get(name);
    return row ? toUser(row) : null;
  }

  /** Sans empreinte, le compte attend son mot de passe temporaire (provisionPasswords). */
  addUser(name: string, passwordHash: string | null = null, mustChangePassword = true): User {
    const row = this.db
      .query<UserRow, [string, string | null, number, number]>(
        "INSERT INTO users (name, password_hash, must_change_password, created_at) VALUES (?, ?, ?, ?) RETURNING *",
      )
      .get(name, passwordHash, mustChangePassword ? 1 : 0, Date.now())!;
    return toUser(row);
  }

  renameUser(id: number, name: string): void {
    this.db.query("UPDATE users SET name = ? WHERE id = ?").run(name, id);
  }

  /** Change le mot de passe et révoque toutes les sessions du compte. */
  setPassword(id: number, passwordHash: string, mustChangePassword: boolean): void {
    this.transaction(() => {
      this.db.query("UPDATE users SET password_hash = ?, must_change_password = ? WHERE id = ?").run(passwordHash, mustChangePassword ? 1 : 0, id);
      this.db.query("DELETE FROM sessions WHERE user_id = ?").run(id);
    });
  }

  // Sessions : jeton aléatoire de 256 bits dans le cookie, seul son SHA-256 en base.

  createSession(userId: number): string {
    const token = randomBytes(32).toString("base64url");
    const now = Date.now();
    this.db.query("DELETE FROM sessions WHERE created_at <= ? OR last_seen_at <= ?").run(now - SESSION_MAX_MS, now - SESSION_IDLE_MS);
    this.db.query("INSERT INTO sessions (token_hash, user_id, created_at, last_seen_at) VALUES (?, ?, ?, ?)").run(tokenHash(token), userId, now, now);
    return token;
  }

  sessionUser(token: string): User | null {
    if (token.length > 100) return null;
    const hash = tokenHash(token);
    const row = this.db
      .query<UserRow & { session_created: number; session_seen: number }, [Buffer]>(
        `SELECT u.*, s.created_at AS session_created, s.last_seen_at AS session_seen
         FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`,
      )
      .get(hash);
    if (!row) return null;
    const now = Date.now();
    if (now >= Math.min(row.session_seen + SESSION_IDLE_MS, row.session_created + SESSION_MAX_MS)) {
      this.db.query("DELETE FROM sessions WHERE token_hash = ?").run(hash);
      return null;
    }
    if (now - row.session_seen >= SESSION_TOUCH_MS) this.db.query("UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?").run(now, hash);
    return toUser(row);
  }

  deleteSession(token: string): void {
    this.db.query("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash(token));
  }

  transaction(fn: () => void): void {
    this.db.transaction(fn)();
  }
}

const STATEMENT_COLUMNS = "SELECT s.month, s.account_id AS accountId, s.value, s.deposits FROM statements s JOIN accounts a ON a.id = s.account_id";

/** Les comptes et relevés d'un utilisateur : ceux d'un autre n'existent pas ici. */
export class Ledger {
  constructor(
    private readonly db: Database,
    private readonly userId: number,
  ) {}

  accounts(): Account[] {
    return this.db.query<AccountRow, [number]>("SELECT * FROM accounts WHERE user_id = ? ORDER BY position, id").all(this.userId).map(toAccount);
  }

  account(id: number): Account | null {
    const row = this.db.query<AccountRow, [number, number]>("SELECT * FROM accounts WHERE id = ? AND user_id = ?").get(id, this.userId);
    return row ? toAccount(row) : null;
  }

  accountByName(name: string): Account | null {
    const row = this.db.query<AccountRow, [string, number]>("SELECT * FROM accounts WHERE name = ? AND user_id = ?").get(name, this.userId);
    return row ? toAccount(row) : null;
  }

  addAccount(name: string, color?: string): Account {
    const { n, next } = this.db
      .query<{ n: number; next: number }, [number]>("SELECT count(*) AS n, coalesce(max(position), 0) + 1 AS next FROM accounts WHERE user_id = ?")
      .get(this.userId)!;
    const row = this.db
      .query<AccountRow, [number, string, string, number]>("INSERT INTO accounts (user_id, name, color, position) VALUES (?, ?, ?, ?) RETURNING *")
      .get(this.userId, name, color ?? PALETTE[n % PALETTE.length]!, next)!;
    return toAccount(row);
  }

  updateAccount(a: Account): void {
    this.db
      .query(
        `UPDATE accounts SET name = ?, color = ?, position = ?, closed = ?,
           baseline_month = ?, baseline_invested = ?, baseline_perf = ? WHERE id = ? AND user_id = ?`,
      )
      .run(a.name, a.color, a.position, a.closed ? 1 : 0, a.baselineMonth, a.baselineInvested, a.baselinePerf, a.id, this.userId);
  }

  statements(): Statement[] {
    return this.db.query<Statement, [number]>(`${STATEMENT_COLUMNS} WHERE a.user_id = ? ORDER BY s.month, s.account_id`).all(this.userId);
  }

  statementsFor(month: string): Map<number, Statement> {
    const rows = this.db.query<Statement, [string, number]>(`${STATEMENT_COLUMNS} WHERE s.month = ? AND a.user_id = ?`).all(month, this.userId);
    return new Map(rows.map((s) => [s.accountId, s]));
  }

  lastStatement(accountId: number): Statement | null {
    return this.db
      .query<Statement, [number, number]>(`${STATEMENT_COLUMNS} WHERE s.account_id = ? AND a.user_id = ? ORDER BY s.month DESC LIMIT 1`)
      .get(accountId, this.userId);
  }

  saveStatement(s: Statement): void {
    this.db
      .query(
        `INSERT INTO statements (month, account_id, value, deposits)
         SELECT ?, id, ?, ? FROM accounts WHERE id = ? AND user_id = ?
         ON CONFLICT (month, account_id) DO UPDATE SET value = excluded.value, deposits = excluded.deposits`,
      )
      .run(s.month, s.value, s.deposits, s.accountId, this.userId);
  }

  /** Import de l'historique : met à jour la valeur sans toucher aux versements déjà saisis. */
  importValue(month: string, accountId: number, value: number): void {
    this.db
      .query(
        `INSERT INTO statements (month, account_id, value, deposits)
         SELECT ?, id, ?, NULL FROM accounts WHERE id = ? AND user_id = ?
         ON CONFLICT (month, account_id) DO UPDATE SET value = excluded.value`,
      )
      .run(month, value, accountId, this.userId);
  }

  deleteStatement(month: string, accountId: number): void {
    this.db
      .query("DELETE FROM statements WHERE month = ? AND account_id IN (SELECT id FROM accounts WHERE id = ? AND user_id = ?)")
      .run(month, accountId, this.userId);
  }

  transaction(fn: () => void): void {
    this.db.transaction(fn)();
  }
}

/**
 * Copie cohérente d'une base existante (outil de dev : la prod est sauvegardée
 * côté hôte). create: false pour échouer plutôt que de copier une base vide
 * créée par erreur.
 */
export function backupDatabase(source: string, dest: string): void {
  const db = new Database(source, { create: false, readwrite: true });
  try {
    mkdirSync(dirname(dest), { recursive: true });
    rmSync(dest, { force: true });
    db.query("VACUUM INTO ?").run(dest);
  } finally {
    db.close();
  }
}
