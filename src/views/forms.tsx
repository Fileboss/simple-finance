import { centsToInput, eur, signedEur } from "../money.ts";
import { addMonths, monthLabel } from "../months.ts";
import { lastValue, type Check, type SheetData } from "../sheet.ts";
import type { Account, Statement } from "../store.ts";
import { Dot, Layout, Na, Notice } from "./layout.tsx";

export interface EntryRow {
  account: Account;
  previous: Statement | undefined;
  /** Premier relevé d'un compte ouvert en cours de suivi. */
  opening: boolean;
  value: string;
  deposits: string;
  error?: string;
}

export function EntryForm(props: { month: string; rows: EntryRow[]; error?: string }) {
  const { month, rows } = props;
  return (
    <Layout title="Saisie" path="/saisie">
      <div class="page-head">
        <div>
          <h1>Saisie · {monthLabel(month)}</h1>
          <p class="muted">Valeur de chaque compte en fin de mois, et versements nets du mois (dépôts − retraits).</p>
        </div>
        <form method="get" action="/saisie" class="inline">
          <label>
            Mois <input type="month" name="month" value={month} required />
          </label>
          <button type="submit" class="secondary">
            Changer
          </button>
        </form>
      </div>
      {props.error && <Notice kind="error">{props.error}</Notice>}
      {rows.length === 0 ? (
        <section class="empty">
          <p>
            Aucun compte actif. <a href="/comptes">Ajoute un compte</a> pour commencer.
          </p>
        </section>
      ) : (
        <form method="post" action="/saisie" class="card entry">
          <input type="hidden" name="month" value={month} />
          <table class="entry-table">
            <thead>
              <tr>
                <th>Compte</th>
                <th>Valeur</th>
                <th>Versements</th>
                <th class="hide-sm">Mois précédent</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr class={r.error ? "invalid" : undefined}>
                  <th scope="row">
                    <Dot color={r.account.color} />
                    {r.account.name}
                    {r.opening && !r.error && (
                      <span class="field-hint">Premier relevé : versements = montant apporté ce mois-ci</span>
                    )}
                    {r.error && <span class="field-error">{r.error}</span>}
                  </th>
                  <td>
                    <input
                      name={`value_${r.account.id}`}
                      value={r.value}
                      inputmode="decimal"
                      autocomplete="off"
                      placeholder={r.previous ? centsToInput(r.previous.value) : "0,00"}
                      aria-label={`Valeur ${r.account.name}`}
                    />
                  </td>
                  <td>
                    <input
                      name={`deposits_${r.account.id}`}
                      value={r.deposits}
                      inputmode="decimal"
                      autocomplete="off"
                      placeholder={r.opening ? "montant apporté" : "inconnu"}
                      required={r.opening}
                      aria-label={`Versements ${r.account.name}`}
                    />
                  </td>
                  <td class="hide-sm muted">
                    {r.previous ? (
                      <>
                        {eur(r.previous.value)}
                        {r.previous.deposits ? <small> · {signedEur(r.previous.deposits)} versés</small> : null}
                      </>
                    ) : (
                      <Na why="Pas de relevé le mois précédent" />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p class="hint">
            Laisser une valeur vide supprime le relevé du compte pour ce mois. Laisser les versements vides les marque comme
            inconnus : le gain et le rendement du mois ne seront pas calculés. Un retrait se saisit en négatif.
          </p>
          <p class="actions">
            <button type="submit">Enregistrer {monthLabel(month)}</button>
          </p>
        </form>
      )}
    </Layout>
  );
}

export function AccountsPage(props: {
  accounts: Account[];
  values: Map<string, number>;
  lasts: Map<number, Statement>;
  error?: string;
  notice?: string;
}) {
  return (
    <Layout title="Comptes" path="/comptes">
      <div class="page-head">
        <div>
          <h1>Comptes</h1>
          <p class="muted">
            Le capital investi de départ se déduit de la performance affichée par l'appli du compte : capital = valeur ÷ (1 +
            performance). Les versements saisis ensuite s'y ajoutent.
          </p>
        </div>
      </div>
      {props.error && <Notice kind="error">{props.error}</Notice>}
      {props.notice && <Notice>{props.notice}</Notice>}
      <div class="account-list">
        {props.accounts.map((a) => {
          const baseValue = a.baselineMonth ? props.values.get(`${a.baselineMonth}:${a.id}`) : undefined;
          return (
            <form method="post" action={`/comptes/${a.id}`} class={`card account${a.closed ? " closed" : ""}`}>
              <div class="account-head">
                <input type="color" name="color" value={a.color} aria-label="Couleur" />
                <input name="name" value={a.name} required aria-label="Nom" class="account-name" />
                <label class="check">
                  <input type="checkbox" name="closed" checked={a.closed} /> Clôturé
                </label>
                <label class="position">
                  Ordre <input type="number" name="position" value={String(a.position)} min="0" step="1" />
                </label>
              </div>
              {!a.closed && props.lasts.get(a.id)?.value ? (
                <p class="hint">
                  Cocher « Clôturé » crée le relevé de clôture de {monthLabel(addMonths(props.lasts.get(a.id)!.month, 1))} : valeur
                  0, retrait de {eur(props.lasts.get(a.id)!.value)}.
                </p>
              ) : null}
              <fieldset>
                <legend>Capital investi de départ</legend>
                <div class="baseline">
                  <label>
                    Fin de mois
                    <input type="month" name="baseline_month" value={a.baselineMonth ?? ""} />
                  </label>
                  <label>
                    Performance affichée
                    <span class="suffix" data-suffix="%">
                      <input name="baseline_perf" inputmode="decimal" placeholder="ex. 15" value={a.baselinePerf === null ? "" : String(a.baselinePerf).replace(".", ",")} />
                    </span>
                  </label>
                  <span class="or">ou</span>
                  <label>
                    Capital investi
                    <span class="suffix" data-suffix="€">
                      <input
                        name="baseline_invested"
                        inputmode="decimal"
                        placeholder="ex. 6254,50"
                        value={a.baselinePerf === null && a.baselineInvested !== null ? centsToInput(a.baselineInvested) : ""}
                      />
                    </span>
                  </label>
                </div>
                <p class="hint">
                  {a.baselineMonth && a.baselineInvested !== null ? (
                    <>
                      {eur(a.baselineInvested)} investis fin {monthLabel(a.baselineMonth)}
                      {baseValue !== undefined && <> (valeur {eur(baseValue)}, plus-value {signedEur(baseValue - a.baselineInvested)})</>}.
                    </>
                  ) : (
                    "Non renseigné : la plus-value totale du compte n'est pas calculée."
                  )}
                </p>
              </fieldset>
              <p class="actions">
                <button type="submit" class="secondary">
                  Enregistrer
                </button>
              </p>
            </form>
          );
        })}
      </div>
      <form method="post" action="/comptes" class="card add-account">
        <h2>Ajouter un compte</h2>
        <div class="account-head">
          <input type="color" name="color" value="#5c6bc0" aria-label="Couleur" />
          <input name="name" required placeholder="Nom du compte" aria-label="Nom" class="account-name" />
          <button type="submit">Ajouter</button>
        </div>
      </form>
    </Layout>
  );
}

export function ImportForm(props: { error?: string }) {
  return (
    <Layout title="Import" path="/import">
      <div class="page-head">
        <div>
          <h1>Import du Sheet</h1>
          <p class="muted">
            Dans Google Sheets : Fichier › Télécharger › Valeurs séparées par des virgules (.csv). Le fichier attendu a une
            ligne par compte, une colonne par mois, puis la ligne « Total ».
          </p>
        </div>
      </div>
      {props.error && <Notice kind="error">{props.error}</Notice>}
      <form method="post" action="/import/preview" enctype="multipart/form-data" class="card">
        <label class="file">
          Fichier CSV
          <input type="file" name="file" accept=".csv,text/csv" />
        </label>
        <details>
          <summary>Ou coller le contenu</summary>
          <textarea name="csv" rows={8} placeholder=",décembre 2025,janvier 2026,…" />
        </details>
        <p class="hint">
          Les valeurs sont importées avec des versements inconnus. Les comptes absents sont créés, et les versements déjà
          saisis ne sont pas modifiés.
        </p>
        <p class="actions">
          <button type="submit">Prévisualiser</button>
        </p>
      </form>
    </Layout>
  );
}

export interface ImportInput {
  perf: string;
  invested: string;
  error?: string;
}

export function ImportPreview(props: {
  csv: string;
  data: SheetData;
  checks: Check[];
  existing: Map<string, Account>;
  inputs?: ImportInput[];
  error?: string;
}) {
  const { data, checks } = props;
  const failed = checks.filter((c) => c.actual !== c.expected);
  // Saisies précédentes en cas d'erreur, sinon le capital de départ déjà enregistré au même mois.
  const inputs = data.accounts.map((a, i): ImportInput => {
    if (props.inputs?.[i]) return props.inputs[i]!;
    const acc = props.existing.get(a.name.toLowerCase());
    if (!acc || acc.baselineInvested === null || acc.baselineMonth !== lastValue(data, i)?.month) return { perf: "", invested: "" };
    return acc.baselinePerf !== null
      ? { perf: String(acc.baselinePerf).replace(".", ","), invested: "" }
      : { perf: "", invested: centsToInput(acc.baselineInvested) };
  });
  return (
    <Layout title="Import" path="/import">
      <div class="page-head">
        <div>
          <h1>Prévisualisation</h1>
          <p class="muted">
            {data.accounts.length} comptes, {data.months.length} mois ({monthLabel(data.months[0]!)} →{" "}
            {monthLabel(data.months.at(-1)!)}).
          </p>
        </div>
      </div>
      {props.error && <Notice kind="error">{props.error}</Notice>}
      {checks.length === 0 ? (
        <Notice kind="warn">Pas de ligne « Total » dans le fichier : rien à contrôler.</Notice>
      ) : failed.length === 0 ? (
        <Notice>
          Contrôle réussi : les {checks.length} totaux et variations recalculés retombent exactement sur ceux du Sheet.
        </Notice>
      ) : (
        <Notice kind="error">
          {failed.length} écart(s) avec le Sheet :{" "}
          {failed
            .map((c) => `${c.label} ${monthLabel(c.month)} : Sheet ${eur(c.expected)}, recalculé ${c.actual === null ? "—" : eur(c.actual)}`)
            .join(" ; ")}
        </Notice>
      )}
      <section class="card">
        <div class="table-wrap">
          <table class="grid">
            <thead>
              <tr>
                <th />
                {data.months.map((m) => (
                  <th scope="col">{monthLabel(m)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.accounts.map((a) => (
                <tr>
                  <th scope="row">
                    {a.name}
                    {!props.existing.has(a.name.toLowerCase()) && <span class="tag">nouveau</span>}
                  </th>
                  {a.values.map((v) => (
                    <td>{v === null ? <Na /> : eur(v)}</td>
                  ))}
                </tr>
              ))}
              {data.total && (
                <tr class="total">
                  <th scope="row">Total (Sheet)</th>
                  {data.total.map((v) => (
                    <td>{v === null ? <Na /> : eur(v)}</td>
                  ))}
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
      <form method="post" action="/import">
        <textarea name="csv" hidden>
          {props.csv}
        </textarea>
        <section class="card">
          <h2>Capital investi de départ (facultatif)</h2>
          <p class="hint" style="margin-top:0">
            Indique la performance totale affichée par l'appli de chaque compte : le capital investi est déduit de la
            dernière valeur importée (capital = valeur ÷ (1 + performance)). Tu peux aussi saisir directement le montant
            investi, ou laisser vide et le renseigner plus tard sur la page Comptes.
          </p>
          <table class="entry-table">
            <thead>
              <tr>
                <th>Compte</th>
                <th class="hide-sm">Dernière valeur</th>
                <th>Performance affichée</th>
                <th>ou capital investi</th>
              </tr>
            </thead>
            <tbody>
              {data.accounts.map((a, i) => {
                const last = lastValue(data, i);
                const input = inputs[i]!;
                return (
                  <tr class={input.error ? "invalid" : undefined}>
                    <th scope="row">
                      {a.name}
                      {input.error && <span class="field-error">{input.error}</span>}
                    </th>
                    <td class="hide-sm muted">{last ? `${eur(last.value)} · ${monthLabel(last.month)}` : <Na />}</td>
                    <td>
                      <span class="suffix" data-suffix="%">
                        <input name={`perf_${i}`} value={input.perf} inputmode="decimal" autocomplete="off" placeholder="ex. 15" aria-label={`Performance ${a.name}`} disabled={!last} />
                      </span>
                    </td>
                    <td>
                      <span class="suffix" data-suffix="€">
                        <input name={`invested_${i}`} value={input.invested} inputmode="decimal" autocomplete="off" placeholder="ex. 6254,50" aria-label={`Capital investi ${a.name}`} disabled={!last} />
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
        <p class="actions">
          <a class="button secondary" href="/import">
            Annuler
          </a>
          <button type="submit" class={failed.length ? "danger" : undefined}>
            {failed.length ? "Importer malgré les écarts" : "Importer"}
          </button>
        </p>
      </form>
    </Layout>
  );
}
