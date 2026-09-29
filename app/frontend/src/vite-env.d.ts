/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** URL del progetto Supabase, es. https://abcd1234.supabase.co */
  readonly VITE_SUPABASE_URL?: string;
  /** Chiave anon pubblica (RLS protegge i dati) */
  readonly VITE_SUPABASE_ANON_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
