import type { Point, YearPoint } from "../calc.ts";
import { monthLabel, shortMonthLabel } from "../months.ts";
import type { Account } from "../store.ts";
import { AccountValue, Deposits, Kpi } from "./dashboard.tsx";
import { Amount, Dot, Gain, Layout, Ret, Split } from "./layout.tsx";

const UNKNOWN_INVESTED = "Capital investi inconnu";

/** Performance d'un compte seul : globale, par année et mois par mois, sans le détail des lignes. */
export function AccountPerformance(props: { account: Account; points: Point[]; years: YearPoint[] }) {
  const { account } = props;
  // Mois où le compte existe, du plus récent au plus ancien.
  const points = props.points.filter((p) => p.state !== "absent");
  const recent = [...points].reverse();
  const last = recent.find((p) => p.state === "held");
  const thisYear = last && props.years.find((y) => y.year === last.month.slice(0, 4));

  // Chaque barre sépare le capital investi de la plus-value (ou de la perte, au-dessus
  // de la valeur). Sans capital investi connu, la valeur reste d'un seul bloc.
  const euros = (f: (p: Point) => number | null) =>
    points.map((p) => {
      const x = p.value === null ? null : f(p);
      return x ? x / 100 : null;
    });
  const chart = {
    labels: points.map((p) => shortMonthLabel(p.month)),
    accounts: [
      { name: "Investi", color: account.color, values: euros((p) => (p.invested === null ? null : Math.min(p.invested, p.value!))) },
      { name: "Gagné", color: "--pos", values: euros((p) => (p.totalGain === null ? null : Math.max(p.totalGain, 0))) },
      { name: "Perdu", color: "--neg", values: euros((p) => (p.totalGain === null ? null : Math.max(-p.totalGain, 0))) },
      { name: "Capital investi inconnu", color: "--faint", values: euros((p) => (p.invested === null ? p.value : null)) },
    ].filter((a) => a.values.some((v) => v !== null)),
    invested: points.map(() => null),
    totals: points.map((p) => (p.value === null ? null : p.value / 100)),
  };

  return (
    <Layout
      title={account.name}
      path="/"
      scripts={
        last && (
          <>
            <script
              type="application/json"
              id="chart-data"
              dangerouslySetInnerHTML={{ __html: JSON.stringify(chart).replace(/</g, "\\u003c") }}
            />
            <script src="/static/chart.umd.min.js" defer />
            <script src="/static/charts.js" defer />
          </>
        )
      }
    >
      <div class="page-head">
        <div>
          <h1>
            <Dot color={account.color} />
            {account.name}
            {account.closed && <span class="tag">clôturé</span>}
          </h1>
          <p class="muted">
            {last ? `Performance du compte, fin ${monthLabel(last.month)}` : "Aucun relevé pour ce compte."}
          </p>
        </div>
        <a class="button secondary" href={`/comptes#compte-${account.id}`}>
          Modifier le compte
        </a>
      </div>

      {last && (
        <>
          <section class="kpis">
            <Kpi
              label="Valeur"
              main={<Amount cents={last.value} />}
              sub={
                last.invested === null && (
                  <span class="muted">
                    capital investi inconnu · <a href={`/comptes#compte-${account.id}`}>le renseigner</a>
                  </span>
                )
              }
              detail={<Split invested={last.invested} gained={last.totalGain} pct={last.totalGainPct} why={UNKNOWN_INVESTED} />}
            />
            {thisYear && (
              <Kpi
                label={`Performance ${thisYear.year} (hors versements)`}
                main={<Gain cents={thisYear.gain} />}
                sub={<Ret ratio={thisYear.ret} />}
                detail={<Split invested={thisYear.deposits} gained={thisYear.gain} signed />}
              />
            )}
            <Kpi
              label={`Gain de ${monthLabel(last.month)}`}
              main={<Gain cents={last.gain} />}
              sub={<Ret ratio={last.ret} />}
              detail={<Split invested={last.deposits} gained={last.gain} signed />}
            />
          </section>

          <section class="card chart-card">
            <h2>Évolution</h2>
            <div class="chart">
              <canvas id="chart" aria-label={`Valorisation de ${account.name} par mois`} role="img" />
            </div>
          </section>

          <section class="card">
            <h2>Performance annuelle</h2>
            <div class="table-wrap">
              <table class="grid">
                <thead>
                  <tr>
                    <th />
                    <th>Période</th>
                    <th>Variation</th>
                    <th>Versements</th>
                    <th>Gain hors versements</th>
                    <th>Rendement</th>
                  </tr>
                </thead>
                <tbody>
                  {props.years.map((y) => (
                    <tr>
                      <th scope="row">{y.year}</th>
                      <td class="muted">
                        {shortMonthLabel(y.from)} → {shortMonthLabel(y.to)}
                      </td>
                      <td><Amount cents={y.variation} signed /></td>
                      <td><Deposits cents={y.deposits} /></td>
                      <td><Gain cents={y.gain} /></td>
                      <td><Ret ratio={y.ret} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p class="hint">
              Gain de l'année = valeur de fin d'année − valeur de fin de l'année précédente − versements de l'année, janvier
              compris. Le rendement chaîne les rendements mensuels. Un seul mois inconnu (relevé manquant ou versements
              inconnus) rend l'année indisponible.
            </p>
          </section>

          <section class="card">
            <h2>Mois par mois</h2>
            <div class="table-wrap">
              <table class="grid">
                <thead>
                  <tr>
                    <th />
                    <th>Valeur</th>
                    <th>Versements</th>
                    <th>Gain hors versements</th>
                    <th>Rendement</th>
                    <th>Variation</th>
                    <th>Investi</th>
                    <th>Plus-value</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((p) => (
                    <tr>
                      <th scope="row">
                        <a href={`/?month=${p.month}`}>{shortMonthLabel(p.month)}</a>
                      </th>
                      <td><AccountValue p={p} /></td>
                      <td><Deposits cents={p.deposits} /></td>
                      <td><Gain cents={p.gain} /></td>
                      <td><Ret ratio={p.ret} /></td>
                      <td><Amount cents={p.variation} signed /></td>
                      <td><Amount cents={p.invested} why={UNKNOWN_INVESTED} /></td>
                      <td><Gain cents={p.totalGain} why={UNKNOWN_INVESTED} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </Layout>
  );
}
