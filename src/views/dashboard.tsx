import type { Child } from "hono/jsx";
import type { Computed, Point } from "../calc.ts";
import { eur, signedEur } from "../money.ts";
import { monthLabel, shortMonthLabel } from "../months.ts";
import type { Account } from "../store.ts";
import { Amount, Dot, Gain, Layout, Na, Notice, Pct, Ret } from "./layout.tsx";

export function EmptyDashboard() {
  return (
    <Layout title="Tableau de bord" path="/">
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
  const shown = accounts.filter((a) => view.some((m) => at(data.byAccount.get(a.id)!, m).held));
  const t = at(data.total, month);

  const chart = {
    labels: view.map(shortMonthLabel),
    accounts: shown.map((a) => ({
      name: a.name,
      color: a.color,
      values: view.map((m) => {
        const p = at(data.byAccount.get(a.id)!, m);
        return p.held ? p.value / 100 : null;
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
        <Kpi label="Valeur totale" main={<Amount cents={t.value} />} />
        <Kpi
          label="Vs mois précédent"
          main={<Amount cents={t.variation} signed why="Pas de mois précédent" />}
          sub={<Pct ratio={t.variationPct} />}
        />
        <Kpi
          label="Depuis janvier"
          main={<Amount cents={t.ytdVariation} signed why="Pas de relevé de janvier" />}
          sub={<Pct ratio={t.ytdVariationPct} />}
        />
        <Kpi
          label="Gain du mois (hors versements)"
          main={<Gain cents={t.gain} />}
          sub={t.gain === null ? <span class="muted">versements inconnus</span> : <Ret ratio={t.ret} />}
        />
        <Kpi
          label="Plus-value totale"
          main={<Gain cents={t.totalGain} />}
          sub={
            t.invested === null ? (
              <span class="muted">
                capital investi inconnu · <a href="/comptes">le renseigner</a>
              </span>
            ) : (
              <span class="muted">sur {eur(t.invested)} investis</span>
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
        <div class="table-wrap">
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
                    <Dot color={a.color} />
                    {a.name}
                  </th>
                  {view.map((m) => {
                    const p = at(data.byAccount.get(a.id)!, m);
                    return <td class={m === month ? "selected" : undefined}>{p.held ? eur(p.value) : <Na why="Pas de relevé" />}</td>;
                  })}
                </tr>
              ))}
              <tr class="total">
                <th scope="row">Total</th>
                {view.map((m) => (
                  <td class={m === month ? "selected" : undefined}>{eur(at(data.total, m).value)}</td>
                ))}
              </tr>
            </tbody>
            <tbody class="metrics">
              {totalRow("Variation", (p) => <Amount cents={p.variation} signed />)}
              {totalRow("Variation %", (p) => <Pct ratio={p.variationPct} />)}
              {totalRow("Gain hors versements", (p) => <Gain cents={p.gain} />)}
              {totalRow("Rendement", (p) => <Ret ratio={p.ret} />)}
              {totalRow("Variation depuis janvier", (p) => <Amount cents={p.ytdVariation} signed />)}
              {totalRow("Variation depuis janvier %", (p) => <Pct ratio={p.ytdVariationPct} />)}
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
                <th colspan={4} class="group">
                  Depuis janvier
                </th>
                <th rowspan={2}>Plus-value totale</th>
              </tr>
              <tr>
                <th>Variation</th>
                <th>%</th>
                <th>Gain</th>
                <th>Rendement</th>
                <th>Variation</th>
                <th>%</th>
                <th>Gain</th>
                <th>Rendement</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((a) => (
                <DetailRow label={<><Dot color={a.color} />{a.name}</>} p={at(data.byAccount.get(a.id)!, month)} />
              ))}
              <DetailRow label="Total" p={t} total />
            </tbody>
          </table>
        </div>
        <p class="hint">
          « Variation » compare les valeurs brutes. « Gain » retire les versements du mois, et « Rendement » est pondéré par
          le temps (rendements mensuels chaînés). Un tiret signale un chiffre non disponible, par exemple parce que les
          versements du mois sont inconnus.
        </p>
      </section>
    </Layout>
  );
}

function Kpi(props: { label: string; main: Child; sub?: Child }) {
  return (
    <div class="kpi">
      <span class="kpi-label">{props.label}</span>
      <strong class="kpi-main">{props.main}</strong>
      {props.sub && <span class="kpi-sub">{props.sub}</span>}
    </div>
  );
}

function DetailRow(props: { label: Child; p: Point; total?: boolean }) {
  const { p } = props;
  return (
    <tr class={props.total ? "total" : undefined}>
      <th scope="row">{props.label}</th>
      <td>{p.held ? eur(p.value) : <Na why="Pas de relevé" />}</td>
      <td>{p.deposits === null ? <Na why="Versements inconnus" /> : p.deposits === 0 ? "0" : signedEur(p.deposits)}</td>
      <td><Amount cents={p.variation} signed /></td>
      <td><Pct ratio={p.variationPct} /></td>
      <td><Gain cents={p.gain} /></td>
      <td><Ret ratio={p.ret} /></td>
      <td><Amount cents={p.ytdVariation} signed /></td>
      <td><Pct ratio={p.ytdVariationPct} /></td>
      <td><Gain cents={p.ytdGain} /></td>
      <td><Ret ratio={p.ytdRet} /></td>
      <td><Amount cents={p.totalGain} signed why="Capital investi inconnu" /></td>
    </tr>
  );
}
