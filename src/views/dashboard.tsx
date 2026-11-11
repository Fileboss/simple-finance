import type { Child } from "hono/jsx";
import type { Computed, Point } from "../calc.ts";
import { eur, signedEur } from "../money.ts";
import { monthLabel, shortMonthLabel } from "../months.ts";
import type { Account } from "../store.ts";
import { Amount, Dot, Gain, Layout, Na, Notice, Pct, Ret, Split } from "./layout.tsx";

export function EmptyDashboard(props: { notice?: string }) {
  return (
    <Layout title="Tableau de bord" path="/">
      {props.notice && <Notice>{props.notice}</Notice>}
      <section class="empty">
        <h1>Aucun relevé pour l'instant</h1>
        <p>Commence par reprendre l'historique du Sheet, ou saisis directement un premier mois.</p>
        <p class="actions">
          <a class="button" href="/import">
            Importer le CSV du Sheet
          </a>
          <a class="button secondary" href="/saisie">
            Saisir un mois
          </a>
        </p>
      </section>
    </Layout>
  );
}

export function Dashboard(props: { accounts: Account[]; data: Computed; month: string; notice?: string }) {
  const { accounts, data, month } = props;
  const year = month.slice(0, 4);
  // Comme le Sheet : décembre de l'année précédente, puis les mois de l'année.
  const view = data.months.filter((m) => m.startsWith(`${year}-`) || m === `${Number(year) - 1}-12`);
  const years = [...new Set(data.months.map((m) => m.slice(0, 4)))];
  const at = (points: Point[], m: string) => points[data.months.indexOf(m)]!;
  const shown = accounts.filter((a) => view.some((m) => at(data.byAccount.get(a.id)!, m).state !== "absent"));
  const missing = shown.filter((a) => at(data.byAccount.get(a.id)!, month).state === "missing");
  const t = at(data.total, month);

  const chart = {
    labels: view.map(shortMonthLabel),
    accounts: shown.map((a) => ({
      name: a.name,
      color: a.color,
      values: view.map((m) => {
        const p = at(data.byAccount.get(a.id)!, m);
        return p.value === null ? null : p.value / 100;
      }),
    })),
    invested: view.map((m) => {
      const inv = at(data.total, m).invested;
      return inv === null ? null : inv / 100;
    }),
  };

  const totalRow = (label: string, cell: (p: Point) => Child) => (
    <tr class="metric">
      <th scope="row">{label}</th>
      {view.map((m) => (
        <td>{cell(at(data.total, m))}</td>
      ))}
    </tr>
  );

  return (
    <Layout
      title="Tableau de bord"
      path="/"
      scripts={
        <>
          <script
            type="application/json"
            id="chart-data"
            dangerouslySetInnerHTML={{ __html: JSON.stringify(chart).replace(/</g, "\\u003c") }}
          />
          <script src="/static/chart.umd.min.js" defer />
          <script src="/static/charts.js" defer />
        </>
      }
    >
      {props.notice && <Notice>{props.notice}</Notice>}
      <div class="page-head">
        <div>
          <h1>{monthLabel(month)}</h1>
          <p class="muted">Valorisation de fin de mois</p>
        </div>
        <nav class="years" aria-label="Année">
          {years.map((y) => (
            <a href={`/?year=${y}`} aria-current={y === year ? "page" : undefined}>
              {y}
            </a>
          ))}
        </nav>
      </div>

      <section class="kpis">
        <Kpi
          label="Valeur totale"
          main={<TotalValue p={t} />}
          sub={
            missing.length > 0 && (
              <span class="warn-text">
                incomplet : <a href={`/saisie?month=${month}`}>{missing.map((a) => a.name).join(", ")}</a> sans relevé
              </span>
            )
          }
          detail={<Split invested={t.invested} gained={t.totalGain} why={UNKNOWN_INVESTED} />}
        />
        <Kpi
          label="Vs mois précédent"
          main={<Amount cents={t.variation} signed why="Pas de mois précédent" />}
          sub={<Pct ratio={t.variationPct} />}
          detail={<Split invested={t.deposits} gained={t.gain} signed />}
        />
        <Kpi
          label="Depuis janvier"
          main={<Amount cents={t.ytdVariation} signed why="Pas de relevé de janvier" />}
          sub={<Pct ratio={t.ytdVariationPct} />}
          detail={<Split invested={t.ytdDeposits} gained={t.ytdGain} signed />}
        />
        <Kpi
          label="Gain du mois (hors versements)"
          main={<Gain cents={t.gain} />}
          sub={t.gain === null ? <span class="muted">versements inconnus</span> : <Ret ratio={t.ret} />}
        />
        <Kpi
          label="Plus-value totale"
          main={<Gain cents={t.totalGain} why={UNKNOWN_INVESTED} />}
          sub={
            t.invested === null ? (
              <span class="muted">
                capital investi inconnu · <a href="/comptes">le renseigner</a>
              </span>
            ) : (
              <>
                <Pct ratio={t.totalGainPct} /> <span class="muted">sur {eur(t.invested)} investis</span>
              </>
            )
          }
        />
      </section>

      <section class="card chart-card">
        <h2>Évolution {year}</h2>
        <div class="chart">
          <canvas id="chart" aria-label="Valorisation par compte et par mois" role="img" />
        </div>
      </section>

      <section class="card">
        <h2>Valorisation par mois</h2>
        <div class="table-wrap" data-scroll="end">
          <table class="grid">
            <thead>
              <tr>
                <th />
                {view.map((m) => (
                  <th scope="col" class={m === month ? "selected" : undefined}>
                    <a href={`/?month=${m}`}>{shortMonthLabel(m)}</a>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((a) => (
                <tr>
                  <th scope="row">
                    <AccountLink account={a} />
                  </th>
                  {view.map((m) => {
                    const p = at(data.byAccount.get(a.id)!, m);
                    return (
                      <td class={m === month ? "selected" : undefined}>
                        <AccountValue p={p} />
                      </td>
                    );
                  })}
                </tr>
              ))}
              <tr class="total">
                <th scope="row">Total</th>
                {view.map((m) => (
                  <td class={m === month ? "selected" : undefined}>
                    <TotalValue p={at(data.total, m)} />
                  </td>
                ))}
              </tr>
            </tbody>
            <tbody class="metrics">
              {totalRow("Variation", (p) => <Amount cents={p.variation} signed />)}
              {totalRow("Variation %", (p) => <Pct ratio={p.variationPct} />)}
              {totalRow("Versements", (p) => <Deposits cents={p.deposits} />)}
              {totalRow("Gain hors versements", (p) => <Gain cents={p.gain} />)}
              {totalRow("Rendement", (p) => <Ret ratio={p.ret} />)}
              {totalRow("Variation depuis janvier", (p) => <Amount cents={p.ytdVariation} signed />)}
              {totalRow("Variation depuis janvier %", (p) => <Pct ratio={p.ytdVariationPct} />)}
              {totalRow("Versements depuis janvier", (p) => <Deposits cents={p.ytdDeposits} />)}
              {totalRow("Gain depuis janvier", (p) => <Gain cents={p.ytdGain} />)}
              {totalRow("Rendement depuis janvier", (p) => <Ret ratio={p.ytdRet} />)}
            </tbody>
          </table>
        </div>
      </section>

      <section class="card">
        <h2>Détail par compte · {monthLabel(month)}</h2>
        <div class="table-wrap">
          <table class="grid detail">
            <thead>
              <tr>
                <th rowspan={2} />
                <th rowspan={2}>Valeur</th>
                <th rowspan={2}>Versements</th>
                <th colspan={4} class="group">
                  Vs mois précédent
                </th>
                <th colspan={5} class="group">
                  Depuis janvier
                </th>
                <th colspan={3} class="group">
                  Depuis le départ
                </th>
              </tr>
              <tr>
                <th>Variation</th>
                <th>%</th>
                <th>Gain</th>
                <th>Rendement</th>
                <th>Variation</th>
                <th>%</th>
                <th>Versements</th>
                <th>Gain</th>
                <th>Rendement</th>
                <th>Investi</th>
                <th>Plus-value</th>
                <th>%</th>
              </tr>
            </thead>
            <tbody>
              {shown.filter((a) => at(data.byAccount.get(a.id)!, month).state !== "absent").map((a) => (
                <DetailRow label={<AccountLink account={a} />} p={at(data.byAccount.get(a.id)!, month)} />
              ))}
              <DetailRow label="Total" p={t} total />
            </tbody>
          </table>
        </div>
        <p class="hint">
          « Variation » compare les valeurs brutes. « Gain » retire les versements du mois, et « Rendement » est pondéré par
          le temps (rendements mensuels chaînés). Un tiret signale un chiffre non disponible, par exemple parce que les
          versements du mois sont inconnus. Le nom d'un compte mène à sa performance.
        </p>
      </section>
    </Layout>
  );
}

/** Valeur d'un compte : relevé, relevé manquant (à saisir) ou compte inexistant ce mois-là. */
export function AccountValue(props: { p: Point }) {
  const { p } = props;
  if (p.state === "missing")
    return (
      <a class="missing" href={`/saisie?month=${p.month}`} title="Relevé manquant : valeur inconnue">
        manquant
      </a>
    );
  return p.value === null ? <span /> : <>{eur(p.value)}</>;
}

/** Total : signalé comme incomplet quand un compte n'a pas de relevé. */
function TotalValue(props: { p: Point }) {
  const { p } = props;
  if (!p.incomplete) return <>{eur(p.value!)}</>;
  return (
    <span class="incomplete" title="Total incomplet : au moins un compte n'a pas de relevé ce mois-ci">
      {eur(p.value!)}*
    </span>
  );
}

const UNKNOWN_INVESTED = "Capital investi inconnu";

export function Kpi(props: { label: string; main: Child; sub?: Child; detail?: Child }) {
  return (
    <div class="kpi">
      <span class="kpi-label">{props.label}</span>
      <strong class="kpi-main">{props.main}</strong>
      {props.sub && <span class="kpi-sub">{props.sub}</span>}
      {props.detail && <span class="kpi-detail">{props.detail}</span>}
    </div>
  );
}

export const AccountLink = (props: { account: Account }) => (
  <a class="account-link" href={`/comptes/${props.account.id}`}>
    <Dot color={props.account.color} />
    {props.account.name}
  </a>
);

export const Deposits = (props: { cents: number | null }) =>
  props.cents === null ? <Na why="Versements inconnus" /> : props.cents === 0 ? <>0</> : <>{signedEur(props.cents)}</>;

function DetailRow(props: { label: Child; p: Point; total?: boolean }) {
  const { p } = props;
  return (
    <tr class={props.total ? "total" : undefined}>
      <th scope="row">{props.label}</th>
      <td>{props.total ? <TotalValue p={p} /> : <AccountValue p={p} />}</td>
      <td><Deposits cents={p.deposits} /></td>
      <td><Amount cents={p.variation} signed /></td>
      <td><Pct ratio={p.variationPct} /></td>
      <td><Gain cents={p.gain} /></td>
      <td><Ret ratio={p.ret} /></td>
      <td><Amount cents={p.ytdVariation} signed /></td>
      <td><Pct ratio={p.ytdVariationPct} /></td>
      <td><Deposits cents={p.ytdDeposits} /></td>
      <td><Gain cents={p.ytdGain} /></td>
      <td><Ret ratio={p.ytdRet} /></td>
      <td><Amount cents={p.invested} why={UNKNOWN_INVESTED} /></td>
      <td><Gain cents={p.totalGain} why={UNKNOWN_INVESTED} /></td>
      <td><Pct ratio={p.totalGainPct} why={UNKNOWN_INVESTED} /></td>
    </tr>
  );
}
