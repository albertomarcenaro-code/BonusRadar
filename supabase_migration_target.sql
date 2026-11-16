-- v1 · 16/11/2026 — Migrazione `target` (destinatario dei bandi)
-- ============================================================
-- Da eseguire nell'SQL Editor di Supabase, da solo, dopo aver già applicato
-- supabase_schema.sql e supabase_catalog_sources.sql.
--
-- Cosa fa, e solo questo:
--   1) aggiunge `target` a `bonuses` (default persona+impresa);
--   2) aggiunge `target` a `catalog_sources` (default persona+impresa);
--   3) inserisce/aggiorna le 5 fonti per imprese, artigiani e professionisti;
--   4) assegna il target alle fonti generiche.
--
-- È ri-eseguibile: `add column if not exists` e `on conflict do update`.
-- Lo scraper funziona anche senza questa migrazione (fallback nel codice), ma
-- finché non la esegui il target non viene scritto in tabella e le fonti nuove
-- non vengono lette dal database.
-- ============================================================

-- ---------- 1) target sui bandi ----------
alter table public.bonuses
  add column if not exists target text[] not null default '{persona,impresa}';

-- ---------- 2) target sulle fonti ----------
alter table public.catalog_sources
  add column if not exists target text[] not null default '{persona,impresa}';

-- ---------- 3) fonti imprese / artigiani / professionisti ----------
insert into public.catalog_sources
  (slug, name, authority, description, url, list_url, base_url, residency, topics, target, enabled, priority, note)
values
  (
    'lazio-innova', 'Lazio Innova', 'Regione Lazio (Lazio Innova)',
    $d$Società della Regione Lazio che gestisce bandi e contributi per imprese, startup e professionisti del Lazio (voucher digitalizzazione e internazionalizzazione, contributi in conto interesse, avvisi per giovani attività professionali).$d$,
    'https://www.lazioinnova.it/bandi/', 'https://www.lazioinnova.it/bandi/', 'https://www.lazioinnova.it/',
    'Sede operativa o residenza nel Lazio', '{}', '{impresa,professionisti}', true, 16,
    'Verificata il 16/11/2026: 12 card estratte dalla pagina bandi.'
  ),
  (
    'invitalia-autoimpiego', 'Invitalia — Autoimpiego e nuove imprese', 'Invitalia',
    $d$Incentivi nazionali per chi avvia o sviluppa un'attività in proprio: autoimpiego, nuove imprese a tasso zero, imprenditoria femminile, microimprese e artigiani.$d$,
    'https://www.invitalia.it/per-chi-vuole-fare-impresa/incentivi-e-strumenti', 'https://www.invitalia.it/per-chi-vuole-fare-impresa/incentivi-e-strumenti', 'https://www.invitalia.it/',
    null, '{}', '{impresa,artigiani}', true, 17,
    'Verificata il 16/11/2026: pagina curata, le card sono nomi di incentivi senza testo.'
  ),
  (
    'sardegna-impresa', 'Sardegna Impresa (Confartigianato)', 'Confartigianato Sud Sardegna',
    $d$Portale di Confartigianato dedicato ai bandi per artigiani e piccole imprese della Sardegna: finanziamenti regionali, contributi camerali, avvisi per l'artigianato.$d$,
    'https://www.sardegnaimpresa.it/bandi', 'https://www.sardegnaimpresa.it/bandi', 'https://www.sardegnaimpresa.it/',
    'Sede operativa in Sardegna', '{}', '{artigiani,impresa}', true, 18,
    'Verificata il 16/11/2026: elenco misto a articoli divulgativi, filtri attivi.'
  ),
  (
    'fondoprofessioni', 'Fondoprofessioni', 'Fondoprofessioni',
    $d$Fondo interprofessionale per la formazione continua dei professionisti: avvisi e voucher formativi per studi professionali e lavoratori autonomi.$d$,
    'https://www.fondoprofessioni.it/avvisi', 'https://www.fondoprofessioni.it/avvisi', 'https://www.fondoprofessioni.it/',
    null, '{}', '{professionisti}', true, 19,
    'Verificata il 16/11/2026: elenco servito via JavaScript, oggi 0 bandi estraibili.'
  ),
  (
    'regione-fvg', 'Regione Friuli Venezia Giulia', 'Regione Autonoma Friuli Venezia Giulia',
    $d$Bandi e contributi regionali per imprese, artigiani e liberi professionisti del Friuli Venezia Giulia (innovazione, internazionalizzazione, artigianato, energia).$d$,
    'https://www.regione.fvg.it/', 'https://www.regione.fvg.it/', 'https://www.regione.fvg.it/',
    'Sede operativa o residenza in Friuli Venezia Giulia', '{}', '{impresa,artigiani}', true, 20,
    'Verificata il 16/11/2026: home ampia, filtro topics attivo.'
  )
on conflict (slug) do update set
  name        = excluded.name,
  authority   = excluded.authority,
  description = excluded.description,
  url         = excluded.url,
  list_url    = excluded.list_url,
  base_url    = excluded.base_url,
  residency   = excluded.residency,
  topics      = excluded.topics,
  target      = excluded.target,
  enabled     = excluded.enabled,
  priority    = excluded.priority,
  note        = excluded.note,
  updated_at  = now();

-- ---------- 4) target delle fonti generiche ----------
-- Le fonti che coprono entrambi i pubblici restano 'persona,impresa': il target
-- mirato lo deduce lo scraper dal testo del singolo bando.
update public.catalog_sources set target = '{impresa,professionisti}' where slug = 'lazio-innova';
update public.catalog_sources set target = '{impresa,artigiani}'      where slug = 'invitalia-autoimpiego';
update public.catalog_sources set target = '{artigiani,impresa}'      where slug = 'sardegna-impresa';
update public.catalog_sources set target = '{professionisti}'         where slug = 'fondoprofessioni';
update public.catalog_sources set target = '{impresa,artigiani}'      where slug = 'regione-fvg';
update public.catalog_sources set target = '{persona}'                where slug = 'inps';
update public.catalog_sources set target = '{impresa}'                where slug = 'invitalia';
update public.catalog_sources set target = '{impresa}'                where slug = 'simest';
update public.catalog_sources set target = '{impresa}'                where slug = 'mase';
update public.catalog_sources set target = '{impresa}'                where slug = 'mic';
update public.catalog_sources set target = '{impresa}'                where slug = 'gse';
update public.catalog_sources set target = '{impresa}'                where slug = 'sace';
update public.catalog_sources set target = '{impresa}'                where slug = 'unioncamere';
update public.catalog_sources set target = '{impresa}'                where slug = 'bandi-filse';

-- ---------- Verifica ----------
-- Atteso: 20 fonti abilitate e nessuna riga senza target.
select
  (select count(*) from public.catalog_sources where enabled)             as fonti_abilitate,
  (select count(*) from public.catalog_sources where target is null)      as fonti_senza_target,
  (select count(*) from public.bonuses where target is null)              as bandi_senza_target;
