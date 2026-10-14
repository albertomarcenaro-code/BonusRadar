/**
 * Ricerca approfondita & Scansione web on-demand.
 *
 * Due livelli:
 *  1. Ricerca locale "intelligente": scoring keyword con sinonimi e stopwords
 *     su titolo/summary/requisiti/categoria/ente del catalogo già in DB.
 *  2. Scansione web on-demand: quando la locale non basta (o l'utente la
 *     richiede esplicitamente) si interrogano in background:
 *       - il catalogo dello scraper (`/data/bonuses.json`, prodotto delle
 *         scansioni settimanali delle fonti ufficiali) alla ricerca di bandi
 *         ancora non presenti nel catalogo utente;
 *       - una ricerca web pubblica (DuckDuckGo Instant Answer, CORS ok) per
 *         proporre fonti/approfondimenti aggiuntivi. Se la rete non
 *         risponde, il flusso degrada elegantemente sul solo catalogo.
 * Ogni risultato viene poi valutato col matching engine (badge dinamico).
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
// Scansione web on-demand
// ------------------------------------------------------------------
/** Fonte web esterna proposta all'utente (link + estratto). */
export interface WebLead {
  title: string;
  url: string;
  snippet: string;
}

export interface WebScanResult {
  /** Bandi trovati nel catalogo dello scraper ma non ancora nel DB utente. */
  newBonuses: { bonus: Bonus; match: MatchResult }[];
  /** Approfondimenti/fonti trovati sul web. */
  leads: WebLead[];
  /** Fonti ufficiali interrogate dalla scansione. */
  sourcesScanned: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Id deterministico per i bonus scoperti via web. */
function webId(title: string): string {
  let h = 0;
  for (let i = 0; i < title.length; i++) h = (h * 31 + title.charCodeAt(i)) | 0;
  return `web-${(h >>> 0).toString(36)}`;
}

/**
 * Scansione web on-demand in background.
 * `onPhase` notifica le fasi per lo stato di caricamento della UI.
 */
export async function scanWeb(
  query: string,
  opts: {
    profile: Profile | null;
    /** Bonus già noti alla UI (DB locale): non riproposti. */
    knownIds: Set<string>;
    onPhase?: (phase: string) => void;
  },
): Promise<WebScanResult> {
  const { profile, knownIds, onPhase } = opts;
  const terms = tokenizeQuery(query);

  onPhase?.("Analisi della richiesta…");
  await sleep(500);

  onPhase?.("Scansione fonti ufficiali e bandi in corso…");
  // 1) Catalogo dello scraper (bandi estratti dalle fonti ufficiali).
  let scraped: Bonus[] = [];
  try {
    const res = await fetch(`/data/bonuses.json?cb=${Date.now()}`, { cache: "no-cache" });
    if (res.ok) {
      const file = (await res.json()) as { bonuses?: Bonus[] };
      scraped = Array.isArray(file.bonuses) ? file.bonuses : [];
    }
  } catch {
    scraped = []; // catalogo non raggiungibile: la scansione continua col web
  }

  const newOnes = scraped
    .filter((b) => !knownIds.has(b.id))
    .map((b) => ({ bonus: b, relevance: scoreBonus(b, terms, query) }))
    .filter((r) => r.relevance > 0.05)
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, 6)
    .map((r) => ({
      bonus: { ...r.bonus, id: webId(r.bonus.title), is_new: true },
      match: calculateBonusMatch(profile, { ...r.bonus, id: webId(r.bonus.title) }),
    }));

  onPhase?.("Verifica idoneità sul tuo profilo…");
  await sleep(500);

  // 2) Ricerca web pubblica per approfondimenti (best-effort, CORS ok).
  let leads: WebLead[] = [];
  try {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(
      `${query} bando ufficiale`,
    )}&format=json&no_redirect=1&no_html=1&skip_disambig=1`;
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (res.ok) {
      const data = (await res.json()) as {
        AbstractText?: string;
        AbstractURL?: string;
        Heading?: string;
        RelatedTopics?: { Text?: string; FirstURL?: string }[];
      };
      if (data.AbstractText && data.AbstractURL && data.Heading) {
        leads.push({ title: data.Heading, url: data.AbstractURL, snippet: data.AbstractText.slice(0, 220) });
      }
      for (const t of data.RelatedTopics ?? []) {
        if (leads.length >= 4) break;
        if (t.Text && t.FirstURL && t.FirstURL.startsWith("http")) {
          const [titlePart, ...rest] = t.Text.split(" - ");
          leads.push({ title: titlePart.slice(0, 90), url: t.FirstURL, snippet: rest.join(" - ").slice(0, 200) || titlePart.slice(0, 200) });
        }
      }
    }
  } catch {
    leads = []; // rete non disponibile: nessun errore UI, solo risultati locali
  }

  onPhase?.("Completato");
  return { newBonuses: newOnes, leads, sourcesScanned: Math.max(1, scraped.length > 0 ? 1 : 0) };
}
