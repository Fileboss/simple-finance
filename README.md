# simple-finance

A simple, lightweight, self-hostable finance tracking app with GUI.

Petit dashboard self-hosted pour suivre la valorisation de mes comptes mois par mois. Il remplace un Google Sheet tenu à la main.

> État : première version implémentée (saisie, tableau de bord, comptes, import du Sheet). Ce README résume aussi les décisions prises avant de démarrer.

## Pourquoi une app maison

Les apps self-hosted existantes sont construites autour des transactions, alors que le besoin ici est un **relevé mensuel de soldes** :

- **Ghostfolio** suit un portefeuille : il faut saisir chaque achat et chaque vente. Il est lourd (Postgres + Redis).
- **Actual Budget** et **Firefly III** sont des outils de budget : une ligne par opération, pas de % mois par mois ni depuis janvier.

Le besoin tient dans une table et quelques calculs : on le code nous-mêmes.

## Besoin

Pour chaque compte, et pour le total :

1. la **valorisation** à chaque fin de mois ;
2. la **variation par rapport au mois précédent**, en € et en % ;
3. la **variation par rapport à janvier** de l'année en cours, en € et en %.

Le tout en **distinguant les gains des dépôts**. Aujourd'hui le Sheet ne le fait pas : un versement de 500 € sur un compte qui n'a rien rapporté apparaît comme +500 € de « gain ».

Comptes suivis actuellement : Livret A, Assurance Vie, PEA, Amundi, Binance, Trade Republic. La liste doit être modifiable (ajout, clôture).

## Modèle de données

Un relevé par compte et par mois :

| Champ | Description |
|---|---|
| `mois` | mois du relevé (fin de mois) |
| `compte` | compte concerné |
| `valeur` | valorisation du compte à la date du relevé |
| `versements` | versements nets du mois (dépôts − retraits), `0` par défaut, **vide si inconnu** (historique) |

Une base SQLite suffit.

## Calculs

Notations pour un compte au mois *m* : `V(m)` valeur, `D(m)` versements nets du mois.

**Variation brute** (ce que fait le Sheet aujourd'hui) :

```
variation(m) = V(m) − V(m−1)
```

**Gain** (variation hors versements) :

```
gain(m)      = V(m) − V(m−1) − D(m)
rendement(m) = gain(m) / (V(m−1) + D(m) / 2)
```

Le dénominateur suppose des versements en milieu de mois (méthode de Dietz modifiée simplifiée). Il reste correct pour un compte ouvert dans le mois, où `V(m−1) = 0`.

**Depuis janvier** (même référence que le Sheet, c'est-à-dire le relevé de janvier) :

```
gain depuis janvier      = V(m) − V(janvier) − Σ D(février..m)
rendement depuis janvier = Π (1 + rendement(k)) − 1, pour k de février à m
```

Les rendements mensuels sont chaînés (rendement pondéré par le temps) : un gros versement en cours d'année ne fausse pas le %.

**Total** : les valeurs, versements et gains s'additionnent sur tous les comptes, et les % se calculent avec les mêmes formules sur ces sommes.

**Relevé manquant** : un mois sans relevé entre le premier et le dernier relevé d'un compte rend sa valeur inconnue, jamais nulle. Le total de ce mois s'affiche comme incomplet, sans variation ni gain, pour ne pas montrer de perte ou de gain fictifs. Un compte n'entre dans le total qu'à partir de son premier relevé. Il en sort après sa clôture, qui crée un dernier relevé à 0 avec en versements le retrait du solde. Pour un compte ouvert en cours de suivi, les versements du premier mois valent le montant apporté.

## Démarrage des données

### Capital investi initial

Les versements passés ne sont pas connus. On part d'une **valeur initiale déduite des % affichés par chaque appli** (plus-value totale du compte) :

```
capital investi initial = valeur actuelle / (1 + performance affichée)
```

Exemple : 7 192,68 € affichés avec +15 % de performance, soit 7 192,68 / 1,15 = 6 254,50 € investis.

Ce capital est enregistré comme un versement initial unique. Ensuite, **chaque mois est saisi au réel** : valeur et versements du mois.

### Reprise de l'historique

Le Sheet contient les relevés de **décembre 2025 à octobre 2026** : une ligne par compte, une colonne par mois, avec en dessous le total, la variation mensuelle (€ et %) et la variation cumulée depuis janvier (€ et %).

À terme, on importe tous ces relevés (export CSV du Sheet) pour recréer le suivi. Les versements de ces mois ne sont pas connus : ils sont importés **vides**. Pour ces mois, l'app affiche la variation brute et marque le gain et le rendement comme non disponibles plutôt que d'inventer un chiffre.

Contrôle après import : les totaux et les variations brutes doivent retomber exactement sur ceux du Sheet (ex. total octobre 2026 : 50 330,07 €).

Les variations mensuelles en % diffèrent légèrement : le Sheet divise la variation par la valeur du mois courant (2,98 % en janvier), l'app par celle du mois précédent (3,07 %). Les variations en € et les % depuis janvier sont identiques.

## Interface

- **Saisie mensuelle** : un formulaire avec, pour chaque compte, sa valeur et ses versements du mois.
- **Tableau** : pour chaque compte et pour le total, la valeur, la variation et le gain vs le mois précédent, la variation et le gain depuis janvier, en € et en %.
- **Graphique** : barres empilées par compte et par mois (comme le Sheet), et éventuellement une courbe des versements cumulés pour voir la part des gains.
- **Import CSV** pour la reprise de l'historique.

## Hébergement

L'app tourne sur le homelab, dont la configuration de déploiement vit dans le dépôt `qui-est-ce_infra`. Elle suit les mêmes conventions que Beszel et Paperless :

- une stack Docker Compose séparée, avec **un seul conteneur léger** (quelques dizaines de Mo de RAM) et pas de base externe ;
- accessible **sur le tailnet uniquement** (`tailscale serve`), jamais exposée publiquement : les données financières restent à la maison ;
- **sauvegarde chaque nuit** de la base SQLite vers le VPS, dans le dépôt restic existant ;
- une image versionnée, pour la mettre à jour comme les autres services.

## Stack technique

| Rôle | Choix |
|---|---|
| Runtime | **Bun** + **TypeScript** (pas d'étape de build) |
| Serveur HTTP | `Bun.serve`, avec **Hono** si le routage le demande |
| Base | **`bun:sqlite`** (SQLite natif, sans dépendance à compiler) |
| Pages | **HTML rendu côté serveur** (template strings ou JSX de Hono), formulaires classiques (`<form method="post">`), sans framework front |
| Graphiques | **Chart.js**, fichier copié dans `static/` (pas de CDN) |
| Tests | **`bun test`** |
| Image | `oven/bun:alpine` |

**Pourquoi Bun.** Ni Rust ni Node n'ont été retenus. Rust aurait économisé ~30 Mo de RAM, invisibles sur le homelab, au prix d'itérations plus lentes et de deux langages (serveur et JS des graphiques). Bun intègre serveur, SQLite, TypeScript et tests : le `package.json` tient en une ou deux dépendances, ce qui limite la maintenance et les risques sur la chaîne d'approvisionnement. Ordre de grandeur : ~30-40 Mo de RAM au repos, image ~100 Mo.

**Pourquoi Chart.js.** Générer nous-mêmes des SVG donne un rendu brut. Chart.js (~70 Ko gzip) fait proprement les barres empilées et les courbes, avec infobulles, animations et légende cliquable pour masquer un compte. Si on veut plus riche un jour (zoom, thèmes), Apache ECharts le remplace en ne touchant qu'un seul fichier JS.

Règles à respecter dès le départ :

- **Montants en centimes entiers**, jamais en flottants. Sinon les arrondis cassent le contrôle « on retombe exactement sur les totaux du Sheet ».
- **Le serveur fait tous les calculs.** Les données des graphiques sont injectées dans la page en JSON (`<script type="application/json">`) et un petit `static/charts.js` ne fait que de l'affichage.
- **Aucune requête vers l'extérieur** : toutes les ressources (Chart.js, CSS) sont servies par l'app, qui reste utilisable hors ligne sur le tailnet.
- **Sauvegarde cohérente** : `VACUUM INTO` vers un fichier, que restic envoie ensuite. On ne copie jamais la base pendant que l'app écrit.
- **Tests sur les calculs** (gain, rendement mensuel, rendement depuis janvier), avec les chiffres du Sheet comme référence.

## Utilisation

Développement (Bun installé localement, ou via `docker run --rm -v "$PWD":/app -w /app oven/bun:1-alpine …`) :

```sh
bun install
bun run dev                        # http://localhost:3000, base dans data/finance.sqlite
bun test                           # tous les tests
bun test test/calc.test.ts         # un fichier
bun test -t "depuis janvier"       # tests dont le nom correspond
bun run typecheck
```

Reprise de l'historique, une fois au démarrage : exporter le Sheet en CSV puis soit passer par la page **Import** (prévisualisation et contrôle avant d'importer), soit lancer `bun run import export.csv` (refuse d'importer si un total ou une variation ne retombe pas sur le Sheet). Dans l'aperçu de l'import, on peut indiquer pour chaque compte la performance totale affichée par son appli (ou le capital investi) : l'app en déduit le capital investi de départ au dernier mois importé du compte. Ces valeurs restent modifiables ensuite sur la page **Comptes**, et la commande `bun run import` ne les demande pas.

Les données personnelles restent hors du dépôt (public) : `data/` et `reference.png` sont ignorés par git. Si `data/sheet.csv` existe, `bun test` vérifie aussi l'import sur les vrais chiffres.

Déploiement : à chaque push sur `main`, la GitHub Action (`.github/workflows/docker.yml`) lance les tests puis publie l'image `ghcr.io/fileboss/simple-finance:latest` (amd64 et arm64). Un tag `vX.Y.Z` publie en plus `:X.Y.Z` et `:X.Y` pour figer une version. Sur le homelab, on copie `compose.yaml` puis on lance `docker compose up -d` : `pull_policy: always` récupère la dernière image à chaque `up`. Le conteneur publie le port 3000 sur `127.0.0.1`, puis `tailscale serve --bg 3000` l'expose au tailnet. Les données vivent dans le volume `finance-data`. Sauvegarde nocturne : `docker compose exec simple-finance bun run backup /data/backup/finance.sqlite`, puis restic envoie ce fichier (chemin sur l'hôte : `docker volume inspect` sur le volume).

Après la première publication, passer le package en public dans GitHub (Packages › simple-finance › Package settings › Change visibility) pour que le homelab puisse faire `docker pull` sans s'authentifier. Sinon, il faut lancer `docker login ghcr.io` sur le homelab avec un token qui a le droit `read:packages`.

## Hors périmètre

- Pas de saisie des opérations une par une ni de budget.
- Pas de synchronisation bancaire automatique.
- Pas de suivi titre par titre (c'est le rôle des applis des courtiers).
