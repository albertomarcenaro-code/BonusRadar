-- v1 · 18/11/2026 — Pubblico del profilo (destinatario dei bandi)
-- ============================================================
-- Da eseguire nell'SQL Editor di Supabase, da solo, dopo aver già applicato
-- supabase_schema.sql. È ri-eseguibile.
--
-- Cosa fa, e solo questo:
--   1) aggiunge `type` a `profiles` con default 'persona' (i profili già
--      esistenti diventano privati, il caso più comune).
--
-- `type` accetta i valori del matching: persona, impresa, artigiano,
-- professionista. Senza questa migrazione il profilo si salva lo stesso (il
-- frontend rimanda il profilo senza `type`), ma il pubblico scelto non viene
-- conservato.
-- ============================================================

alter table public.profiles
  add column if not exists type text not null default 'persona';

-- ---------- Verifica ----------
-- Atteso: una riga per pubblico, senza valori fuori elenco.
select type, count(*) as profili
from public.profiles
group by type;
