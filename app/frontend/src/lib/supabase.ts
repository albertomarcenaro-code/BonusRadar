import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Client Supabase per BonusRadar.
 *
 * Letto da import.meta.env (prefisso VITE_ richiesto da Vite):
 *   - VITE_SUPABASE_URL      → URL del progetto (Settings → API)
 *   - VITE_SUPABASE_ANON_KEY → chiave anon (pubblica, protetta da RLS)
 *
 * Se le variabili non sono impostate l'app resta pienamente utilizzabile in
 * "modalità demo": il data layer (src/lib/api.ts) serve i dati da un archivio
 * locale simulato e i download generano i file al volo nel browser.
 */
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/**
 * Origine del progetto Supabase, senza percorso.
 *
 * supabase-js concatena i propri percorsi all'URL configurato: se nel file
 * d'ambiente finisce un endpoint completo (es. `https://<ref>.supabase.co/rest/v1`,
 * il "REST URL" mostrato dal dashboard) le chiamate diventano
 * `<...>/rest/v1/auth/v1/token` e Supabase risponde 404, lasciando il pulsante
 * di accesso in attesa senza alcun errore visibile. Qui si tiene la sola
 * origine, così una URL incollata male non rompe più il login.
 */
function projectOrigin(value?: string): string | undefined {
  if (!value) return undefined;
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return undefined;
    return parsed.origin;
  } catch {
    return undefined;
  }
}

const url = projectOrigin(import.meta.env.VITE_SUPABASE_URL as string | undefined);

export const isSupabaseConfigured = Boolean(url && anonKey);

// Nota: la validazione della forma dell'URL serve perché una build senza le
// variabili d'ambiente (vedi il build command di deploy) non deve mai arrivare
// a createClient("…") che esploderebbe a startup: si entra in demo mode.

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
