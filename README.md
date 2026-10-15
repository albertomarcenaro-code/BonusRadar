# BonusRadar

Monitoraggio intelligente dei bandi e compilazione automatica dei documenti.
Frontend React + Vite con backend **Supabase** (auth, database, storage): nessun
altro server applicativo.

- **Anteprima (dev):** gestita da Freebuff (`freebuff-preview`)
- **Produzione:** `https://bonusradar.freebuff.app` (hosting Freebuff, output statico in `dist/`)

## Stack

| Livello | Tecnologia |
| --- | --- |
| UI | React 18 + TypeScript, Vite 6, Tailwind CSS 4, Radix/shadcn-ui |
| Stato | TanStack Query |
| Backend | Supabase (Auth + Postgres + Storage), RLS su tutte le tabelle |
| Dati | Scraper Python settimanale → tabella `bonuses` + `app/frontend/public/data/bonuses.json` |
| Test | Playwright (smoke E2E), ESLint, `tsc -b --noEmit` |

## Struttura

```
app/frontend/          # unica app (Vite + React + TS)
  src/pages/           # Landing, Auth, Dashboard, Profile, BonusCatalog…
  src/lib/             # api (data layer Supabase), queries, matching, webSearch
  e2e/smoke.mjs        # smoke E2E Playwright
app/backend/           # backend Python legacy (non usato dal frontend attivo)
scripts/scraper.py     # scraper bandi (eseguito anche da GitHub Actions)
supabase_schema.sql    # schema completo + policy RLS + bucket storage
.github/workflows/     # ci.yml, scraper.yml, supabase-keepalive.yml
```

## Setup locale

```bash
cd app/frontend
npm install
npm run dev            # vite su 0.0.0.0 (in Freebuff usa freebuff-preview start)
```

Variabili d'ambiente (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`) nel file
`.env` / `.env.local` alla radice del progetto: in Freebuff sono caricate
automaticamente in ogni comando e nella preview (non editarle a mano da qui —
si gestiscono da Settings → Environment).

## Script utili

| Comando | Dove | Cosa fa |
| --- | --- | --- |
| `npm run dev` | `app/frontend` | dev server Vite |
| `npm run build` | `app/frontend` | `tsc -b && vite build` |
| `npx tsc -b --noEmit` | `app/frontend` | typecheck |
| `npm run lint` | `app/frontend` | ESLint (flat config) |
| `npm run test:e2e` | `app/frontend` | smoke E2E Playwright (richiede la preview attiva su :3000) |
| `python3 scripts/scraper.py` | root | aggiorna catalogo (JSON + Supabase se le chiavi ci sono) |

## Verifiche automatiche

- **CI** (`.github/workflows/ci.yml`): a ogni push/PR esegue `tsc -b --noEmit`
  e `vite build` su `app/frontend`.
- **E2E locale** (`npm run test:e2e`): landing → login → dashboard, pagine
  lazy, redirect legacy, logout, zero `pageerror`. Le chiamate a Supabase
  vengono intercettate a livello di rete: non servono credenziali e non tocca
  dati reali.

## Deploy

Comandi configurati su Freebuff (`freebuff-preview set-install` / `set-build`):

```bash
cd app/frontend && npm install
cd app/frontend && npx vite build && mkdir -p ../../dist && cp -R dist/. ../../dist/
```

L'output finisce in `dist/` alla radice (mai un server nel build). I valori
`VITE_SUPABASE_*` di produzione sono definiti in `freebuff-deploy env`
(sovrascrivono quelli della sandbox al momento del deploy). Verifica con
`freebuff-deploy check`, poi `freebuff-deploy start`.

## Automazioni GitHub Actions

- **CI** — typecheck + build su push/PR.
- **Scraper fonti bonus** — ogni lunedì 08:00 UTC: scarica i bandi, upsert su
  `bonuses` e committa `app/frontend/public/data/bonuses.json` se cambiato.
  Usa i secret `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` e (per la scrittura)
  `SUPABASE_SERVICE_ROLE_KEY`.
- **Supabase keep-alive** — tre ping al giorno su `/rest/v1/bonuses` per non far
  mettere in pausa il progetto Free. Usa `VITE_SUPABASE_URL` e
  `VITE_SUPABASE_ANON_KEY`: se i secret non coincidono con il progetto reale il
  ping fallisce (404 PGRST125) e il progetto rischia la pausa dopo 7 giorni.

## Note operative

- La lettura del catalogo pubblica passa da `/data/bonuses.json` (RLS vieta
  l'accesso anonimo alla tabella `bonuses`).
- Il download PDF in Supabase avviene dalla finestra di stampa: su Storage viene
  caricato il DOCX (scelta già documentata nel codice).
- Email di conferma signup: SMTP configurato su Supabase, guida in
  `docs/email-setup.md`.
