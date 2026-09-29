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
import { DOCUMENTS_BUCKET, documentObjectPath, isSupabaseConfigured, supabase } from "@/lib/supabase";
import { demoStore } from "@/lib/demoStore";
import { buildHtml, makeFileNames, openPrintWindow } from "@/lib/docgen";
import type { Bonus, Dashboard, DocStatus, DocumentFolder, Profile, ProfileIn, ScanStatus, Source } from "@/lib/types";

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

  // Questionnaire: registra un audit della compilazione (best-effort)
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
  if (!isSupabaseConfigured) return demoStore.bonuses();
  const { data, error } = await requireSupabase()
    .from("bonuses")
    .select("*")
    .order("created_at", { ascending: true });
  dbx(error);
  return ((data ?? []) as BonusRow[]).map(mapBonus);
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
  const [, profile, bonuses, docs] = await Promise.all([auth.getUser(), getProfile().catch(() => null), listBonuses().catch(() => []), listDocuments().catch(() => [])]);
  return {
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
  };
}
