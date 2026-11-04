import { Hono, type Context } from "hono";
import { serveStatic } from "hono/bun";
import { contextStorage } from "hono/context-storage";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { hashPassword, loginThrottle, passwordError, verifyPassword, type AppEnv } from "./auth.ts";
import { compute } from "./calc.ts";
import { centsToInput, eur, investedFromPerformance, parseCents, parsePercent } from "./money.ts";
import { addMonths, currentMonth, isMonth, monthLabel } from "./months.ts";
import { applySheet, checkSheet, parseSheet, type Baseline } from "./sheet.ts";
import { SESSION_MAX_MS, type Account, type Ledger, type Store } from "./store.ts";
import { LoginForm, PasswordForm } from "./views/auth.tsx";
import { Dashboard, EmptyDashboard } from "./views/dashboard.tsx";
import { AccountsPage, EntryForm, ImportForm, ImportPreview, type EntryRow, type ImportInput } from "./views/forms.tsx";

const field = (body: Record<string, unknown>, name: string) => {
  const v = body[name];
  return typeof v === "string" ? v.trim() : "";
};

// Un mot de passe n'est jamais retouché : les espaces en font partie.
const secret = (body: Record<string, unknown>, name: string) => {
  const v = body[name];
  return typeof v === "string" ? v : "";
};

const LOGIN_FAILED = "Identifiant ou mot de passe incorrect.";

export function createApp(store: Store, options: { secureCookie?: boolean } = {}) {
  const secureCookie = options.secureCookie ?? true;
  // Nom propre à l'app : les services du homelab partagent le même hôte et les cookies
  // ne sont pas isolés par port. Secure exige le HTTPS de tailscale serve (en dev : INSECURE_COOKIE=1).
  const cookieName = secureCookie ? "__Host-finance-session" : "finance-session";
  const app = new Hono<AppEnv>();
  const throttle = loginThrottle();

  app.use(contextStorage());

  // On refuse les formulaires postés depuis un autre site, y compris un autre port du
  // même hôte (same-site), que le cookie SameSite=Lax ne couvre pas.
  app.use(async (c, next) => {
    const site = c.req.header("sec-fetch-site");
    if (c.req.method !== "GET" && c.req.method !== "HEAD" && site && site !== "same-origin" && site !== "none") {
      return c.text("Requête refusée", 403);
    }
    await next();
  });

  app.use("/static/*", serveStatic({ root: "./" }));
  app.get("/health", (c) => c.text("ok"));

  // Connexion

  const startSession = (c: Context<AppEnv>, userId: number) =>
    setCookie(c, cookieName, store.createSession(userId), {
      path: "/",
      httpOnly: true,
      secure: secureCookie,
      sameSite: "Lax", // Strict ferait redemander la connexion en arrivant depuis un lien externe
      maxAge: SESSION_MAX_MS / 1000,
    });

  const checkPassword = async (name: string, password: string, hash: string | null) => {
    await throttle.wait(name);
    const ok = await verifyPassword(password, hash);
    if (ok) throttle.clear(name);
    else throttle.fail(name);
    return ok;
  };

  app.get("/login", (c) => {
    const token = getCookie(c, cookieName);
    if (token && store.sessionUser(token)) return c.redirect("/", 303);
    return c.html(<LoginForm />);
  });

  app.post("/login", async (c) => {
    const body = await c.req.parseBody();
    const name = field(body, "name");
    const user = store.userByName(name);
    // Même message et même calcul pour un compte inconnu et un mot de passe faux.
    if (!(await checkPassword(name, secret(body, "password"), user?.passwordHash ?? null)) || !user) {
      return c.html(<LoginForm error={LOGIN_FAILED} />, 401);
    }
    const old = getCookie(c, cookieName);
    if (old) store.deleteSession(old);
    startSession(c, user.id);
    return c.redirect(user.mustChangePassword ? "/mot-de-passe" : "/", 303);
  });

  // Tout ce qui suit exige une session : les données passent par c.var.ledger, limité à l'utilisateur.
  app.use(async (c, next) => {
    const token = getCookie(c, cookieName);
    const user = token ? store.sessionUser(token) : null;
    if (!user) return c.redirect("/login", 303);
    c.set("user", user);
    c.set("ledger", store.forUser(user.id));
    if (user.mustChangePassword && c.req.path !== "/mot-de-passe" && c.req.path !== "/logout") return c.redirect("/mot-de-passe", 303);
    await next();
    c.header("Cache-Control", "no-store");
  });

  app.post("/logout", (c) => {
    store.deleteSession(getCookie(c, cookieName)!);
    deleteCookie(c, cookieName, { path: "/", secure: secureCookie });
    return c.redirect("/login", 303);
  });

  app.get("/mot-de-passe", (c) => {
    const user = c.var.user;
    return c.html(<PasswordForm name={user.name} required={user.mustChangePassword} />);
  });

  app.post("/mot-de-passe", async (c) => {
    const user = c.var.user;
    const body = await c.req.parseBody();
    const current = secret(body, "current");
    const password = secret(body, "password");
    const refuse = (error: string) => c.html(<PasswordForm name={user.name} required={user.mustChangePassword} error={error} />, 400);
    if (!(await checkPassword(user.name, current, user.passwordHash))) {
      return refuse(user.mustChangePassword ? "Mot de passe temporaire incorrect." : "Mot de passe actuel incorrect.");
    }
    const invalid = passwordError(password);
    if (invalid) return refuse(invalid);
    if (password !== secret(body, "confirm")) return refuse("La confirmation ne correspond pas au nouveau mot de passe.");
    if (password === current) return refuse("Le nouveau mot de passe doit être différent de l'ancien.");
    // Révoque toutes les sessions du compte, celle-ci comprise : on en ouvre une nouvelle.
    store.setPassword(user.id, await hashPassword(password), false);
    startSession(c, user.id);
    return c.redirect("/?password=1", 303);
  });

  app.get("/", (c) => {
    const ledger = c.var.ledger;
    const accounts = ledger.accounts();
    const statements = ledger.statements();
    const notice = c.req.query("password")
      ? "Mot de passe modifié."
      : c.req.query("saved")
        ? "Relevés enregistrés."
        : c.req.query("imported")
          ? "Historique importé."
          : undefined;
    if (statements.length === 0) return c.html(<EmptyDashboard notice={notice} />);
    const data = compute(accounts, statements);
    let month = c.req.query("month");
    if (!month || !data.months.includes(month)) {
      const year = c.req.query("year");
      month = (year && data.months.filter((m) => m.startsWith(`${year}-`)).at(-1)) || data.months.at(-1)!;
    }
    return c.html(<Dashboard accounts={accounts} data={data} month={month} notice={notice} />);
  });

  // Saisie mensuelle

  const entryAccounts = (ledger: Ledger, month: string) => {
    const current = ledger.statementsFor(month);
    return ledger.accounts().filter((a) => !a.closed || current.has(a.id));
  };

  // Compte ouvert en cours de suivi : aucun relevé avant ce mois alors que d'autres comptes en ont.
  const openingCheck = (ledger: Ledger, month: string) => {
    const before = ledger.statements().filter((s) => s.month < month);
    const seen = new Set(before.map((s) => s.accountId));
    return (accountId: number) => before.length > 0 && !seen.has(accountId);
  };

  app.get("/saisie", (c) => {
    const ledger = c.var.ledger;
    const last = ledger.statements().at(-1)?.month;
    const q = c.req.query("month");
    const month = isMonth(q) ? q : last ? addMonths(last, 1) : currentMonth();
    const current = ledger.statementsFor(month);
    const previous = ledger.statementsFor(addMonths(month, -1));
    const isOpening = openingCheck(ledger, month);
    const rows: EntryRow[] = entryAccounts(ledger, month).map((account) => {
      const s = current.get(account.id);
      const opening = isOpening(account.id);
      return {
        account,
        previous: previous.get(account.id),
        opening,
        saved: s !== undefined,
        value: s ? centsToInput(s.value) : "",
        deposits: s ? (s.deposits === null ? "" : centsToInput(s.deposits)) : opening ? "" : "0",
      };
    });
    const deleted = ledger.account(Number(c.req.query("deleted")));
    const notice = deleted ? `Relevé de ${deleted.name} supprimé pour ${monthLabel(month)}.` : undefined;
    return c.html(<EntryForm month={month} rows={rows} notice={notice} />);
  });

  app.post("/saisie", async (c) => {
    const ledger = c.var.ledger;
    const body = await c.req.parseBody();
    const month = field(body, "month");
    if (!isMonth(month)) return c.text("Mois invalide", 400);
    const previous = ledger.statementsFor(addMonths(month, -1));
    const isOpening = openingCheck(ledger, month);
    const current = ledger.statementsFor(month);
    const parsed = entryAccounts(ledger, month).map((account) => {
      const row: EntryRow = {
        account,
        previous: previous.get(account.id),
        opening: isOpening(account.id),
        saved: current.has(account.id),
        value: field(body, `value_${account.id}`),
        deposits: field(body, `deposits_${account.id}`),
      };
      let value: number | null = null;
      let deposits: number | null = null;
      try {
        value = parseCents(row.value);
        deposits = parseCents(row.deposits);
        if (value === null) row.error = "Valeur obligatoire";
        else if (row.opening && value !== null && deposits === null)
          row.error = "Premier relevé : indique le montant apporté dans Versements, sinon toute la valeur compte comme un gain.";
      } catch (e) {
        row.error = (e as Error).message;
      }
      return { row, value, deposits };
    });
    if (parsed.some((p) => p.row.error)) {
      c.status(400);
      return c.html(<EntryForm month={month} rows={parsed.map((p) => p.row)} error="Certains montants sont à corriger." />);
    }
    ledger.transaction(() => {
      for (const { row, value, deposits } of parsed) {
        ledger.saveStatement({ month, accountId: row.account.id, value: value!, deposits });
      }
    });
    return c.redirect(`/?month=${month}&saved=1`, 303);
  });

  // Suppression explicite d'un relevé (bouton dédié de la saisie).
  app.post("/saisie/supprimer", async (c) => {
    const ledger = c.var.ledger;
    const body = await c.req.parseBody();
    const month = field(body, "month");
    const account = ledger.account(Number(field(body, "account")));
    if (!isMonth(month) || !account) return c.text("Requête invalide", 400);
    ledger.deleteStatement(month, account.id);
    return c.redirect(`/saisie?month=${month}&deleted=${account.id}`, 303);
  });

  // Comptes

  const accountsPage = (ledger: Ledger, opts: { error?: string; notice?: string } = {}) => {
    const statements = ledger.statements();
    const values = new Map(statements.map((s) => [`${s.month}:${s.accountId}`, s.value]));
    const lasts = new Map(statements.map((s) => [s.accountId, s])); // triés par mois : le dernier gagne
    return <AccountsPage accounts={ledger.accounts()} values={values} lasts={lasts} {...opts} />;
  };
  const validColor = (s: string) => /^#[0-9a-f]{6}$/i.test(s);

  app.get("/comptes", (c) => {
    const ledger = c.var.ledger;
    const closed = ledger.lastStatement(Number(c.req.query("closed")));
    const notice = closed
      ? `Compte clôturé : relevé de clôture créé pour ${monthLabel(closed.month)} (valeur 0, retrait de ${eur(-(closed.deposits ?? 0))}).`
      : c.req.query("saved")
        ? "Compte enregistré."
        : undefined;
    return c.html(accountsPage(ledger, { notice }));
  });

  app.post("/comptes", async (c) => {
    const ledger = c.var.ledger;
    const body = await c.req.parseBody();
    const name = field(body, "name");
    const color = field(body, "color");
    if (!name) return c.html(accountsPage(ledger, { error: "Le nom est obligatoire." }), 400);
    if (ledger.accountByName(name)) return c.html(accountsPage(ledger, { error: `Le compte « ${name} » existe déjà.` }), 400);
    ledger.addAccount(name, validColor(color) ? color : undefined);
    return c.redirect("/comptes", 303);
  });

  app.post("/comptes/:id", async (c) => {
    const ledger = c.var.ledger;
    const account = ledger.account(Number(c.req.param("id")));
    if (!account) return c.notFound();
    const body = await c.req.parseBody();
    try {
      const updated = readAccount(ledger, account, body);
      const other = ledger.accountByName(updated.name);
      if (other && other.id !== account.id) throw new Error(`Le compte « ${updated.name} » existe déjà.`);
      // Clôture : relevé final à 0 avec le retrait du solde, sinon le solde disparaîtrait en perte fictive.
      const last = ledger.lastStatement(account.id);
      const closing =
        updated.closed && !account.closed && last && last.value !== 0
          ? { month: addMonths(last.month, 1), accountId: account.id, value: 0, deposits: -last.value }
          : null;
      ledger.transaction(() => {
        ledger.updateAccount(updated);
        if (closing) ledger.saveStatement(closing);
      });
      if (closing) return c.redirect(`/comptes?closed=${account.id}`, 303);
    } catch (e) {
      return c.html(accountsPage(ledger, { error: `${account.name} : ${(e as Error).message}` }), 400);
    }
    return c.redirect("/comptes?saved=1", 303);
  });

  function readAccount(ledger: Ledger, account: Account, body: Record<string, unknown>): Account {
    const name = field(body, "name");
    if (!name) throw new Error("Le nom est obligatoire.");
    const color = field(body, "color");
    const position = Number.parseInt(field(body, "position"), 10);
    const updated: Account = {
      ...account,
      name,
      color: validColor(color) ? color : account.color,
      position: Number.isFinite(position) ? position : account.position,
      closed: field(body, "closed") === "on",
      baselineMonth: null,
      baselineInvested: null,
      baselinePerf: null,
    };
    const month = field(body, "baseline_month");
    const perf = parsePercent(field(body, "baseline_perf"));
    const invested = parseCents(field(body, "baseline_invested"));
    if (!month) {
      if (perf !== null || invested !== null) throw new Error("Indique le mois du capital de départ.");
      return updated;
    }
    if (!isMonth(month)) throw new Error("Mois invalide.");
    updated.baselineMonth = month;
    if (perf !== null) {
      const value = ledger.statementsFor(month).get(account.id)?.value;
      if (value === undefined) throw new Error("Pas de relevé ce mois-là : impossible de déduire le capital de la performance.");
      updated.baselineInvested = investedFromPerformance(value, perf);
      updated.baselinePerf = perf;
    } else if (invested !== null) {
      updated.baselineInvested = invested;
    } else {
      throw new Error("Indique la performance affichée ou le capital investi.");
    }
    return updated;
  }

  // Import du Sheet

  app.get("/import", (c) => c.html(<ImportForm />));

  const preview = (ledger: Ledger, csv: string, opts: { inputs?: ImportInput[]; error?: string } = {}) => {
    const data = parseSheet(csv);
    const existing = new Map(ledger.accounts().map((a) => [a.name.toLowerCase(), a]));
    return <ImportPreview csv={csv} data={data} checks={checkSheet(data)} existing={existing} {...opts} />;
  };

  app.post("/import/preview", async (c) => {
    const body = await c.req.parseBody();
    const file = body.file;
    const csv = file instanceof File && file.size > 0 ? await file.text() : field(body, "csv");
    if (!csv) return c.html(<ImportForm error="Choisis un fichier CSV ou colle son contenu." />, 400);
    try {
      return c.html(preview(c.var.ledger, csv));
    } catch (e) {
      return c.html(<ImportForm error={(e as Error).message} />, 400);
    }
  });

  app.post("/import", async (c) => {
    const body = await c.req.parseBody();
    const csv = field(body, "csv");
    let data;
    try {
      data = parseSheet(csv);
    } catch (e) {
      return c.html(<ImportForm error={(e as Error).message} />, 400);
    }
    const inputs: ImportInput[] = data.accounts.map((_, i) => ({ perf: field(body, `perf_${i}`), invested: field(body, `invested_${i}`) }));
    const baselines: Baseline[] = [];
    for (const [i, input] of inputs.entries()) {
      try {
        const perf = parsePercent(input.perf);
        if (perf !== null && perf <= -100) throw new Error("La performance doit être supérieure à -100 %");
        baselines.push({ perf, invested: perf === null ? parseCents(input.invested) : null });
      } catch (e) {
        input.error = (e as Error).message;
        return c.html(preview(c.var.ledger, csv, { inputs, error: `${data.accounts[i]!.name} : ${input.error}` }), 400);
      }
    }
    applySheet(c.var.ledger, data, baselines);
    return c.redirect("/?imported=1", 303);
  });

  return app;
}
