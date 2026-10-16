# Istruzioni progetto BonusRadar

## Scorciatoie dell'utente

- **`cpd`** = **c**ommit + **p**ush + **d**eploy. Quando l'utente la usa: commit di
  tutte le modifiche pertinenti con un messaggio descrittivo, `git push origin main`
  e `freebuff-deploy start`, poi verifica lo stato (`freebuff-deploy status`) e che
  il sito risponda. Se working tree pulita, segnalarlo invece di creare commit vuoti.

## Comandi chiave

```bash
# da app/frontend
npx tsc -b --noEmit        # typecheck
npx eslint .               # lint
npx vite build             # build
npm run test:e2e           # smoke E2E (preview attiva su :3000)
BASE_URL=https://bonusradar.freebuff.app npm run test:e2e   # E2E su produzione

python3 scripts/scraper.py  # dalla root: aggiorna catalogo JSON (+ Supabase se possibile)
freebuff-deploy check       # comandi di deploy effettivi
```

## Vincoli da rispettare

- `app/frontend/vite.config.ts` non va toccato senza esplicito consenso
  (Freebuff richiede `server.hmr: false`).
- Il build command di deploy **deve** leggere il file d'ambiente del deploy
  (`node --env-file=../../.env.local`): senza, il bundle esce senza URL Supabase
  e la app crasha a startup. `dist/` alla radice va svuotato prima della copia.
- `.env` / `.env.local` non vengono mai letti né stampati.
