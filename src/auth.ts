// Mots de passe et limitation des tentatives. Les sessions sont dans store.ts,
// les pages et le cookie dans app.tsx.
import type { Ledger, Store, User } from "./store.ts";

export type AppEnv = { Variables: { user: User; ledger: Ledger } };

// Argon2id, paramètres de l'OWASP (m = 19 Mio, t = 2, p = 1).
const ARGON2 = { algorithm: "argon2id", memoryCost: 19456, timeCost: 2 } as const;
const MIN_PASSWORD = 15;
const MAX_PASSWORD = 1024;

export const hashPassword = (password: string) => Bun.password.hash(password, ARGON2);

let dummy: Promise<string> | undefined;

/** Le calcul coûteux est fait même sans empreinte : un nom inconnu coûte autant qu'un nom connu. */
export async function verifyPassword(password: string, hash: string | null): Promise<boolean> {
  dummy ??= hashPassword(generatePassword());
  const target = hash ?? (await dummy);
  if (!password || password.length > MAX_PASSWORD) return false;
  return (await Bun.password.verify(password, target)) && hash !== null;
}

export function passwordError(password: string): string | null {
  const length = [...password].length;
  if (length < MIN_PASSWORD) return `Le mot de passe doit faire au moins ${MIN_PASSWORD} caractères.`;
  if (password.length > MAX_PASSWORD) return `Le mot de passe doit faire au plus ${MAX_PASSWORD} caractères.`;
  return null;
}

// ASCII seulement : COLLATE NOCASE de SQLite ne couvre pas le reste.
export const validUserName = (name: string) => /^[A-Za-z0-9._-]{1,64}$/.test(name);

/** 6 groupes de 4 caractères sans ambiguïté (≈ 120 bits). */
export function generatePassword(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const limit = 256 - (256 % alphabet.length); // rejet : distribution uniforme
  const chars: string[] = [];
  while (chars.length < 24) {
    const byte = crypto.getRandomValues(new Uint8Array(1))[0]!;
    if (byte < limit) chars.push(alphabet[byte % alphabet.length]!);
  }
  return chars.join("").replace(/(.{4})(?=.)/g, "$1-");
}

/**
 * Donne un mot de passe temporaire aux comptes qui n'en ont pas encore (créés par une
 * migration). Affiché avant l'écriture : si le processus s'arrête entre les deux, le
 * prochain démarrage en affiche un autre plutôt que d'en perdre un.
 */
export async function provisionPasswords(store: Store, log: (line: string) => void = console.log): Promise<void> {
  for (const user of store.users()) {
    if (user.passwordHash !== null) continue;
    const password = generatePassword();
    const hash = await hashPassword(password);
    log(`Compte « ${user.name} » : mot de passe temporaire ${password} (à changer à la première connexion)`);
    store.setPassword(user.id, hash, true);
  }
}

// Par compte : simple ralentissement. Un blocage permettrait à quiconque connaît un
// nom d'empêcher son propriétaire de se connecter. Plafonné sous le délai d'inactivité
// de Bun.serve (10 s), qui couperait sinon la connexion.
const THROTTLE_THRESHOLD = 5;
const THROTTLE_MAX_MS = 8000;
const THROTTLE_WINDOW_MS = 24 * 60 * 60 * 1000;
const THROTTLE_MAX_ENTRIES = 1000;

export function loginThrottle() {
  const failures = new Map<string, { count: number; last: number }>();
  const key = (name: string) => name.toLowerCase().slice(0, 64);
  const recent = (k: string) => {
    const entry = failures.get(k);
    return entry && Date.now() - entry.last < THROTTLE_WINDOW_MS ? entry.count : 0;
  };
  return {
    async wait(name: string) {
      const count = recent(key(name));
      if (count >= THROTTLE_THRESHOLD) await Bun.sleep(Math.min(1000 * 2 ** (count - THROTTLE_THRESHOLD), THROTTLE_MAX_MS));
    },
    fail(name: string) {
      const k = key(name);
      if (failures.size >= THROTTLE_MAX_ENTRIES && !failures.has(k)) failures.clear();
      failures.set(k, { count: recent(k) + 1, last: Date.now() });
    },
    clear(name: string) {
      failures.delete(key(name));
    },
  };
}
