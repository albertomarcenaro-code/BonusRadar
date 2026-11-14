/**
 * Ricerca nel catalogo e negli approfondimenti locali.
 *
 * Due livelli, entrambi sui dati già disponibili nel progetto:
 *  1. Ricerca locale "intelligente": scoring keyword con sinonimi e stopwords
 *     su titolo/summary/requisiti/categoria/ente del catalogo già in DB.
 *  2. Ricerca nel catalogo aggiornato: legge `/data/bonuses.json`, prodotto
 *     dalle scansioni settimanali dello scraper Python sulle fonti ufficiali,
 *     e propone i bandi non ancora presenti nel catalogo dell'utente.
 * Nessuna delle due interroga il web al momento della richiesta: il browser
 * non può leggere i portali istituzionali (CORS) e non esiste un endpoint
 * server che lo faccia.
 */
import { calculateBonusMatch, type MatchResult } from "@/lib/matching";
import type { Bonus, Profile } from "@/lib/types";

// ------------------------------------------------------------------
// Query → termini (tokenizzazione + sinonimi + stopwords)
// ------------------------------------------------------------------
const STOPWORDS = new Set([
  "di", "del", "della", "dei", "delle", "e", "il", "la", "lo", "gli", "le", "un", "una",
  "per", "che", "con", "su", "al", "allo", "alla", "ai", "alle", "in", "a", "da", "o",
  "bonus", "bando", "bandi", "incentivo", "incentivi", "contributo", "aiuto", "aiuti",
]);

/** Sinonimi/domini: da una parola chiave si espande a famiglie correlate. */
const SYNONYMS: Record<string, string[]> = {
  "pannelli": ["fotovoltaico", "solare", "energia", "photovoltaico", "impianto"],
  "solare": ["fotovoltaico", "pannelli", "energia"],
  "fotovoltaico": ["solare", "pannelli", "energia", "fotovoltaici"],
  ristrutturazione: ["ristrutturazioni", "edilizia", "recupero", "edilizio", "casa", "detrazione"],
  ristrutturazioni: ["ristrutturazione", "edilizia", "recupero", "edilizio"],
  casa: ["abitazione", "edilizia", "affitto", "mutuo", "ristrutturazione"],
  affitto: ["locazione", "locazioni", "canone", "contratto", "giovani"],
  nido: ["asilo", "bambini", "infanzia"],
  asilo: ["nido", "bambini", "infanzia"],
  psicologo: ["psicologia", "psicoterapia", "benessere", "salute"],
  disoccupazione: ["disoccupato", "disoccupati", "naspi", "occupazione", "lavoro"],
  lavoro: ["occupazione", "impiego", "dipendente", "autonomo"],
  auto: ["veicolo", "veicoli", "elettrica", "mobilità", "motorizzazioni"],
  elettrica: ["elettrico", "veicoli", "mobilità", "auto"],
  mobilita: ["mobilità", "trasporti", "bici", "biciclette", "elettrica"],
  famiglia: ["figli", "nucleo", "minori", "figli"],
  figli: ["figli", "minori", "famiglia", "nido"],
  studente: ["studio", "università", "borsa", "tasse", "studenti"],
  universita: ["studenti", "studio", "tasse", "borsa", "canone"],
  imprese: ["impresa", "startup", "pmi", "ditta", "commercio"],
  pannelli_solari: ["fotovoltaico", "solare", "energia", "pannelli"],
};

/** Tokenizza la query: minuscolo, no punteggiatura, no stopwords, max 12 termini. */
export function tokenizeQuery(query: string): string[] {
  const raw = query
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
  const terms = new Set(raw);
  for (const t of raw) {
    for (const s of SYNONYMS[t] ?? []) terms.add(s);
    // radice troncata: "ristrutturazioni" → "ristrutturazion"
    if (t.length > 6) terms.add(t.slice(0, -2));
  }
  return [...terms].slice(0, 24);
}

// ------------------------------------------------------------------
// Scoring locale
// ------------------------------------------------------------------
/** Punteggio di rilevanza 0..1 di un bonus rispetto ai termini della query. */
export function scoreBonus(bonus: Bonus, terms: string[], rawQuery: string): number {
  if (terms.length === 0) return 0;
  const title = bonus.title.toLowerCase();
  const summary = bonus.summary.toLowerCase();
  const reqs = bonus.requirements.join(" ").toLowerCase();
  const meta = `${bonus.category} ${bonus.authority}`.toLowerCase();
  const q = rawQuery.toLowerCase().trim();

  let hits = 0;
  let weight = 0;
  // la frase completa nel titolo vale molto
  if (q.length > 6 && title.includes(q)) {
    hits += 2;
    weight += 2;
  }
  for (const t of terms) {
    weight += 1;
    if (title.includes(t)) hits += 1.5;
    else if (summary.includes(t)) hits += 1;
    else if (reqs.includes(t)) hits += 0.7;
    else if (meta.includes(t)) hits += 0.5;
  }
  return Math.min(1, hits / Math.max(1, weight));
}

/** Filtra e ordina il catalogo locale per rilevanza decrescente. */
export function searchLocalBonuses(bonuses: Bonus[], query: string): { bonus: Bonus; relevance: number }[] {
  const q = query.trim();
  if (!q) return [];
  const terms = tokenizeQuery(q);
  return bonuses
    .map((b) => ({ bonus: b, relevance: scoreBonus(b, terms, q) }))
    .filter((r) => r.relevance > 0)
    .sort((a, b) => b.relevance - a.relevance);
}

// ------------------------------------------------------------------
// Ricerca nel catalogo aggiornato
//
// Non è una scansione del web: il browser non può interrogare i portali
// istituzionali (CORS) e il sito non ha un endpoint server che lo faccia.
// Si legge l'ultimo catalogo prodotto dallo scraper settimanale, si
// scartano i bandi già noti e si ordina il resto per rilevanza. La data
// reale del catalogo torna alla UI, che la mostra all'utente.
// ------------------------------------------------------------------

/** Catalogo statico prodotto da `scripts/scraper.py` (GitHub Actions). */
const CATALOG_URL = "/data/bonuses.json";

export interface WebScanResult {
  /** Bandi nel catalogo aggiornato non ancora presenti nel DB dell'utente. */
  newBonuses: { bonus: Bonus; match: MatchResult }[];
  /** Data di generazione del catalogo letto (ISO), null se non disponibile. */
  catalogGeneratedAt: string | null;
}

/** Id deterministico per i bonus letti dal catalogo dello scraper. */
function webId(title: string): string {
  let h = 0;
  for (let i = 0; i < title.length; i++) h = (h * 31 + title.charCodeAt(i)) | 0;
  return `web-${(h >>> 0).toString(36)}`;
}

/**
 * Cerca la query nell'ultimo catalogo dello scraper, escludendo i bandi già
 * presenti nel catalogo dell'utente e ordinando per rilevanza.
 */
export async function scanCatalog(
  query: string,
  opts: { profile: Profile | null; knownIds: Set<string> },
): Promise<WebScanResult> {
  const { profile, knownIds } = opts;
  const terms = tokenizeQuery(query);

  let scraped: Bonus[] = [];
  let catalogGeneratedAt: string | null = null;
  try {
    const res = await fetch(`${CATALOG_URL}?cb=${Date.now()}`, { cache: "no-cache" });
    if (res.ok) {
      const file = (await res.json()) as { bonuses?: Bonus[]; generated_at?: string };
      scraped = Array.isArray(file.bonuses) ? file.bonuses : [];
      catalogGeneratedAt = typeof file.generated_at === "string" ? file.generated_at : null;
    }
  } catch {
    scraped = []; // catalogo non raggiungibile: nessun risultato, nessun errore
  }

  const newBonuses = scraped
    .filter((b) => !knownIds.has(b.id))
    .map((b) => ({ bonus: b, relevance: scoreBonus(b, terms, query) }))
    .filter((r) => r.relevance > 0.05)
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, 6)
    .map((r) => {
      const bonus = { ...r.bonus, id: webId(r.bonus.title), is_new: true };
      return { bonus, match: calculateBonusMatch(profile, bonus) };
    });

  return { newBonuses, catalogGeneratedAt };
}
