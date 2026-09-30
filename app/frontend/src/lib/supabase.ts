import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Client Supabase per BonusRadar Italia.
 *
 * Letto da import.meta.env (prefisso VITE_ richiesto da Vite):
 *   - VITE_SUPABASE_URL      → URL del progetto (Settings → API)
 *   - VITE_SUPABASE_ANON_KEY → chiave anon (pubblica, protetta da RLS)
 *
 * Se le variabili non sono impostate l'app resta pienamente utilizzabile in
 * "modalità demo": il data layer (src/lib/api.ts) serve i dati da un archivio
 * locale simulato e i download generano i file al volo nel browser.
 */
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isSupabaseConfigured = Boolean(url && anonKey);

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url as string, anonKey as string, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;

/** Bucket Supabase Storage per le domande precompilate (PDF/DOCX). */
export const DOCUMENTS_BUCKET = "documents";

/**
 * URL pubblico di un file nel bucket `documents`.
 * Il bucket è privato: il download passa da createSignedUrl (see api.ts).
 */
export function documentObjectPath(userId: string, folderId: string, fileName: string): string {
  return `${userId}/${folderId}/${fileName}`;
}

/**
 * Percorso degli allegati personali (PDF ISEE, carta d'identità, …).
 * La policy RLS del bucket limita l'accesso alla prima cartella = auth.uid(),
 * quindi ogni file vive in `<uid>/allegati/`.
 */
export function attachmentObjectPath(userId: string, fileName: string): string {
  return `${userId}/allegati/${fileName}`;
}
