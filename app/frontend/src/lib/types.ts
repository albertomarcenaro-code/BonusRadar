// Hand-written mirrors of backend/models/schemas.py — keep in sync.

export interface FamilyMember {
  name: string;
  relation: string;
  birth_date: string;
  fiscal_code: string;
  disabled: boolean;
  student: boolean;
  dependent: boolean;
}

export interface ProfileIn {
  full_name: string;
  fiscal_code: string;
  birth_date: string;
  birth_place: string;
  gender: string;
  address: string;
  city: string;
  province: string;
  region: string;
  postal_code: string;
  phone: string;
  email: string;
  iban: string;
  employment_status: string;
  /**
   * Pubblico con cui si partecipa ai bandi: `persona` (privato), `impresa`,
   * `artigiano`, `professionista`. Assente = privato.
   */
  type?: BonusTarget;
  annual_income: number | null;
  isee_value: number | null;
  housing: string;
  family_members: FamilyMember[];
  interests: string[];
  notes: string;
}

export interface Profile extends ProfileIn {
  updated_at: string;
}

export interface SourceIn {
  name: string;
  url: string;
}

export interface Source extends SourceIn {
  id: string;
  created_at: string;
  last_scanned_at: string | null;
  last_status: string;
  bonus_found: number;
}

export interface ScanStatus {
  running: boolean;
  phase: string;
  last_run_at: string | null;
  next_run_at: string | null;
  log: string[];
}

export type Eligibility = "eligible" | "maybe" | "not_eligible" | "unknown";

/**
 * Pubblico a cui è destinato un bando, o con cui l'utente partecipa.
 * In catalogo i valori storici al plurale (`artigiani`, `professionisti`) sono
 * accettati e normalizzati dal matching.
 */
export type BonusTarget = "persona" | "impresa" | "artigiano" | "professionista";

export interface Bonus {
  id: string;
  title: string;
  authority: string;
  category: string;
  amount: string;
  deadline: string;
  summary: string;
  requirements: string[];
  required_documents: string[];
  source_url: string;
  source_name: string;
  /**
   * A chi si rivolge il bando, dedotto dal testo e dalla fonte: `persona`,
   * `impresa`, `artigiano`, `professionista`. Assente = vale per tutti.
   */
  target?: BonusTarget[];
  /**
   * Stato del bando dedotto dalla scadenza: `open`, `closed` (escluso dal
   * catalogo) o `unknown` quando la fonte non indica un termine.
   */
  status?: "open" | "closed" | "unknown";
  /** Perché il gate qualità lo ha ammesso (o perché è in quarantena). */
  gate_reason?: string;
  /** Quando la pagina del bando è stata letta per riempire i campi. */
  detail_fetched_at?: string;
  /** Citazioni da cui provengono scadenza, importo, requisiti e documenti. */
  source_excerpts?: {
    deadline?: string;
    amount?: string;
    requirements?: string;
    documents?: string;
  };
  eligibility: Eligibility;
  eligibility_reason: string;
  discovered_at: string;
  is_new: boolean;
}

/**
 * Contatori del registro mostrati dalla landing.
 * Arrivano dalla RPC `catalog_stats()` (supabase_catalog_stats.sql), quindi
 * riflettono il database e non un file statico.
 */
export interface CatalogStats {
  /** Righe nella tabella `bonuses` (storico compreso: il contatore cresce). */
  bonuses: number;
  /** Di quelle, quante sono ancora in vigore (`is_active`). */
  active?: number;
  /** Fonti con `enabled = true` in `catalog_sources`. */
  sources: number;
}

/** File JSON generato dallo scraper (public/data/bonuses.json). */
/** Notizia o comunicato scartato dal gate qualità (non è un bando). */
export interface CatalogNews {
  title: string;
  source_name: string;
  source_url: string;
  reason: string;
}

/** Metriche di qualità del catalogo calcolate dallo scraper. */
export interface CatalogQuality {
  verified: number;
  open: number;
  unknown_deadline: number;
  expired: number;
  quarantine: number;
  news: number;
  fill: {
    deadline_pct: number;
    amount_pct: number;
    requirements_pct: number;
    documents_pct: number;
  };
  by_source: Record<string, number>;
}

/** Fonte monitorata, come la espone il catalogo pubblico (sezione "Fonti"). */
export interface CatalogSource {
  name: string;
  url: string;
  scope: string;
}

export interface BonusCatalogFile {
  generated_at: string;
  source: string;
  count: number;
  /** Elenco delle fonti scansionate in questa run: la landing lo usa per le
   *  schede e per i contatori, così segue il catalogo senza elenchi cablati. */
  sources?: CatalogSource[];
  /** Snapshot dei contatori al momento della scansione (fallback pubblico). */
  stats?: CatalogStats;
  bonuses: Bonus[];
  /** Schede che parlano di bandi ma senza dati verificabili: fuori catalogo. */
  quarantine?: Bonus[];
  /** Notizie/comunicati/atti scartati dal gate, conservati per audit. */
  news?: CatalogNews[];
  quality?: CatalogQuality;
}

export type DocStatus = "da_firmare" | "firmato" | "inviato" | "approvato";

export interface DocumentFile {
  name: string;
  kind: "pdf" | "docx";
}

export interface DocumentFolder {
  id: string;
  bonus_id: string;
  bonus_title: string;
  authority: string;
  created_at: string;
  status: DocStatus;
  files: DocumentFile[];
  attachments: string[];
  submission_notes: string;
}

export interface Dashboard {
  user_email: string;
  has_profile: boolean;
  profile_name: string;
  bonus_total: number;
  bonus_eligible: number;
  bonus_maybe: number;
  bonus_new: number;
  documents_total: number;
  documents_to_sign: number;
  sources_total: number;
  scan: ScanStatus;
  /** Data dell'ultima scansione dello scraper (dal catalogo JSON). */
  last_scan_at: string | null;
  /** Bonus salvati tra i preferiti dall'utente. */
  favorites_total: number;
  favorite_bonuses: Bonus[];
  /** Scadenze entro 60 giorni (solo date esplicite). */
  upcoming_deadlines: Bonus[];
}
