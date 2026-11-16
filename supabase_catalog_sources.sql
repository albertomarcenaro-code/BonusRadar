-- v1 · 14/11/2026 — Catalogo delle fonti monitorate (script ri-eseguibile)
-- ============================================================
-- BonusRadar Italia — Tabella `catalog_sources`
-- ============================================================
-- Esegui questo script nell'SQL Editor di Supabase, DOPO supabase_schema.sql.
--
-- Differenza rispetto a `sources` (già presente in supabase_schema.sql):
--   sources          → una riga per utente, sono le fonti personali
--   catalog_sources  → catalogo GLOBALE letto dallo scraper (scripts/scraper.py)
--
-- `enabled = true` significa: lo scraper visita davvero `list_url`.
-- `enabled = false` significa: fonte censita ma non scansionabile oggi; il
-- motivo è scritto in `note`. Nessuna fonte è disattivata in silenzio.
--
-- `topics` vuoto = nessun filtro tematico (si applica solo BONUS_KEYWORDS).
-- `url` è il link ufficiale indicato; `list_url` è la pagina che lo scraper
-- scarica davvero (a volte diversa: es. Agenzia delle Entrate o INAIL).
-- ============================================================

create table if not exists public.catalog_sources (
  slug        text primary key,
  name        text not null,
  authority   text not null default '',
  description text not null default '',
  url         text not null,
  list_url    text not null,
  base_url    text not null default '',
  residency   text,
  topics      text[] not null default '{}',
  -- A chi si rivolge la fonte: persona, impresa, artigiani, professionisti.
  -- Usato per etichettare le schede estratte e per il matching per tipo di
  -- soggetto. Default volutamente ampio: nessuna scheda sparisce.
  target      text[] not null default '{persona,impresa}',
  enabled     boolean not null default false,
  priority    integer not null default 100,
  note        text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists idx_catalog_sources_enabled
  on public.catalog_sources (enabled, priority);

alter table public.catalog_sources enable row level security;

-- Migrazione per i database già creati con la v1 (senza `target`).
alter table public.catalog_sources
  add column if not exists target text[] not null default '{persona,impresa}';

-- Lettura per gli utenti autenticati; la scrittura resta al service_role
-- (che bypassa la RLS e viene usato dallo scraper in GitHub Actions).
drop policy if exists "catalog_sources_select_authenticated" on public.catalog_sources;
create policy "catalog_sources_select_authenticated" on public.catalog_sources
  for select using (auth.role () = 'authenticated');

-- ============================================================
-- Seed — 23 fonti (15 abilitate, 8 censite ma non scansionabili)
-- ============================================================
insert into public.catalog_sources
  (slug, name, authority, description, url, list_url, base_url, residency, topics, enabled, priority, note)
values
  (
    'incentivi-gov-it', 'incentivi.gov.it', 'Presidenza del Consiglio dei Ministri (MIMIT)',
    $d$È il motore di ricerca ufficiale del Ministero delle Imprese e del Made in Italy che aggrega tutti gli incentivi, i bandi e le agevolazioni attive promosse dalle amministrazioni nazionali e locali per cittadini, aspiranti imprenditori, professionisti e imprese.$d$,
    'https://www.incentivi.gov.it/', 'https://www.incentivi.gov.it/', 'https://www.incentivi.gov.it/',
    null, '{}', true, 1,
    'Timeout ricorrente dai runner GitHub: al 14/11/2026 la fonte viene saltata (il resto prosegue).'
  ),
  (
    'inps', 'INPS', 'INPS',
    $d$Portale dell'Istituto Nazionale della Previdenza Sociale dove vengono pubblicati e gestiti tutti i bonus per famiglie, genitori, studenti, lavoratori e pensionati (es. Assegno Unico, Bonus Nido, Bonus Mamme, Carta Dedicata a te, ADI).$d$,
    'https://www.inps.it/', 'https://www.inps.it/', 'https://www.inps.it/',
    null, '{}', true, 2,
    'Fonte più produttiva: 12 candidati il 14/11/2026.'
  ),
  (
    'agenzia-entrate', 'Agenzia delle Entrate', 'Agenzia delle Entrate',
    $d$Sezione ufficiale dedicata a tutte le detrazioni fiscali, crediti d'imposta e bonus edilizi/mobiliari per cittadini e aziende (es. Bonus Ristrutturazioni, Bonus Mobili, acquisto prima casa, crediti R&S).$d$,
    'https://www.agenziaentrate.gov.it/portale/cittadini/agevolazioni', 'https://www.agenziaentrate.gov.it/', 'https://www.agenziaentrate.gov.it/',
    null, '{}', true, 3,
    'La pagina /portale/cittadini/agevolazioni è un hub con 8 link e non produce bandi: si scansiona la home.'
  ),
  (
    'invitalia', 'Invitalia', 'Invitalia — Agenzia nazionale per lo sviluppo d''impresa',
    $d$Agenzia nazionale per lo sviluppo d'impresa. Gestisce i principali incentivi nazionali per la creazione e la crescita di imprese e startup (es. Resto al Sud, Smart&Start, ON - Oltre Nuove Imprese a Tasso Zero, Cultura Cresce).$d$,
    'https://www.invitalia.it/per-le-imprese/incentivi-e-strumenti', 'https://www.invitalia.it/per-le-imprese/incentivi-e-strumenti', 'https://www.invitalia.it/',
    null, '{}', true, 4,
    '10 titoli reali estratti il 14/11/2026 (Brevetti+, Voucher cloud, ON, Smart&Start, Cultura Cresce).'
  ),
  (
    'comune-genova', 'Comune di Genova', 'Comune di Genova',
    $d$Avvisi e contributi del Comune di Genova: casa e affitto, mobilità sostenibile, famiglie, nidi e scuola, commercio locale.$d$,
    'https://www.comune.genova.it/novita/avvisi', 'https://www.comune.genova.it/novita/avvisi', 'https://www.comune.genova.it/',
    'Residenza nel Comune di Genova',
    array['affitto','casa','abitaz','alloggi','ristrutturaz','ediliz','mobilit','biciclett','bike','consegna a domicilio','famiglia','figli','nido','asilo','maternit','genitori','scuola','mensa','student','commercio','commerc','esercizi','imprese','negoz','tessuto economico'],
    true, 5, ''
  ),
  (
    'regione-liguria', 'Regione Liguria', 'Regione Liguria',
    $d$Bandi e avvisi della Regione Liguria: efficientamento energetico, sostegno alla famiglia, trasporti, formazione e lavoro.$d$,
    'https://www.regione.liguria.it/homepage-bandi-e-avvisi/publiccompetitions.html', 'https://www.regione.liguria.it/homepage-bandi-e-avvisi/publiccompetitions.html', 'https://www.regione.liguria.it/',
    'Residenza in Liguria',
    array['energet','efficientament','fotovoltaic','caldaia','isolament','riqualificaz','famiglia','figli','nido','maternit','assegno','trasport','mobilit','abbonament','ferrovi','treno','formazion','lavoro','occupabilit','apprendistat','impresa','inoccup','corsi','borse','student','iscrizion'],
    true, 6, ''
  ),
  (
    'mase', 'MASE', 'Ministero dell''Ambiente e della Sicurezza Energetica',
    $d$Pubblica bandi, decreti e avvisi su transizione ecologica, incentivi per veicoli a zero emissioni, economia circolare ed efficienza energetica per enti, imprese e privati.$d$,
    'https://www.mase.gov.it/portale/incentivi', 'https://www.mase.gov.it/portale/incentivi', 'https://www.mase.gov.it/',
    null, '{}', true, 7,
    '3 candidati il 14/11/2026: sono pagine-sezione permanenti (Ecobonus, Fondo efficienza), non bandi con scadenza.'
  ),
  (
    'enea', 'ENEA — Efficienza Energetica', 'ENEA',
    $d$Portale ufficiale per i vademecum tecnici, i requisiti e l'invio delle pratiche relative alle detrazioni fiscali per il risparmio energetico e la riqualificazione degli edifici (Ecobonus e Bonus Casa).$d$,
    'https://www.efficienzaenergetica.enea.it/', 'https://www.efficienzaenergetica.enea.it/', 'https://www.efficienzaenergetica.enea.it/',
    null, '{}', true, 8,
    '2 candidati il 14/11/2026 (vademecum Ecobonus).'
  ),
  (
    'simest', 'SIMEST (Gruppo CDP)', 'SIMEST',
    $d$Portale dedicato alle imprese italiane che vogliono internazionalizzarsi o investire nella transizione digitale ed ecologica, offrendo finanziamenti agevolati e contributi a fondo perduto (anche a valere su fondi PNRR).$d$,
    'https://www.simest.it/', 'https://www.simest.it/', 'https://www.simest.it/',
    null, '{}', true, 9,
    '1 candidato il 14/11/2026.'
  ),
  (
    'mic', 'Ministero della Cultura (MiC)', 'Ministero della Cultura',
    $d$Pubblica avvisi, contributi e tax credit rivolti a cittadini (es. Carta della Cultura Giovani e del Merito), enti del terzo settore e imprese culturali/creative (cinema, spettacolo, editoria).$d$,
    'https://cultura.gov.it/', 'https://cultura.gov.it/', 'https://cultura.gov.it/',
    null, '{}', true, 10,
    '1 candidato il 14/11/2026.'
  ),
  (
    'inail', 'INAIL', 'INAIL',
    $d$Finanziamenti a fondo perduto per le imprese che investono nel miglioramento dei livelli di salute e sicurezza nei luoghi di lavoro e nella bonifica dell'amianto (Bando ISI).$d$,
    'https://www.inail.it/', 'https://www.inail.it/cs/news', 'https://www.inail.it/',
    null, '{}', true, 11,
    'La home va in timeout; /cs/news risponde e produce candidati.'
  ),
  (
    'ministero-lavoro', 'Ministero del Lavoro', 'Ministero del Lavoro e delle Politiche Sociali',
    $d$Ministero del Lavoro e delle Politiche Sociali: incentivi all'occupazione, avvisi e comunicazioni su lavoro e politiche sociali.$d$,
    'https://www.lavoro.gov.it/', 'https://www.lavoro.gov.it/', 'https://www.lavoro.gov.it/',
    null, '{}', true, 12, ''
  ),
  (
    'cliclavoro', 'Cliclavoro', 'Ministero del Lavoro e delle Politiche Sociali',
    $d$Portale pubblico per l'incontro tra domanda e offerta di lavoro, con avvisi su incentivi all'assunzione e opportunità formative.$d$,
    'https://www.cliclavoro.gov.it/', 'https://www.cliclavoro.gov.it/', 'https://www.cliclavoro.gov.it/',
    null, '{}', true, 13, ''
  ),
  (
    'regione-toscana', 'Regione Toscana', 'Regione Toscana',
    $d$Bandi, contributi e avvisi della Regione Toscana per cittadini e imprese.$d$,
    'https://www.regione.toscana.it/', 'https://www.regione.toscana.it/', 'https://www.regione.toscana.it/',
    'Residenza in Toscana', '{}', true, 14, ''
  ),
  (
    'regione-veneto', 'Regione Veneto', 'Regione Veneto',
    $d$Bandi, contributi e avvisi della Regione Veneto per cittadini e imprese.$d$,
    'https://www.regione.veneto.it/', 'https://www.regione.veneto.it/', 'https://www.regione.veneto.it/',
    'Residenza nel Veneto', '{}', true, 15, ''
  ),

  -- ---------- Censite ma non scansionabili (enabled = false) ----------
  (
    'gse', 'GSE', 'Gestore dei Servizi Energetici',
    $d$Ente pubblico che gestisce gli incentivi legati alle fonti rinnovabili e all'efficienza energetica per privati, condomìni, aziende e PA (es. Conto Termico, Comunità Energetiche Rinnovabili, ritiro dedicato fotovoltaico).$d$,
    'https://www.gse.it/', 'https://www.gse.it/', 'https://www.gse.it/',
    null, '{}', false, 20,
    'Risponde 403 ai client non-browser (verificato il 14/11/2026): serve una richiesta autenticata o un approccio diverso.'
  ),
  (
    'sace', 'SACE (Gruppo CDP)', 'SACE',
    $d$Offre garanzie pubbliche, assicurazione del credito e strumenti finanziari (es. Garanzia Futuro, Garanzia Green) per facilitare l'accesso al credito bancario delle PMI e grandi imprese.$d$,
    'https://www.sace.it/', 'https://www.sace.it/', 'https://www.sace.it/',
    null, '{}', false, 21,
    'Risponde 403 ai client non-browser (verificato il 14/11/2026).'
  ),
  (
    'mit', 'MIT', 'Ministero delle Infrastrutture e dei Trasporti',
    $d$Sezione dedicata agli incentivi per la mobilità sostenibile, trasporto merci, rinnovo parco veicolare aziendale e bonus trasporti/patenti.$d$,
    'https://www.mit.gov.it/', 'https://www.mit.gov.it/', 'https://www.mit.gov.it/',
    null, '{}', false, 22,
    'Nessuna risposta (timeout) il 14/11/2026.'
  ),
  (
    'opencoesione', 'OpenCoesione', 'Dipartimento per le politiche di coesione',
    $d$Portale governativo dedicato alle politiche di coesione che raccoglie dati e avvisi sui finanziamenti europei, nazionali e regionali (fondi FESR, FSE+, PNRR).$d$,
    'https://opencoesione.gov.it/', 'https://opencoesione.gov.it/', 'https://opencoesione.gov.it/',
    null, '{}', false, 23,
    'Risponde 403 ai client non-browser (verificato il 14/11/2026).'
  ),
  (
    'gazzetta-ufficiale', 'Gazzetta Ufficiale', 'Istituto Poligrafico e Zecca dello Stato',
    $d$La fonte primaria assoluta: pubblica tutti i decreti legge, le leggi di bilancio e i bandi ministeriali nel momento esatto in cui entrano in vigore.$d$,
    'https://www.gazzettaufficiale.it/', 'https://www.gazzettaufficiale.it/', 'https://www.gazzettaufficiale.it/',
    null, '{}', false, 24,
    '28 link in home, 0 candidati bonus (14/11/2026): la home pubblica decreti e sommari, non avvisi di bonus. Servirebbe una ricerca per parole chiave sul testo dei decreti.'
  ),
  (
    'bandi-filse', 'FI.L.S.E. — Bandi Online (Liguria)', 'Filse S.p.A. — Regione Liguria',
    $d$Finanziaria Ligure per lo Sviluppo Economico: è il portale ufficiale della Regione Liguria che gestisce i bandi a fondo perduto, voucher e garanzie sia per imprese che per famiglie/cittadini (es. Dote Sport, Nidi Gratis, efficientamento).$d$,
    'https://bandifilse.regione.liguria.it/', 'https://www.filse.it/it/bandi-avvisi-gare/bandi-attivi/publiccompetitions/', 'https://www.filse.it/',
    'Residenza in Liguria', '{}', false, 25,
    'bandifilse è una pagina di rinvio (2 link) verso filse.it; i bandi attivi liguri arrivano già dalla fonte Regione Liguria.'
  ),
  (
    'unioncamere', 'Unioncamere / Camere di Commercio', 'Unioncamere',
    $d$Portale nazionale delle Camere di Commercio; punto di partenza per rintracciare i bandi camerali locali (es. Voucher Digitali I4.0, fiere, internazionalizzazione, turismo).$d$,
    'https://www.unioncamere.gov.it/', 'https://www.unioncamere.gov.it/', 'https://www.unioncamere.gov.it/',
    null, '{}', false, 26,
    '6 link in home, 0 candidati (14/11/2026): i bandi camerali stanno nelle pagine delle singole CCIAA, non nel portale nazionale.'
  ),
  (
    'eu-funding-tenders', 'EU Funding & Tenders Portal', 'Commissione Europea',
    $d$Il portale ufficiale della Commissione Europea per tutti i finanziamenti diretti e le gare d'appalto dell'Unione Europea (Horizon Europe, LIFE, Digital Europe, Europa Creativa).$d$,
    'https://ec.europa.eu/info/funding-tenders/opportunities/portal/', 'https://ec.europa.eu/info/funding-tenders/opportunities/portal/', 'https://ec.europa.eu/',
    null, '{}', false, 27,
    'Portale interamente JavaScript: 0 elementi estraibili dall''HTML (14/11/2026). Richiederebbe la loro API di ricerca.'
  ),
  -- ---------------- Imprese, artigiani e professionisti (16/11/2026) ----------------
  -- Pagine verificate con il parser attuale prima di essere messe in mappa.
  (
    'lazio-innova', 'Lazio Innova', 'Regione Lazio (Lazio Innova)',
    $d$Società della Regione Lazio che gestisce bandi e contributi per imprese, startup e professionisti del Lazio (voucher digitalizzazione e internazionalizzazione, contributi in conto interesse, avvisi per giovani attività professionali).$d$,
    'https://www.lazioinnova.it/bandi/', 'https://www.lazioinnova.it/bandi/', 'https://www.lazioinnova.it/',
    'Sede operativa o residenza nel Lazio', '{}', true, 16,
    'Verificata il 16/11/2026: 12 card estratte dalla pagina bandi.'
  ),
  (
    'invitalia-autoimpiego', 'Invitalia — Autoimpiego e nuove imprese', 'Invitalia',
    $d$Incentivi nazionali per chi avvia o sviluppa un'attività in proprio: autoimpiego, nuove imprese a tasso zero, imprenditoria femminile, microimprese e artigiani.$d$,
    'https://www.invitalia.it/per-chi-vuole-fare-impresa/incentivi-e-strumenti', 'https://www.invitalia.it/per-chi-vuole-fare-impresa/incentivi-e-strumenti', 'https://www.invitalia.it/',
    null, '{}', true, 17,
    'Verificata il 16/11/2026: 13 card estratte (ON tasso zero, Autoimpiego Centro-Nord, Imprenditoria femminile).'
  ),
  (
    'sardegna-impresa', 'Sardegna Impresa (Confartigianato)', 'Confartigianato Sud Sardegna',
    $d$Portale di Confartigianato dedicato ai bandi per artigiani e piccole imprese della Sardegna: finanziamenti regionali, contributi camerali, avvisi per l'artigianato.$d$,
    'https://www.sardegnaimpresa.it/bandi', 'https://www.sardegnaimpresa.it/bandi', 'https://www.sardegnaimpresa.it/',
    'Sede operativa in Sardegna', '{}', true, 18,
    'Verificata il 16/11/2026: 10 card estratte.'
  ),
  (
    'fondoprofessioni', 'Fondoprofessioni', 'Fondoprofessioni',
    $d$Fondo interprofessionale per la formazione continua dei professionisti: avvisi e voucher formativi per studi professionali e lavoratori autonomi.$d$,
    'https://www.fondoprofessioni.it/avvisi', 'https://www.fondoprofessioni.it/avvisi', 'https://www.fondoprofessioni.it/',
    null, '{}', true, 19,
    'Verificata il 16/11/2026: 11 card estratte.'
  ),
  (
    'regione-fvg', 'Regione Friuli Venezia Giulia', 'Regione Autonoma Friuli Venezia Giulia',
    $d$Bandi e contributi regionali per imprese, artigiani e liberi professionisti del Friuli Venezia Giulia (innovazione, internazionalizzazione, artigianato, energia).$d$,
    'https://www.regione.fvg.it/', 'https://www.regione.fvg.it/', 'https://www.regione.fvg.it/',
    'Sede operativa o residenza in Friuli Venezia Giulia', '{}', true, 20,
    'Verificata il 16/11/2026: 23 link con parole chiave bando/contributo nella home. Filtro topics attivo perché la home è molto ampia.'
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
  enabled     = excluded.enabled,
  priority    = excluded.priority,
  note        = excluded.note,
  updated_at  = now();

-- Target editoriale delle fonti per imprese/artigiani/professionisti: il
-- default '{persona,impresa}' resta su tutte le altre.
update public.catalog_sources set target = '{impresa,professionisti}' where slug = 'lazio-innova';
update public.catalog_sources set target = '{impresa,artigiani}'      where slug = 'invitalia-autoimpiego';
update public.catalog_sources set target = '{artigiani,impresa}'      where slug = 'sardegna-impresa';
update public.catalog_sources set target = '{professionisti}'         where slug = 'fondoprofessioni';
update public.catalog_sources set target = '{impresa,artigiani}'      where slug = 'regione-fvg';

-- Fonti generiche: il target mirato lo deduce lo scraper dal testo del singolo
-- bando. Restano "persona + impresa" (default) le fonti che coprono entrambi i
-- pubblici (Agenzia delle Entrate, Comuni, Regioni, Cliclavoro, INAIL).
update public.catalog_sources set target = '{persona}'                where slug = 'inps';
update public.catalog_sources set target = '{impresa}'                where slug = 'invitalia';
update public.catalog_sources set target = '{impresa}'                where slug = 'simest';
update public.catalog_sources set target = '{impresa}'                where slug = 'mase';
update public.catalog_sources set target = '{impresa}'                where slug = 'mic';
update public.catalog_sources set target = '{impresa}'                where slug = 'gse';
update public.catalog_sources set target = '{impresa}'                where slug = 'sace';
update public.catalog_sources set target = '{impresa}'                where slug = 'unioncamere';
update public.catalog_sources set target = '{impresa}'                where slug = 'bandi-filse';
