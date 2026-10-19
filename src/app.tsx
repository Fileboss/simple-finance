import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { compute } from "./calc.ts";
import { centsToInput, eur, investedFromPerformance, parseCents, parsePercent } from "./money.ts";
import { addMonths, currentMonth, isMonth, monthLabel } from "./months.ts";
import { applySheet, checkSheet, parseSheet, type Baseline } from "./sheet.ts";
import type { Account, Store } from "./store.ts";
import { Dashboard, EmptyDashboard } from "./views/dashboard.tsx";
import { AccountsPage, EntryForm, ImportForm, ImportPreview, type EntryRow, type ImportInput } from "./views/forms.tsx";

const field = (body: Record<string, unknown>, name: string) => {
  const v = body[name];
  return typeof v === "string" ? v.trim() : "";
};

export function createApp(store: Store) {
  const app = new Hono();

  // Pas de login (accès limité au tailnet), mais on refuse les formulaires
  // postés depuis un autre site.
  app.use(async (c, next) => {
    const site = c.req.header("sec-fetch-site");
    if (c.req.method !== "GET" && c.req.method !== "HEAD" && site && site !== "same-origin" && site !== "none") {
      return c.text("Requête refusée", 403);
    }
    await next();
  });

  app.use("/static/*", serveStatic({ root: "./" }));
  app.get("/health", (c) => c.text("ok"));

  app.get("/", (c) => {
    const accounts = store.accounts();
    const statements = store.statements();
    if (statements.length === 0) return c.html(<EmptyDashboard />);
    const data = compute(accounts, statements);
    let month = c.req.query("month");
    if (!month || !data.months.includes(month)) {
      const year = c.req.query("year");
      month = (year && data.months.filter((m) => m.startsWith(`${year}-`)).at(-1)) || data.months.at(-1)!;
    }
    const notice = c.req.query("saved") ? "Relevés enregistrés." : c.req.query("imported") ? "Historique importé." : undefined;
    return c.html(<Dashboard accounts={accounts} data={data} month={month} notice={notice} />);
  });

  // Saisie mensuelle

  const entryAccounts = (month: string) => {
    const current = store.statementsFor(month);
    return store.accounts().filter((a) => !a.closed || current.has(a.id));
  };

  // Compte ouvert en cours de suivi : aucun relevé avant ce mois alors que d'autres comptes en ont.
  const openingCheck = (month: string) => {
    const before = store.statements().filter((s) => s.month < month);
    const seen = new Set(before.map((s) => s.accountId));
    return (accountId: number) => before.length > 0 && !seen.has(accountId);
  };

  app.get("/saisie", (c) => {
    const last = store.statements().at(-1)?.month;
    const q = c.req.query("month");
    const month = isMonth(q) ? q : last ? addMonths(last, 1) : currentMonth();
    const current = store.statementsFor(month);
    const previous = store.statementsFor(addMonths(month, -1));
    const isOpening = openingCheck(month);
    const rows: EntryRow[] = entryAccounts(month).map((account) => {
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
    const deleted = store.account(Number(c.req.query("deleted")));
    const notice = deleted ? `Relevé de ${deleted.name} supprimé pour ${monthLabel(month)}.` : undefined;
    return c.html(<EntryForm month={month} rows={rows} notice={notice} />);
  });

  app.post("/saisie", async (c) => {
    const body = await c.req.parseBody();
    const month = field(body, "month");
    if (!isMonth(month)) return c.text("Mois invalide", 400);
    const previous = store.statementsFor(addMonths(month, -1));
    const isOpening = openingCheck(month);
    const current = store.statementsFor(month);
    const parsed = entryAccounts(month).map((account) => {
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
    store.transaction(() => {
      for (const { row, value, deposits } of parsed) {
        store.saveStatement({ month, accountId: row.account.id, value: value!, deposits });
      }
    });
    return c.redirect(`/?month=${month}&saved=1`, 303);
  });

  // Suppression explicite d'un relevé (bouton dédié de la saisie).
  app.post("/saisie/supprimer", async (c) => {
    const body = await c.req.parseBody();
    const month = field(body, "month");
    const account = store.account(Number(field(body, "account")));
    if (!isMonth(month) || !account) return c.text("Requête invalide", 400);
    store.deleteStatement(month, account.id);
    return c.redirect(`/saisie?month=${month}&deleted=${account.id}`, 303);
  });

  // Comptes

  const accountsPage = (opts: { error?: string; notice?: string } = {}) => {
    const statements = store.statements();
    const values = new Map(statements.map((s) => [`${s.month}:${s.accountId}`, s.value]));
    const lasts = new Map(statements.map((s) => [s.accountId, s])); // triés par mois : le dernier gagne
    return <AccountsPage accounts={store.accounts()} values={values} lasts={lasts} {...opts} />;
  };
  const validColor = (s: string) => /^#[0-9a-f]{6}$/i.test(s);

  app.get("/comptes", (c) => {
    const closed = store.lastStatement(Number(c.req.query("closed")));
    const notice = closed
      ? `Compte clôturé : relevé de clôture créé pour ${monthLabel(closed.month)} (valeur 0, retrait de ${eur(-(closed.deposits ?? 0))}).`
      : c.req.query("saved")
        ? "Compte enregistré."
        : undefined;
    return c.html(accountsPage({ notice }));
  });

  app.post("/comptes", async (c) => {
    const body = await c.req.parseBody();
    const name = field(body, "name");
    const color = field(body, "color");
    if (!name) return c.html(accountsPage({ error: "Le nom est obligatoire." }), 400);
    if (store.accountByName(name)) return c.html(accountsPage({ error: `Le compte « ${name} » existe déjà.` }), 400);
    store.addAccount(name, validColor(color) ? color : undefined);
    return c.redirect("/comptes", 303);
  });

  app.post("/comptes/:id", async (c) => {
    const account = store.account(Number(c.req.param("id")));
    if (!account) return c.notFound();
    const body = await c.req.parseBody();
    try {
      const updated = readAccount(account, body);
      const other = store.accountByName(updated.name);
      if (other && other.id !== account.id) throw new Error(`Le compte « ${updated.name} » existe déjà.`);
      // Clôture : relevé final à 0 avec le retrait du solde, sinon le solde disparaîtrait en perte fictive.
      const last = store.lastStatement(account.id);
      const closing =
        updated.closed && !account.closed && last && last.value !== 0
          ? { month: addMonths(last.month, 1), accountId: account.id, value: 0, deposits: -last.value }
          : null;
      store.transaction(() => {
        store.updateAccount(updated);
        if (closing) store.saveStatement(closing);
      });
      if (closing) return c.redirect(`/comptes?closed=${account.id}`, 303);
    } catch (e) {
      return c.html(accountsPage({ error: `${account.name} : ${(e as Error).message}` }), 400);
    }
    return c.redirect("/comptes?saved=1", 303);
  });

  function readAccount(account: Account, body: Record<string, unknown>): Account {
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
      const value = store.statementsFor(month).get(account.id)?.value;
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

  const preview = (csv: string, opts: { inputs?: ImportInput[]; error?: string } = {}) => {
    const data = parseSheet(csv);
    const existing = new Map(store.accounts().map((a) => [a.name.toLowerCase(), a]));
    return <ImportPreview csv={csv} data={data} checks={checkSheet(data)} existing={existing} {...opts} />;
  };

  app.post("/import/preview", async (c) => {
    const body = await c.req.parseBody();
    const file = body.file;
    const csv = file instanceof File && file.size > 0 ? await file.text() : field(body, "csv");
    if (!csv) return c.html(<ImportForm error="Choisis un fichier CSV ou colle son contenu." />, 400);
    try {
      return c.html(preview(csv));
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
        return c.html(preview(csv, { inputs, error: `${data.accounts[i]!.name} : ${input.error}` }), 400);
      }
    }
    applySheet(store, data, baselines);
    return c.redirect("/?imported=1", 303);
  });

  return app;
}
