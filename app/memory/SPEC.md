# BonusRadar Italia — SPEC

Single-user (no login) Italian app that monitors bonus websites weekly, filters bonuses by the user's profile via AI, and prepares pre-filled application documents (PDF + DOCX) ready to sign.

## Stack / AI
- Claude Sonnet 4.5 (`claude-sonnet-4-5-20250929`) via emergentintegrations + EMERGENT_LLM_KEY (backend/services/llm.py).
- Scraping: httpx + BeautifulSoup → LLM extracts bonus JSON (services/scanner.py).
- Docs: LLM composes content → reportlab PDF + python-docx DOCX, stored in backend/storage/documents/{folder_id}/ (services/docgen.py).
- Weekly scheduler: asyncio loop started in lifespan; waits 10 min after boot, then hourly checks, runs scan if last run ≥ 7 days ago.

## Data model (Mongo)
- `profile` (single doc `_id: "me"`): personal data, residence, family_members[], isee_value, annual_income, employment_status, housing, iban, interests[], notes.
- `sources`: id, name, url, last_scanned_at, last_status, bonus_found.
- `bonuses`: id, title, norm_title (dedupe), authority, category, amount, deadline, summary, requirements[], required_documents[], source_url, eligibility (eligible|maybe|not_eligible|unknown), eligibility_reason, is_new.
- `documents`: id, bonus_id, bonus_title, status (da_firmare|firmato|inviato|approvato), files[{name,kind}], attachments[], submission_notes.
- `meta` `_id: scan_status`: running, phase, last_run_at, log[].

## API (all /api)
GET/PUT /profile (PUT triggers background eligibility re-eval) · GET/POST /sources, DELETE /sources/{id} · GET /scan/status, POST /scan (409 if running) · GET /bonus, GET /bonus/{id}, POST /bonus/evaluate · GET/POST /documents (POST {bonus_id}, synchronous LLM ~20-40s), PATCH/DELETE /documents/{id}, GET /documents/{id}/file/{pdf|docx}, GET /documents/{id}/zip · GET /dashboard

## Frontend pages
/ dashboard · /questionnaire (4-step) · /bonus (catalog + filters + "Prepara documenti") · /documents (folders, downloads, status) · /sources (manage + manual scan + log)

## Seed (python seed.py, idempotent)
4 sources (INPS, Agenzia Entrate, Governo, Money.it) and 8 bonuses (Assegno Unico, Bonus Asilo Nido, Bonus Nuovi Nati, Carta Dedicata a te, Bonus Psicologo, Bonus Ristrutturazioni, Contributo Affitto Giovani, Bonus Elettrodomestici), eligibility initially "unknown".
