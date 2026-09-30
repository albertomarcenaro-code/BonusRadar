/**
 * Data layer BonusRadar — dual mode.
 *
 * - Supabase configurato (VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY):
 *     auth, letture/scritture Postgres via supabase-js, file su Storage bucket
 *     "documents" (signed URL per il download).
 * - Chiavi mancanti: fallback demo su localStorage con generazione documenti
 *     nel browser (print-to-PDF + DOCX). L'app resta pienamente navigabile.
 *
 * Gli errori vengono sempre sollevati come `DataError` con messaggio in
 * italiano già pronto per i toast.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { DOCUMENTS_BUCKET, attachmentObjectPath, documentObjectPath, isSupabaseConfigured, supabase } from "@/lib/supabase";
import { demoStore } from "@/lib/demoStore";
import { buildHtml, makeFileNames, openPrintWindow } from "@/lib/docgen";
import type { Bonus, BonusCatalogFile, Dashboard, DocStatus, DocumentFolder, Profile, ProfileIn, ScanStatus, Source } from "@/lib/types";
import type { DemoAttachment } from "@/lib/demoStore";

export class DataError extends Error {}

function requireSupabase(): SupabaseClient {
  if (!supabase) {
    throw new DataError(
      "Supabase non configurato: aggiungi VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY (Settings → Environment).",
    );
  }
  return supabase;
}

function dbx(err: { message: string } | null): void {
  if (err) throw new DataError(err.message);
}

/** Riga tabella bonuses → tipo usato dalla UI. */
type BonusRow = Omit<Bonus, "discovered_at"> & { created_at: string };
function mapBonus(b: BonusRow): Bonus {
  return { ...b, discovered_at: b.created_at };
}

/** Riga document_folders → tipo usato dalla UI (storage_path → URL al volo). */
type DocRow = {
  id: string;
  bonus_id: string | null;
  bonus_title: string;
  authority: string;
  created_at: string;
  status: DocStatus;
  files: { name: string; kind: "pdf" | "docx"; storage_path?: string }[];
  attachments: string[];
  submission_notes: string;
};
function mapDoc(d: DocRow): DocumentFolder {
  return { ...d, bonus_id: d.bonus_id ?? "", files: d.files.map(({ name, kind }) => ({ name, kind })) };
}

// ============================================================
// Auth
// ============================================================
export const auth = {
  async getUser(): Promise<{ id: string; email: string } | null> {
    if (!isSupabaseConfigured) return demoStore.getUser();
    const { data, error } = await requireSupabase().auth.getUser();
    if (error) return null;
    return data.user ? { id: data.user.id, email: data.user.email ?? "" } : null;
  },
  async signIn(email: string, password: string): Promise<{ id: string; email: string }> {
    if (!isSupabaseConfigured) return demoStore.signIn(email);
    const { data, error } = await requireSupabase().auth.signInWithPassword({ email, password });
    dbx(error);
    if (!data.user) throw new DataError("Credenziali non valide");
    return { id: data.user.id, email: data.user.email ?? email };
  },
  async signUp(email: string, password: string): Promise<{ id: string; email: string }> {
    if (!isSupabaseConfigured) return demoStore.signUp(email);
    const { data, error } = await requireSupabase().auth.signUp({ email, password });
    dbx(error);
    if (!data.user) throw new DataError("Registrazione non riuscita");
    return { id: data.user.id, email: data.user.email ?? email };
  },
  async signOut(): Promise<void> {
    if (!isSupabaseConfigured) return demoStore.signOut();
    dbx((await requireSupabase().auth.signOut()).error);
  },
};

// ============================================================
// Profile
// ============================================================
export async function getProfile(): Promise<Profile | null> {
  if (!isSupabaseConfigured) return demoStore.getProfile();
  const user = await auth.getUser();
  if (!user) return null;
  const { data, error } = await requireSupabase().from("profiles").select("*").eq("id", user.id).maybeSingle();
  dbx(error);
  return (data as Profile | null) ?? null;
}

export async function saveProfile(p: ProfileIn): Promise<Profile> {
  if (!isSupabaseConfigured) return demoStore.saveProfile(p);
  const user = await auth.getUser();
  if (!user) throw new DataError("Accedi per salvare il profilo");
  const { data, error } = await requireSupabase()
    .from("profiles")
    .upsert({ ...p, id: user.id, email: p.email || user.email, updated_at: new Date().toISOString() })
    .select()
    .single();
  dbx(error);
  return data as Profile;
}

export async function recordQuestionnaire(p: ProfileIn): Promise<void> {
  if (!isSupabaseConfigured) return; // demo: il profilo è già lo storico
  const user = await auth.getUser();
  if (!user) return;
  await requireSupabase()
    .from("questionnaires")
    .insert({ user_id: user.id, status: "completed", answers: p as unknown as Record<string, unknown> });
}

// ============================================================
// Bonuses + favorites
// ============================================================
export async function listBonuses(): Promise<Bonus[]> {
  if (!isSupabaseConfigured) return demoStore.bonuses(); // demo: catalogo scraper se presente, altrimenti statico
  const { data, error } = await requireSupabase()
    .from("bonuses")
    .select("*")
    .order("created_at", { ascending: true });
  dbx(error);
  return ((data ?? []) as BonusRow[]).map(mapBonus);
}

/**
 * Catalogo JSON generato dallo scraper (public/data/bonuses.json).
 * Raggiungibile anche da utenti NON autenticati (la RLS non permette loro
 * di leggere la tabella bonuses): è la fonte pubblica dell'ultima scansione.
 */
export async function fetchScraperCatalog(): Promise<BonusCatalogFile | null> {
  try {
    const res = await fetch("/data/bonuses.json", { cache: "no-cache" });
    if (!res.ok) return null;
    const file = (await res.json()) as BonusCatalogFile;
    return Array.isArray(file.bonuses) ? file : null;
  } catch {
    return null; // file assente (es. deploy senza catalogo): nessun errore UI
  }
}

export async function listFavorites(): Promise<string[]> {
  if (!isSupabaseConfigured) return demoStore.getFavorites().map((f) => f.bonus_id);
  const user = await auth.getUser();
  if (!user) return [];
  const { data, error } = await requireSupabase().from("user_bonuses").select("bonus_id").eq("user_id", user.id);
  dbx(error);
  return ((data ?? []) as { bonus_id: string }[]).map((r) => r.bonus_id);
}

export async function toggleFavorite(bonusId: string): Promise<boolean> {
  if (!isSupabaseConfigured) return demoStore.toggleFavorite(bonusId);
  const sb = requireSupabase();
  const user = await auth.getUser();
  if (!user) throw new DataError("Accedi per salvare i preferiti");
  const { data: existing } = await sb
    .from("user_bonuses")
    .select("id")
    .eq("user_id", user.id)
    .eq("bonus_id", bonusId)
    .maybeSingle();
  if (existing) {
    dbx((await sb.from("user_bonuses").delete().eq("id", existing.id)).error);
    return false;
  }
  dbx((await sb.from("user_bonuses").insert({ user_id: user.id, bonus_id: bonusId })).error);
  return true;
}

// ============================================================
// Documents (Supabase Storage bucket "documents")
// ============================================================
export async function listDocuments(): Promise<DocumentFolder[]> {
  if (!isSupabaseConfigured) return demoStore.getDocuments();
  const user = await auth.getUser();
  if (!user) return [];
  const { data, error } = await requireSupabase()
    .from("document_folders")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });
  dbx(error);
  return ((data ?? []) as DocRow[]).map(mapDoc);
}

/**
 * Genera e salva la pratica per un bonus.
 * - Supabase: salva i metadati in document_folders; i PDF/DOCX veri sono
 *   prodotti dal backend → per ora genera nel browser e carica il DOCX su Storage.
 * - Demo: registra la cartella in localStorage, download al volo.
 */
export async function generateDocuments(bonus: Bonus, profile: Profile): Promise<DocumentFolder> {
  const html = buildHtml(bonus, profile);
  const { files } = makeFileNames(bonus.title);

  if (!isSupabaseConfigured) {
    const doc: DocumentFolder = {
      id: crypto.randomUUID(),
      bonus_id: bonus.id,
      bonus_title: bonus.title,
      authority: bonus.authority,
      created_at: new Date().toISOString(),
      status: "da_firmare",
      files,
      attachments: bonus.required_documents,
      submission_notes: `Presenta la domanda sul portale ${bonus.authority} con SPID/CIE entro: ${
        bonus.deadline || "scadenza da verificare"
      }.`,
    };
    demoStore.addDocument(doc);
    openPrintWindow(html); // l'utente salva il PDF dalla finestra di stampa
    return doc;
  }

  const sb = requireSupabase();
  const user = await auth.getUser();
  if (!user) throw new DataError("Accedi per generare i documenti");

  const { data: folder, error } = await sb
    .from("document_folders")
    .insert({
      user_id: user.id,
      bonus_id: bonus.id,
      bonus_title: bonus.title,
      authority: bonus.authority,
      files: files.map((f) => ({ ...f, storage_path: documentObjectPath(user.id, "", f.name) })),
      attachments: bonus.required_documents,
      submission_notes: `Presenta la domanda sul portale ${bonus.authority} con SPID/CIE entro: ${
        bonus.deadline || "scadenza da verificare"
      }.`,
    })
    .select()
    .single();
  dbx(error);

  // Aggiorna i path con l'id reale della cartella e carica il DOCX su Storage
  const docx = files.find((f) => f.kind === "docx")!;
  const path = documentObjectPath(user.id, folder.id, docx.name);
  const blob = new Blob(["\ufeff", html], { type: "application/msword" });
  dbx(
    (
      await sb.storage
        .from(DOCUMENTS_BUCKET)
        .upload(path, blob, { contentType: "application/msword", upsert: true })
    ).error,
  );
  await sb.from("document_folders").update({ files: files.map((f) => ({ ...f, storage_path: documentObjectPath(user.id, folder.id, f.name) })) }).eq("id", folder.id);

  openPrintWindow(html);
  return mapDoc({ ...folder, files: files.map((f) => ({ ...f, storage_path: documentObjectPath(user.id, folder.id, f.name) })) });
}

/** Restituisce un URL firmato (Supabase) o null in demo. */
export async function getFileUrl(doc: DocumentFolder, kind: "pdf" | "docx"): Promise<string | null> {
  if (!isSupabaseConfigured) return null; // in demo il download avviene alla generazione
  const f = doc.files.find((x) => x.kind === kind);
  if (!f) return null;
  const user = await auth.getUser();
  if (!user) return null;
  const sb = requireSupabase();
  const path = documentObjectPath(user.id, doc.id, f.name);
  const { data, error } = await sb.storage.from(DOCUMENTS_BUCKET).createSignedUrl(path, 300);
  dbx(error);
  return data?.signedUrl ?? null;
}

export async function updateDocumentStatus(id: string, status: DocStatus): Promise<DocumentFolder> {
  if (!isSupabaseConfigured) {
    const updated = demoStore.updateDocumentStatus(id, status);
    if (!updated) throw new DataError("Cartella non trovata");
    return updated;
  }
  const { data, error } = await requireSupabase()
    .from("document_folders")
    .update({ status })
    .eq("id", id)
    .select()
    .single();
  dbx(error);
  return mapDoc(data as DocRow);
}

export async function deleteDocument(id: string): Promise<void> {
  if (!isSupabaseConfigured) return demoStore.deleteDocument(id);
  const sb = requireSupabase();
  const user = await auth.getUser();
  if (user) {
    // best-effort: rimuove i file dal bucket
    await sb.storage.from(DOCUMENTS_BUCKET).remove([
      `${user.id}/${id}/`,
    ]);
  }
  dbx((await sb.from("document_folders").delete().eq("id", id)).error);
}

// ============================================================
// Allegati personali (PDF ISEE, carta d'identità, …)
// ============================================================
export type UserAttachment = DemoAttachment;

export async function listAttachments(): Promise<UserAttachment[]> {
  if (!isSupabaseConfigured) return demoStore.getAttachments();
  const user = await auth.getUser();
  if (!user) return [];
  const { data, error } = await requireSupabase().storage
    .from(DOCUMENTS_BUCKET)
    .list("allegati", { search: "" });
  // Con la policy foldername[1]=uid la listing corretta è nel percorso "<uid>/allegati".
  if (error) {
    const alt = await requireSupabase().storage.from(DOCUMENTS_BUCKET).list(`${user.id}/allegati`, { search: "" });
    if (alt.error) return [];
    return mapAttachmentEntries(alt.data ?? []);
  }
  return mapAttachmentEntries(data ?? []);
}

function mapAttachmentEntries(entries: { name: string; id?: string | null; created_at?: string | null; metadata?: { size?: number } | Record<string, unknown> | null }[]): UserAttachment[] {
  return entries
    .filter((e) => e.name && e.name !== ".emptyFolderPlaceholder")
    .map((e) => ({
      id: e.id ?? e.name,
      name: e.name,
      label: "",
      size: typeof e.metadata?.size === "number" ? e.metadata.size : 0,
      created_at: e.created_at ?? new Date().toISOString(),
    }));
}

export async function uploadAttachment(file: File, label: string): Promise<UserAttachment> {
  if (file.type && file.type !== "application/pdf") {
    throw new DataError("Sono ammessi solo file PDF.");
  }
  if (file.size > 10 * 1024 * 1024) {
    throw new DataError("Il file supera il limite di 10 MB.");
  }
  if (!isSupabaseConfigured) {
    const att: UserAttachment = {
      id: crypto.randomUUID(),
      name: file.name,
      label,
      size: file.size,
      created_at: new Date().toISOString(),
    };
    demoStore.addAttachment(att);
    return att;
  }
  const user = await auth.getUser();
  if (!user) throw new DataError("Accedi per caricare gli allegati");
  const path = attachmentObjectPath(user.id, file.name);
  const { error } = await requireSupabase()
    .storage
    .from(DOCUMENTS_BUCKET)
    .upload(path, file, { contentType: "application/pdf", upsert: true });
  dbx(error);
  return { id: path, name: file.name, label, size: file.size, created_at: new Date().toISOString() };
}

/** URL firmato per aprire un allegato caricato. */
export async function getAttachmentUrl(a: UserAttachment): Promise<string | null> {
  if (!isSupabaseConfigured) return null;
  const user = await auth.getUser();
  if (!user) return null;
  const path = a.id.includes("/") ? a.id : attachmentObjectPath(user.id, a.name);
  const { data, error } = await requireSupabase().storage.from(DOCUMENTS_BUCKET).createSignedUrl(path, 300);
  dbx(error);
  return data?.signedUrl ?? null;
}

export async function deleteAttachment(a: UserAttachment): Promise<void> {
  if (!isSupabaseConfigured) return demoStore.removeAttachment(a.id);
  const user = await auth.getUser();
  if (!user) throw new DataError("Accedi per gestire gli allegati");
  const path = a.id.includes("/") ? a.id : attachmentObjectPath(user.id, a.name);
  const { error } = await requireSupabase().storage.from(DOCUMENTS_BUCKET).remove([path]);
  dbx(error);
}

// ============================================================
// Sources & scan — richiedono il backend AI; in demo restano stub chiari
// ============================================================
export async function listSources(): Promise<Source[]> {
  if (!isSupabaseConfigured) return demoStore.sources();
  const user = await auth.getUser();
  if (!user) return [];
  const { data, error } = await requireSupabase()
    .from("sources")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });
  dbx(error);
  return (data ?? []) as Source[];
}

export const scan = {
  async status(): Promise<ScanStatus> {
    return { running: false, phase: isSupabaseConfigured ? "Scansione disponibile a breve" : "Modalità demo: scansione AI non attiva", last_run_at: null, next_run_at: null, log: [] };
  },
};

// ============================================================
// Dashboard aggregata
// ============================================================
export async function getDashboard(): Promise<Dashboard> {
  const [user, profile, bonuses, catalog, docs, favorites] = await Promise.all([
    auth.getUser(),
    getProfile().catch(() => null),
    listBonuses().catch(() => []),
    fetchScraperCatalog(),
    listDocuments().catch(() => []),
    listFavorites().catch(() => []),
  ]);
  const favoriteSet = new Set(favorites);
  const favoritesList = bonuses.filter((b) => favoriteSet.has(b.id));

  // Scadenze imminenti: solo bonus con una data esplicita (entro 60 giorni).
  const now = Date.now();
  const upcoming = bonuses
    .filter((b) => {
      const parsed = parseItDate(b.deadline);
      return parsed !== null && parsed >= now && parsed <= now + 60 * 86_400_000;
    })
    .sort((a, b) => (parseItDate(a.deadline) ?? 0) - (parseItDate(b.deadline) ?? 0))
    .slice(0, 5);

  return {
    user_email: user?.email ?? "",
    has_profile: Boolean(profile),
    profile_name: profile?.full_name ?? "",
    bonus_total: bonuses.length,
    bonus_eligible: bonuses.filter((b) => b.eligibility === "eligible").length,
    bonus_maybe: bonuses.filter((b) => b.eligibility === "maybe").length,
    bonus_new: bonuses.filter((b) => b.is_new).length,
    documents_total: docs.length,
    documents_to_sign: docs.filter((d) => d.status === "da_firmare").length,
    sources_total: 0,
    scan: await scan.status(),
    last_scan_at: catalog?.generated_at ?? null,
    favorites_total: favoritesList.length,
    favorite_bonuses: favoritesList.slice(0, 5),
    upcoming_deadlines: upcoming,
  };
}

/** Parse di date come "15/10/2026", "15-10-2026", "15 ottobre 2026" (in iso). */
function parseItDate(s: string): number | null {
  if (!s) return null;
  const m = s.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (m) {
    const y = Number(m[3]) < 100 ? 2000 + Number(m[3]) : Number(m[3]);
    const t = new Date(y, Number(m[2]) - 1, Number(m[1])).getTime();
    return Number.isNaN(t) ? null : t;
  }
  const mesi = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];
  const m2 = s.toLowerCase().match(/(\d{1,2})\s+([a-zà-ù]+)\s+(\d{4})/);
  if (m2) {
    const mi = mesi.findIndex((me) => me.startsWith(m2[2].slice(0, 4)));
    if (mi >= 0) {
      const t = new Date(Number(m2[3]), mi, Number(m2[1])).getTime();
      return Number.isNaN(t) ? null : t;
    }
  }
  const t = new Date(s).getTime();
  return Number.isNaN(t) ? null : t;
}
