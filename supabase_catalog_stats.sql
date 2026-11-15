-- v2 · 15/11/2026 — Contatori pubblici e stato dei bandi (script ri-eseguibile)
-- ============================================================
-- BonusRadar Italia — RPC `catalog_stats()` + colonne di stato su `bonuses`
-- ============================================================
-- Esegui questo script nell'SQL Editor di Supabase, DOPO
-- supabase_catalog_sources.sql e supabase_schema.sql.
--
-- Serve a due cose.
--
-- 1) STATO DEI BANDI. Lo scraper non cancella più niente: un bando che non
--    viene più rintracciato resta in tabella come storico con
--    `is_active = false` (e `archived_at` valorizzato). Così il catalogo e il
--    matching con il profilo vedono solo i bandi in vigore, mentre il
--    contatore pubblico può contare anche quelli passati.
--    Un bando che ricompare torna attivo: l'upsert dello scraper rimette
--    `is_active = true`.
--
-- 2) CONTATORI PUBBLICI. La landing mostra "Bandi catalogati" e "Portali
--    monitorati", ma la RLS non permette agli utenti anonimi di leggere le
--    tabelle `bonuses` e `catalog_sources`. Questa funzione espone SOLO i
--    numeri (nessun titolo, nessun dato personale): restano quelli del
--    database e cambiano da soli a ogni run dello scraper.
--
-- `security definer` = la funzione legge le tabelle con i permessi del suo
-- proprietario (il ruolo che esegue questo script), non con quelli di chi la
-- chiama. `stable` = sola lettura. L'esecuzione è concessa ai ruoli `anon` e
-- `authenticated`: è la chiave pubblica già usata dal frontend.
-- ============================================================

-- ---------- Stato dei bandi ----------
alter table public.bonuses
  add column if not exists is_active boolean not null default true;
alter table public.bonuses
  add column if not exists archived_at timestamptz;

create index if not exists idx_bonuses_active on public.bonuses (is_active);

-- ---------- Contatori pubblici ----------
create or replace function public.catalog_stats()
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select jsonb_build_object(
    'bonuses', (select count(*) from public.bonuses),
    'active', (select count(*) from public.bonuses where is_active),
    'sources', (select count(*) from public.catalog_sources where enabled)
  );
$$;

revoke all on function public.catalog_stats() from public;
grant execute on function public.catalog_stats() to anon, authenticated;

-- Verifica (tre numeri, es. {"bonuses": 61, "active": 56, "sources": 15}):
--   select public.catalog_stats();
