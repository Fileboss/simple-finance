import { getContext } from "hono/context-storage";
import { html } from "hono/html";
import type { Child } from "hono/jsx";
import type { AppEnv } from "../auth.ts";
import { eur, signedEur, signedPct } from "../money.ts";
import type { User } from "../store.ts";

const NAV = [
  ["/", "Tableau de bord"],
  ["/saisie", "Saisie"],
  ["/comptes", "Comptes"],
  ["/import", "Import"],
] as const;

export function Layout(props: { title: string; path: string; children: Child; scripts?: Child }) {
  // Absent sur la page de connexion.
  const user = getContext<AppEnv>().var.user as User | undefined;
  return (
    <>
      {html`<!doctype html>`}
      <html lang="fr">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>{props.title} · Finances</title>
          <link rel="icon" href="/static/favicon.svg" />
          <link rel="stylesheet" href="/static/style.css" />
        </head>
        <body>
          <header class="topbar">
            <a class="brand" href="/">
              <img src="/static/favicon.svg" alt="" width="22" height="22" />
              Finances
            </a>
            {user && !user.mustChangePassword && (
              <nav>
                {NAV.map(([href, label]) => (
                  <a href={href} aria-current={props.path === href ? "page" : undefined}>
                    {label}
                  </a>
                ))}
              </nav>
            )}
            {user && (
              <div class="session">
                <a href="/mot-de-passe" title="Changer le mot de passe">
                  {user.name}
                </a>
                <form method="post" action="/logout">
                  <button type="submit" class="secondary">
                    Déconnexion
                  </button>
                </form>
              </div>
            )}
          </header>
          <main>{props.children}</main>
          <script src="/static/tables.js" defer />
          {props.scripts}
        </body>
      </html>
    </>
  );
}

const tone = (x: number) => (x > 0 ? "pos" : x < 0 ? "neg" : undefined);

export const Na = (props: { why?: string }) => (
  <span class="na" title={props.why ?? "Non disponible"}>
    —
  </span>
);

const UNKNOWN_DEPOSITS = "Non disponible : versements du mois inconnus";

export function Amount(props: { cents: number | null; signed?: boolean; why?: string }) {
  if (props.cents === null) return <Na why={props.why} />;
  if (!props.signed) return <span>{eur(props.cents)}</span>;
  return <span class={tone(props.cents)}>{signedEur(props.cents)}</span>;
}

export function Pct(props: { ratio: number | null; why?: string }) {
  if (props.ratio === null) return <Na why={props.why} />;
  return <span class={tone(props.ratio)}>{signedPct(props.ratio)}</span>;
}

export const Gain = (props: { cents: number | null; why?: string }) => (
  <Amount cents={props.cents} signed why={props.why ?? UNKNOWN_DEPOSITS} />
);
export const Ret = (props: { ratio: number | null }) => <Pct ratio={props.ratio} why={UNKNOWN_DEPOSITS} />;

/** Détail d'un montant : la part investie (versements) et la part gagnée. Tiret si inconnue. */
export function Split(props: { invested: number | null; gained: number | null; signed?: boolean; why?: string }) {
  return (
    <span class="split">
      <span>
        investi <Amount cents={props.invested} signed={props.signed} why={props.why ?? "Versements inconnus"} />
      </span>
      <span>
        gagné <Gain cents={props.gained} why={props.why} />
      </span>
    </span>
  );
}

export const Dot = (props: { color: string }) => <span class="dot" style={`background:${props.color}`} />;

export const Notice = (props: { kind?: "ok" | "error" | "warn"; children: Child }) => (
  <p class={`notice ${props.kind ?? "ok"}`} role={props.kind === "error" ? "alert" : "status"}>
    {props.children}
  </p>
);
