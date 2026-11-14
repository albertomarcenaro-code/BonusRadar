# Istruzioni progetto BonusRadar

## Scorciatoie dell'utente

- **`cpd`** = **c**ommit + **p**ush + **d**eploy. Quando l'utente la usa: commit di
  tutte le modifiche pertinenti con un messaggio descrittivo, `git push` su `main`,
  `npm run build` alla radice e pubblicazione dell'ambiente Production del progetto
  Sites `11d60866…`, poi verifica che il sito risponda. Se working tree pulita,
  segnalarlo invece di creare commit vuoti.

## Comandi chiave

```bash
# da app/frontend
npx tsc -b --noEmit        # typecheck
npx eslint .               # lint
npx vite build             # build
npm run test:e2e           # smoke E2E (preview attiva su :3000)
BASE_URL=https://bonusradar.freebuff.page npm run test:e2e  # E2E su produzione

python3 scripts/scraper.py  # dalla root: aggiorna catalogo JSON (+ Supabase se possibile)
npm run build               # dalla root: build di deploy (output in dist/)
```

## Vincoli da rispettare

- `app/frontend/vite.config.ts` non va toccato senza esplicito consenso
  (Freebuff richiede `server.hmr: false`).
- Il build command di deploy **deve** leggere il file d'ambiente del deploy
  (`node --env-file=../../.env.local`): senza, il bundle esce senza URL Supabase
  e la app crasha a startup. `dist/` alla radice va svuotato prima della copia.
- `VITE_SUPABASE_URL` deve essere la **sola origine** del progetto
  (`https://<ref>.supabase.co`), senza `/rest/v1`: con un percorso, supabase-js
  chiama `…/rest/v1/auth/v1/token` e il login fallisce con 404 senza messaggi.
- `.env` / `.env.local` non vengono mai letti né stampati.
