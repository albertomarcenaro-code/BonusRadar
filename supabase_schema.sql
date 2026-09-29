-- ============================================================
-- BonusRadar Italia — Schema Supabase (PostgreSQL)
-- ============================================================
-- Esegui questo script nell'SQL Editor di Supabase.
-- Crea: tabelle (profiles, sources, bonuses, questionnaires, user_bonuses,
-- document_folders), bucket Storage "documents", policy RLS e dati seed.
--
-- Environment variables richieste dal frontend (Vite):
--   VITE_SUPABASE_URL      → https://<ref>.supabase.co
--   VITE_SUPABASE_ANON_KEY → chiave anon del progetto
-- ============================================================

-- ---------- Estensioni ----------
create extension if not exists "pgcrypto";

-- ---------- Tipi enumerati ----------
create type eligibility_status as enum ('eligible', 'maybe', 'not_eligible', 'unknown');
create type document_status as enum ('da_firmare', 'firmato', 'inviato', 'approvato');
create type questionnaire_status as enum ('in_progress', 'completed');

-- ============================================================
-- profiles — dati anagrafici/fiscali dell'utente (1:1 con auth.users)
-- ============================================================
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '',
  fiscal_code text not null default '',
  birth_date text not null default '',
  birth_place text not null default '',
  gender text not null default '',
  address text not null default '',
  city text not null default '',
  province text not null default '',
  region text not null default '',
  postal_code text not null default '',
  phone text not null default '',
  email text not null default '',
  iban text not null default '',
  employment_status text not null default '',
  annual_income numeric,
  isee_value numeric,
  housing text not null default '',
  family_members jsonb not null default '[]'::jsonb,
  interests text[] not null default '{}',
  notes text not null default '',
  updated_at timestamptz not null default now()
);

-- ============================================================
-- sources — siti istituzionali monitorati
-- ============================================================
create table if not exists public.sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  url text not null,
  created_at timestamptz not null default now(),
  last_scanned_at timestamptz,
  last_status text not null default 'mai scansionata',
  bonus_found integer not null default 0,
  unique (user_id, url)
);

-- ============================================================
-- bonuses — catalogo dei bonus rilevati (condiviso tra utenti)
-- ============================================================
create table if not exists public.bonuses (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  norm_title text generated always as (lower(btrim(title))) stored unique,
  authority text not null default '',
  category text not null default 'altro',
  amount text not null default '',
  deadline text not null default '',
  summary text not null default '',
  requirements text[] not null default '{}',
  required_documents text[] not null default '{}',
  source_url text not null default '',
  source_name text not null default '',
  eligibility eligibility_status not null default 'unknown',
  eligibility_reason text not null default '',
  is_new boolean not null default true,
  created_at timestamptz not null default now()
);

-- ============================================================
-- questionnaires — una riga per compilazione del questionario
-- (audit delle risposte inviate; il profilo corrente resta in profiles)
-- ============================================================
create table if not exists public.questionnaires (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  status questionnaire_status not null default 'completed',
  answers jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- ============================================================
-- user_bonuses — preferiti / bonus salvati dall'utente
-- ============================================================
create table if not exists public.user_bonuses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  bonus_id uuid not null references public.bonuses (id) on delete cascade,
  is_favorite boolean not null default true,
  note text not null default '',
  created_at timestamptz not null default now(),
  unique (user_id, bonus_id)
);

-- ============================================================
-- document_folders — pratiche/domande generate per un bonus
-- ============================================================
create table if not exists public.document_folders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  bonus_id uuid references public.bonuses (id) on delete set null,
  bonus_title text not null,
  authority text not null default '',
  status document_status not null default 'da_firmare',
  files jsonb not null default '[]'::jsonb,   -- [{name, kind, storage_path}]
  attachments text[] not null default '{}',
  submission_notes text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists idx_sources_user on public.sources (user_id);
create index if not exists idx_bonuses_eligibility on public.bonuses (eligibility);
create index if not exists idx_questionnaires_user on public.questionnaires (user_id);
create index if not exists idx_user_bonuses_user on public.user_bonuses (user_id);
create index if not exists idx_documents_user on public.document_folders (user_id);

-- ============================================================
-- RLS — Row Level Security
-- ============================================================
alter table public.profiles          enable row level security;
alter table public.sources           enable row level security;
alter table public.bonuses           enable row level security;
alter table public.questionnaires    enable row level security;
alter table public.user_bonuses      enable row level security;
alter table public.document_folders  enable row level security;

-- profiles: l'utente vede e modifica solo il proprio profilo
create policy "profiles_select_own" on public.profiles
  for select using (auth.uid () = id);
create policy "profiles_upsert_own" on public.profiles
  for insert with check (auth.uid () = id);
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid () = id) with check (auth.uid () = id);

-- sources: per utente
create policy "sources_all_own" on public.sources
  for all using (auth.uid () = user_id) with check (auth.uid () = user_id);

-- bonuses: catalogo in lettura per qualsiasi utente autenticato
create policy "bonuses_select_authenticated" on public.bonuses
  for select using (auth.role () = 'authenticated');

-- questionnaires: per utente
create policy "questionnaires_all_own" on public.questionnaires
  for all using (auth.uid () = user_id) with check (auth.uid () = user_id);

-- user_bonuses: per utente
create policy "user_bonuses_all_own" on public.user_bonuses
  for all using (auth.uid () = user_id) with check (auth.uid () = user_id);

-- document_folders: per utente
create policy "documents_all_own" on public.document_folders
  for all using (auth.uid () = user_id) with check (auth.uid () = user_id);

-- ============================================================
-- Storage — bucket privato "documents"
-- I file sono organizzati come <user_id>/<folder_id>/<file>
-- ============================================================
insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do nothing;

create policy "documents_bucket_read_own" on storage.objects
  for select using (
    bucket_id = 'documents'
    and auth.uid ()::text = (storage.foldername (name))[1]
  );
create policy "documents_bucket_insert_own" on storage.objects
  for insert with check (
    bucket_id = 'documents'
    and auth.uid ()::text = (storage.foldername (name))[1]
  );
create policy "documents_bucket_delete_own" on storage.objects
  for delete using (
    bucket_id = 'documents'
    and auth.uid ()::text = (storage.foldername (name))[1]
  );

-- ============================================================
-- Seed — catalogo bonus di partenza (idempotente via norm_title)
-- ============================================================
insert into public.bonuses (title, authority, category, amount, deadline, summary, requirements, required_documents, source_url, source_name, is_new)
values
  ('Assegno Unico e Universale per i figli', 'INPS', 'famiglia', 'da 57 € a 201 € al mese per figlio', 'domanda sempre aperta',
   'Sostegno economico mensile per ogni figlio a carico fino a 21 anni. L''importo varia in base all''ISEE del nucleo.',
   array['Figli a carico minori di 21 anni','Residenza in Italia'], array['Documento d''identità','Codici fiscali dei figli','IBAN'],
   'https://www.inps.it', 'INPS', false),
  ('Bonus Asilo Nido', 'INPS', 'famiglia', 'fino a 3.600 € annui', '31/12/2026',
   'Rimborso delle rette di asili nido pubblici e privati o supporto domiciliare per bambini sotto i 3 anni.',
   array['Figli di età inferiore a 3 anni','Iscrizione ad asilo nido'], array['Ricevute di pagamento rette','ISEE minorenni','IBAN'],
   'https://www.inps.it', 'INPS', false),
  ('Bonus Psicologo', 'INPS', 'salute', 'fino a 1.500 €', 'finestra annuale INPS',
   'Contributo per sessioni di psicoterapia presso professionisti iscritti all''albo.',
   array['ISEE non superiore a 50.000 €','Residenza in Italia'], array['ISEE','SPID/CIE'],
   'https://www.inps.it', 'INPS', false),
  ('Bonus Ristrutturazioni (detrazione 50%/36%)', 'Agenzia delle Entrate', 'casa', 'detrazione fino al 50% su max 96.000 €', '31/12/2026',
   'Detrazione IRPEF per interventi di recupero edilizio sull''abitazione principale, ripartita in 10 anni.',
   array['Proprietario o titolare di diritto reale','Pagamento con bonifico parlante'], array['Fatture','Bonifici parlanti'],
   'https://www.agenziaentrate.gov.it', 'Agenzia delle Entrate', false),
  ('Contributo Affitto Giovani (detrazione under 31)', 'Agenzia delle Entrate', 'casa', 'da 991,60 € a 2.000 € annui', 'in dichiarazione dei redditi',
   'Detrazione per giovani tra 20 e 31 anni che affittano l''abitazione principale.',
   array['Età tra 20 e 31 anni','Reddito fino a 15.493,71 €','Contratto registrato'], array['Contratto di locazione registrato'],
   'https://www.agenziaentrate.gov.it', 'Agenzia delle Entrate', false)
on conflict (norm_title) do nothing;

-- ============================================================
-- (Opzionale) Auto-creazione del profilo al signup
-- ============================================================
create or replace function public.handle_new_user ()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, email)
  values (new.id, coalesce (new.raw_user_meta_data ->> 'full_name', ''), coalesce (new.email, ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user ();
