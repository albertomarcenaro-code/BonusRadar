-- ============================================================
-- Migrazione: fonti "direct" (bandi evergreen) + allineamento del
-- catalogo ai soli bandi verificati dal gate qualità.
--
-- Da eseguire una volta nell'SQL Editor di Supabase. È idempotente:
-- si può rilanciare senza effetti collaterali.
-- ============================================================

begin;

-- ------------------------------------------------------------
-- 1) catalog_sources: modalità di scansione e URL diretti
-- ------------------------------------------------------------
alter table public.catalog_sources
  add column if not exists mode text not null default 'list',
  add column if not exists direct_urls text[] not null default '{}';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'catalog_sources_mode_check'
  ) then
    alter table public.catalog_sources
      add constraint catalog_sources_mode_check check (mode in ('list', 'direct'));
  end if;
end $$;

-- Una fonte "direct" senza URL non produrrebbe nulla: meglio impedirlo.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'catalog_sources_direct_urls_check'
  ) then
    alter table public.catalog_sources
      add constraint catalog_sources_direct_urls_check
      check (mode = 'list' or array_length(direct_urls, 1) >= 1);
  end if;
end $$;

-- ------------------------------------------------------------
-- 2) Fonti evergreen: si legge direttamente la pagina del bando
-- ------------------------------------------------------------
insert into public.catalog_sources
  (slug, name, authority, description, url, list_url, base_url, residency,
   topics, target, enabled, priority, note, mode, direct_urls)
values
  (
    'inps-prestazioni', 'INPS — Prestazioni e sussidi', 'INPS',
    'Prestazioni permanenti dell''INPS (Assegno unico, Assegno di inclusione, Bonus asilo nido): non compaiono in una pagina di avvisi, si leggono direttamente dalla scheda ufficiale.',
    'https://www.inps.it/', 'https://www.inps.it/', 'https://www.inps.it/',
    null, '{}', '{persona}', true, 6,
    'Modalità direct: ogni URL di direct_urls è una scheda di prestazione permanente.',
    'direct',
    array[
      'https://www.inps.it/it/it/dettaglio-scheda.it.schede-servizio-strumento.schede-servizi.assegno-unico-e-universale-per-i-figli-a-carico-55984.assegno-unico-e-universale-per-i-figli-a-carico.html',
      'https://www.inps.it/it/it/dettaglio-scheda.it.schede-servizio-strumento.schede-servizi.assegno-di-inclusione-adi.html',
      'https://www.inps.it/it/it/dettaglio-scheda.it.schede-servizio-strumento.schede-servizi.bonus-asilo-nido-e-forme-di-supporto-presso-la-propria-abitazione-51105.bonus-asilo-nido-e-forme-di-supporto-presso-la-propria-abitazione.html'
    ]
  ),
  (
    'ade-casa', 'Agenzia delle Entrate — Agevolazioni casa', 'Agenzia delle Entrate',
    'Detrazioni permanenti per la casa (ristrutturazioni edilizie, Superbonus): pagine ufficiali sempre valide, non annunci.',
    'https://www.agenziaentrate.gov.it/', 'https://www.agenziaentrate.gov.it/portale/aree-tematiche/casa',
    'https://www.agenziaentrate.gov.it/',
    null, '{}', '{persona,impresa}', true, 7,
    'Modalità direct: le due pagine sono la fonte primaria delle detrazioni edilizie.',
    'direct',
    array[
      'https://www.agenziaentrate.gov.it/portale/aree-tematiche/casa/agevolazioni/agevolazioni-per-le-ristrutturazioni-edilizie',
      'https://www.agenziaentrate.gov.it/portale/superbonus-110-'
    ]
  )
on conflict (slug) do update set
  name         = excluded.name,
  authority    = excluded.authority,
  description  = excluded.description,
  url          = excluded.url,
  list_url     = excluded.list_url,
  base_url     = excluded.base_url,
  topics       = excluded.topics,
  target       = excluded.target,
  enabled      = excluded.enabled,
  priority     = excluded.priority,
  note         = excluded.note,
  mode         = excluded.mode,
  direct_urls  = excluded.direct_urls,
  updated_at   = now();

-- ------------------------------------------------------------
-- 3) Fonti che oggi non si leggono
-- ------------------------------------------------------------
-- FVG: la home regionale produceva un solo candidato; la pagina
-- "bandi e avvisi" riporta data di pubblicazione e scadenza per ogni voce.
update public.catalog_sources
   set list_url = 'https://www.regione.fvg.it/rafvg/cms/RAFVG/MODULI/bandi_avvisi',
       base_url = 'https://www.regione.fvg.it/',
       note = 'Pagina bandi e avvisi: ogni voce riporta "scadenza GG.MM.AAAA". Aggiornata il 16/11/2026.',
       updated_at = now()
 where slug = 'regione-fvg';

-- MASE: /portale/incentivi risponde ma i link puntano al vecchio mise.gov.it
-- (404) e /portale/bandi non esiste: la fonte non è leggibile oggi.
update public.catalog_sources
   set enabled = false,
       note = 'Non leggibile al 16/11/2026: /portale/incentivi rimanda a mise.gov.it (404), /portale/bandi risponde 404 e /bandi-e-avvisi 403.',
       updated_at = now()
 where slug = 'mase';

-- Invitalia Autoimpiego: le pagine sono programmi permanenti senza scadenza,
-- ma hanno importi e requisiti: si leggono ancora, senza data.
update public.catalog_sources
   set note = 'Pagine di programma: spesso senza scadenza (sportello/fino a esaurimento). Il gate le ammette solo con almeno due evidenze.',
       updated_at = now()
 where slug = 'invitalia-autoimpiego';

-- ------------------------------------------------------------
-- 4) bonuses: colonne del gate qualità
-- ------------------------------------------------------------
alter table public.bonuses
  add column if not exists is_active boolean not null default true,
  add column if not exists gate_status text,
  add column if not exists gate_reason text,
  add column if not exists detail_fetched_at timestamptz,
  add column if not exists source_excerpts jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'bonuses_gate_status_check'
  ) then
    alter table public.bonuses
      add constraint bonuses_gate_status_check
      check (gate_status is null or gate_status in ('bando', 'quarantena', 'notizia'));
  end if;
end $$;

-- ------------------------------------------------------------
-- 5) Allineamento immediato: attivi solo i bandi verificati
--    (elenco prodotto dallo scraper: 12 schede con dati letti dalla fonte)
-- ------------------------------------------------------------
with verificati(title) as (
  values
    ('Avviso pubblico per la presentazione di domande di incentivi a fondo perduto destinati ai datori di lavoro privati per l''assunzione di lavoratori con disabilità'),
    ('Voucher cloud e cybersecurity'),
    ('Fondo di contrasto alla deindustrializzazione 2026'),
    ('Voucher Internazionalizzazione Pmi 2027'),
    ('Finanziamenti con provvista BEI e contributo in conto interessi'),
    ('Basket Bond Lazio – Contributo sui costi di emissione sostenuti dalle Pmi ammissibili'),
    ('Autoimpiego Centro-Nord'),
    ('Resto al Sud 2.0'),
    ('Smart&Start Italia'),
    ('Assegno unico e universale per i figli a carico'),
    ('Assegno di Inclusione (ADI)'),
    ('Superbonus')
)
update public.bonuses b
   set gate_status = 'bando',
       is_active   = true
  from verificati v
 where b.norm_title = lower(btrim(v.title));

-- Tutto il resto esce dal catalogo pubblico (resta in tabella come storico).
update public.bonuses
   set gate_status = coalesce(gate_status, 'quarantena'),
       is_active   = false
 where gate_status is distinct from 'bando';

-- ------------------------------------------------------------
-- 6) Vista del solo catalogo verificato (per query e controlli)
-- ------------------------------------------------------------
create or replace view public.verified_bonuses as
  select *
    from public.bonuses
   where gate_status = 'bando'
     and is_active is true;

-- La vista deve rispettare i permessi e le RLS di chi interroga, non del
-- creatore (Supabase segnala le viste SECURITY DEFINER come problema).
alter view public.verified_bonuses set (security_invoker = true);

commit;

-- ============================================================
-- Fix mirato per un database che ha già eseguito la migrazione
-- (risolve l'avviso "view is defined with the SECURITY DEFINER property"):
--   alter view public.verified_bonuses set (security_invoker = true);
-- ============================================================

-- ============================================================
-- Verifica dopo la migrazione (atteso: 1 riga, contatori coerenti)
-- ============================================================
-- select count(*) filter (where gate_status = 'bando')      as bandi_verificati,
--        count(*) filter (where gate_status <> 'bando')     as fuori_catalogo,
--        count(*) filter (where is_active)                   as attivi
--   from public.bonuses;
--
-- select slug, mode, array_length(direct_urls, 1) as url_diretti, enabled
--   from public.catalog_sources
--  where mode = 'direct';
