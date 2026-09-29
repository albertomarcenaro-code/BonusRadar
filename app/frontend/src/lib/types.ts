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
  eligibility: Eligibility;
  eligibility_reason: string;
  discovered_at: string;
  is_new: boolean;
}

/** File JSON generato dallo scraper (public/data/bonuses.json). */
export interface BonusCatalogFile {
  generated_at: string;
  source: string;
  count: number;
  bonuses: Bonus[];
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
}
