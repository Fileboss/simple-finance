# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

A self-hosted dashboard that tracks **monthly account balances** (not transactions) and replaces a hand-maintained Google Sheet. For each account and for the total, it shows the month-end value, the change vs the previous month, and the change since January, in € and %, **separating gains from deposits**. `README.md` (in French) is the design document: read it before changing calculations or scope. The UI and all user-facing text are in French.

## Commands

Bun may not be installed on the host. In that case, run it through Docker: `docker run --rm -v "$PWD":/app -w /app oven/bun:1-alpine <cmd>`.

- `bun run dev`: server with watch at http://localhost:3000, DB at `data/finance.sqlite` (override with `DB_PATH`, `PORT`)
- `bun test`, `bun test test/calc.test.ts`, `bun test -t "<name pattern>"`
- `bun run typecheck` (tsc; JSX resolves to `hono/jsx` through `tsconfig.json`, so the Docker image must copy that file)
- `bun run import <export.csv> [--force]`: one-shot history import from the Sheet
- `bun run backup [dest]`: consistent `VACUUM INTO` copy for restic
- `docker build -t simple-finance .` for a local image. CI (`.github/workflows/docker.yml`) runs typecheck and tests, then publishes multi-arch images to `ghcr.io/fileboss/simple-finance`: `:latest` from `main`, `:X.Y.Z` from `vX.Y.Z` tags. `compose.yaml` is the homelab stack, and it pulls that image.

## Architecture

- `src/calc.ts`: **every calculation**, pure. `compute(accounts, statements)` fills the months between the first and last statement, then returns per-account and total `Point`s. Each account-month has a `State`. `absent` means before the account's first statement, or after its last one if it is closed; the account is left out of the total. `held` means there is a statement. `missing` means no statement between those bounds: the value is unknown, **never 0**. A missing statement makes the total `incomplete`: it shows the partial value, but variation, gain and return are `null` for that month and the next. A statement with `deposits = null` also makes gain, return and invested `null`. Closing an account writes a final statement with value 0 and `deposits = −balance`. An account opened during tracking has a previous value of 0, so its first month's deposits must equal the amount brought in (enforced in the entry form). The views only format these points.
- `src/store.ts`: `bun:sqlite`, with two tables: `accounts` (with optional `baseline_month` / `baseline_invested`: the starting capital inferred from the broker's displayed performance) and `statements` (PK `month`, `account_id`). Months are `"YYYY-MM"` strings.
- `src/sheet.ts`: parses the Sheet's CSV export (account rows, then `Total`, then the `plusvalue` / `janvier` control rows). `checkSheet` recomputes those rows with `compute` and reports any 1-cent difference. `applySheet` imports with `deposits = NULL` and never overwrites deposits already entered. It can also set each account's baseline from a displayed performance entered in the import preview, at that account's last imported month.
- `src/app.tsx`: Hono routes (`/`, `/saisie`, `/comptes`, `/import`), with post/redirect/get for forms. A middleware rejects cross-site POSTs (`Sec-Fetch-Site`) because there is no login. `src/views/*.tsx`: server-rendered Hono JSX.
- `static/`: `style.css` (CSS tokens, light/dark), vendored `chart.umd.min.js`, and `charts.js`, which only renders the JSON that `#chart-data` provides.

The repo is **public**: personal figures stay in `data/` (gitignored, along with `reference.png`, a screenshot of the Sheet). Committed tests use synthetic numbers. `test/sheet.test.ts` also checks the real export when `data/sheet.csv` exists.

## Rules from the design

- **Store money as integer cents**, never floats. After a CSV import, the totals and raw changes must match the Sheet exactly (e.g. the October 2026 total is 50 330,07 €).
- **The server does all the calculations.** It injects chart data into the page as JSON (`<script type="application/json">`), and `static/charts.js` only renders it.
- **No outbound requests.** The app serves all assets itself (Chart.js, CSS) and must work offline on the tailnet.
- **Backups use `VACUUM INTO`** to write a separate file, which restic then picks up. Never copy the live DB file.
- **Test the calculations** (gain, monthly return, return since January) against figures from the Sheet.
- Monthly % divides by the previous month's value. The Sheet divides by the current month's value, so its monthly % differ slightly: only € figures must match.

## Data model and formulas

One record per (month, account): `mois`, `compte`, `valeur`, `versements` (net deposits for the month). `versements` defaults to `0` but is **NULL when unknown**: historical months imported from the Sheet have no deposit data. For those months, show the raw change and mark gain and return as unavailable rather than computing a figure.

For account value `V(m)` and net deposits `D(m)`:

- raw change: `V(m) − V(m−1)`
- gain: `V(m) − V(m−1) − D(m)`
- monthly return: `gain(m) / (V(m−1) + D(m)/2)` (simplified Modified Dietz; still valid when `V(m−1) = 0`)
- gain since January: `V(m) − V(jan) − Σ D(feb..m)`
- return since January: monthly returns chained, `Π(1 + r(k)) − 1` for k from February to m (time-weighted)
- total: sum values, deposits and gains across accounts, then apply the same formulas to the sums

Each account's starting capital is `value / (1 + performance shown by the broker app)` at a chosen month. It is stored on the account as a baseline rather than as a deposit, so that month's gain isn't skewed. Invested capital then accumulates monthly deposits. An account opened during tracking starts from its first month's deposits.

The account list (Livret A, Assurance Vie, PEA, Amundi, Binance, Trade Republic) must be editable: accounts can be added and closed.

## Product goal

The app must stay **lightweight yet pleasant to use**. Keep the footprint minimal (one container, few dependencies), but don't settle for a bare UI: the forms, tables and charts should be comfortable for monthly use.

## Hosting

Deployment config lives in a separate repo, `qui-est-ce_infra` (homelab). The app runs as its own Docker Compose stack with a single lightweight container. It is reachable **only on the tailnet** via `tailscale serve` and never exposed publicly. The app itself serves plain HTTP: `tailscale serve` handles TLS and access, so the app has no TLS code and, for now, no login (one may be added later). The SQLite DB is backed up nightly to the VPS restic repo, and the image is versioned.

## Out of scope

Per-transaction entry or budgeting, bank sync, and per-security tracking.
