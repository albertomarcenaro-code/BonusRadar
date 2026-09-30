/**
 * Archivio demo locale (localStorage) — fallback quando le chiavi Supabase
 * non sono configurate. Stessa forma dati delle tabelle Supabase, così il
 * passaggio a Supabase è trasparente per l'interfaccia.
 */
import type { Bonus, DocStatus, DocumentFolder, Profile, ProfileIn, Source } from "@/lib/types";
import { DEMO_BONUSES } from "@/lib/demoData";

const KEY = "bonusradar.demo.v1";

export interface DemoUser {
  id: string;
  email: string;
}

/** Rappresentazione locale di un allegato caricato dall'utente. */
export interface DemoAttachment {
  id: string;
  name: string;
  label: string;
  size: number;
  created_at: string;
}

export interface DemoState {
  user: DemoUser | null;
  profile: Profile | null;
  favorites: { bonus_id: string; note: string }[];
  documents: DocumentFolder[];
  attachments: { id: string; name: string; label: string; size: number; created_at: string }[];
}

function read(): DemoState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...empty(), ...JSON.parse(raw) };
  } catch {
    // storage non disponibile → stato fresco
  }
  return empty();
}

function empty(): DemoState {
  return { user: null, profile: null, favorites: [], documents: [], attachments: [] };
}

function write(s: DemoState): void {
  localStorage.setItem(KEY, JSON.stringify(s));
}

export function resetDemo(): void {
  localStorage.removeItem(KEY);
}

// Cache del catalogo JSON generato dallo scraper (null = non disponibile).
let scraperCatalogCache: Bonus[] | null = null;

async function loadScraperCatalog(): Promise<Bonus[] | null> {
  try {
    const res = await fetch("/data/bonuses.json", { cache: "no-cache" });
    if (!res.ok) return null;
    const file = (await res.json()) as { bonuses?: Bonus[] };
    return Array.isArray(file.bonuses) && file.bonuses.length > 0 ? file.bonuses : null;
  } catch {
    return null; // file assente: si ricade sul catalogo demo
  }
}

export const demoStore = {
  getUser(): DemoUser | null {
    return read().user;
  },
  signIn(email: string): DemoUser {
    const s = read();
    const user = { id: s.user?.id ?? crypto.randomUUID(), email };
    write({ ...s, user });
    return user;
  },
  signUp(email: string): DemoUser {
    return this.signIn(email);
  },
  signOut(): void {
    const s = read();
    write({ ...s, user: null });
  },

  getProfile(): Profile | null {
    return read().profile;
  },
  saveProfile(p: ProfileIn): Profile {
    const s = read();
    const profile: Profile = { ...p, updated_at: new Date().toISOString() };
    write({ ...s, profile });
    return profile;
  },

  getFavorites(): { bonus_id: string; note: string }[] {
    return read().favorites;
  },
  toggleFavorite(bonusId: string): boolean {
    const s = read();
    const has = s.favorites.some((f) => f.bonus_id === bonusId);
    const favorites = has ? s.favorites.filter((f) => f.bonus_id !== bonusId) : [...s.favorites, { bonus_id: bonusId, note: "" }];
    write({ ...s, favorites });
    return !has;
  },

  getDocuments(): DocumentFolder[] {
    return read().documents;
  },
  getDocument(id: string): DocumentFolder | null {
    return read().documents.find((d) => d.id === id) ?? null;
  },
  addDocument(doc: DocumentFolder): void {
    const s = read();
    write({ ...s, documents: [doc, ...s.documents] });
  },
  updateDocumentStatus(id: string, status: DocStatus): DocumentFolder | null {
    const s = read();
    let updated: DocumentFolder | null = null;
    const documents = s.documents.map((d) => {
      if (d.id !== id) return d;
      updated = { ...d, status };
      return updated;
    });
    write({ ...s, documents });
    return updated;
  },
  deleteDocument(id: string): void {
    const s = read();
    write({ ...s, documents: s.documents.filter((d) => d.id !== id) });
  },

  getAttachments(): DemoAttachment[] {
    return read().attachments;
  },
  addAttachment(a: DemoAttachment): void {
    const s = read();
    write({ ...s, attachments: [a, ...s.attachments] });
  },
  removeAttachment(id: string): void {
    const s = read();
    write({ ...s, attachments: s.attachments.filter((a) => a.id !== id) });
  },

  async bonuses(): Promise<Bonus[]> {
    // Priorità al catalogo generato dallo scraper (public/data/bonuses.json):
    // in demo è l'unico modo per mostrare i bonus realmente estratti dalle
    // fonti ufficiali. In mancanza si usa il catalogo statico.
    if (!scraperCatalogCache) scraperCatalogCache = await loadScraperCatalog();
    return scraperCatalogCache ?? DEMO_BONUSES;
  },
  sources(): Source[] {
    return [];
  },
};
