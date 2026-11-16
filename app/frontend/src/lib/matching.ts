/**
 * Motore di Matching Automatico profilo ↔ catalogo bonus.
 *
 * Analizza i requisiti testuali del bando (requirements + title/summary) e li
 * confronta con i dati del profilo utente per produrre:
 *   - uno stato: "eligible" (IDONEO), "maybe" (VERIFICA DETTAGLI),
 *     "not_eligible" (NON IDONEO), "unknown" (profilo incompleto / nessun criterio);
 *   - una percentuale di affinità 0–100;
 *   - il dettaglio delle verifiche superate/da verificare/fallite.
 *
 * Nessuna dipendenza esterna: solo regex e aritmetica, così è testabile e
 * riutilizzabile sia lato client che in eventuali job futuri.
 *
 * Criteri coperti:
 *   ISEE · residenza (comune o regione) · età del richiedente · età dei figli
 *   (asilo nido 0–3 anni, figli minorenni) · numero di figli / nucleo ·
 *   condizione lavorativa · disabilità · termine di scadenza.
 */
import type { Bonus, FamilyMember, Profile } from "@/lib/types";

export type MatchStatus = "eligible" | "maybe" | "not_eligible" | "unknown";

export interface MatchCheck {
  /** Etichetta mostrata nella UI (es. "ISEE ok"). */
  label: string;
  /** Stato della singola verifica. */
  state: "ok" | "warn" | "fail";
}

export interface MatchResult {
  status: MatchStatus;
  /** Percentuale di affinità 0–100 calcolata sui criteri valutabili. */
  score: number;
  checks: MatchCheck[];
}

// ---------------------------------------------------------------
// Utilità comuni
// ---------------------------------------------------------------
/** Testo su cui cercare i requisiti economici/temporali. */
function bonusText(bonus: Bonus): string {
  return [...bonus.requirements, bonus.title, bonus.summary].join(" ");
}

/** Testo dei soli requisiti dichiarati + titolo (meno rumoroso del sommario). */
function strictText(bonus: Bonus): string {
  return [...bonus.requirements, bonus.title].join(" ").toLowerCase();
}

const MS_DAY = 24 * 60 * 60 * 1000;

/** Data da "AAAA-MM-GG" o da stringhe ISO. */
function parseDate(raw?: string | null): Date | null {
  if (!raw) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw.trim());
  if (iso) return new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])));
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Età in mesi compiuti alla data di riferimento. */
function ageInMonths(birth: Date, ref: Date = new Date()): number {
  const months =
    (ref.getUTCFullYear() - birth.getUTCFullYear()) * 12 + (ref.getUTCMonth() - birth.getUTCMonth());
  return months - (ref.getUTCDate() < birth.getUTCDate() ? 1 : 0);
}

function ageInYears(birth: Date, ref: Date = new Date()): number {
  return Math.floor(ageInMonths(birth, ref) / 12);
}

/** "1 anno", "3 anni", "2 anni e 4 mesi". */
function ageLabel(birth: Date, ref: Date = new Date()): string {
  const months = Math.max(0, ageInMonths(birth, ref));
  const years = Math.floor(months / 12);
  const rest = months % 12;
  if (years === 0) return `${months} ${months === 1 ? "mese" : "mesi"}`;
  const y = `${years} ${years === 1 ? "anno" : "anni"}`;
  return rest === 0 ? y : `${y} e ${rest} mesi`;
}

const num = (v: number) => v.toLocaleString("it-IT");

// ---------------------------------------------------------------
// Requisito ISEE
// ---------------------------------------------------------------
// La prima cifra può essere una sola: "ISEE inferiore a 8.000 euro" (prima
// questo caso non veniva riconosciuto e la soglia spariva dal matching).
const ISEE_RE =
  /isee\s*(?:inferiore|superiore)?[^.\n]{0,30}?(\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{2})?|\d{4,6})\s*(?:euro|€)?/i;

/** Parse tollerante di importi: "12.000", "12,000.50", "12000 euro", "8.500,00". */
function parseAmount(raw: string): number | null {
  const m = raw.match(/(\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)/);
  if (!m) return null;
  let s = m[1];
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  const sep = Math.max(lastComma, lastDot);
  if (sep >= 0) {
    const decimals = s.length - sep - 1;
    const sepChar = s[sep];
    if (decimals === 2 || (decimals <= 2 && sepChar === ",")) {
      // separatore decimale: rimuovi gli altri (migliaia)
      s = s.replace(new RegExp(`\\${sepChar === "," ? "\\." : ","}`, "g"), "").replace(",", ".");
    } else {
      // separatore delle migliaia
      s = s.replace(/[.,]/g, "");
    }
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Un requisito è "significativo" se esclude almeno una condizione di vita reale. */
function isMeaningfulThreshold(v: number): boolean {
  return v >= 1_000;
}

/** Trova la soglia ISEE nel testo del bando (requisiti + titolo + sommario). */
function findIseeLimit(bonus: Bonus): number | null {
  const m = bonusText(bonus).match(ISEE_RE);
  if (!m) return null;
  const value = parseAmount(m[1]);
  if (value === null || !isMeaningfulThreshold(value)) return null;
  return value;
}

function checkIsee(profile: Profile | null, bonus: Bonus): MatchCheck | null {
  const limit = findIseeLimit(bonus);
  if (limit === null) return null;
  if (profile?.isee_value == null) {
    return { label: `ISEE richiesto ≤ ${num(limit)} € — da inserire nel profilo`, state: "warn" };
  }
  if (profile.isee_value <= limit) {
    return { label: `ISEE ok (${num(profile.isee_value)} € ≤ ${num(limit)} €)`, state: "ok" };
  }
  return {
    label: `ISEE sopra il limite richiesto (${num(profile.isee_value)} € > ${num(limit)} €)`,
    state: "fail",
  };
}

// ---------------------------------------------------------------
// Requisito territoriale (comune o regione, tutta l'Italia)
// ---------------------------------------------------------------
const REGIONI_IT = [
  "abruzzo",
  "basilicata",
  "calabria",
  "campania",
  "emilia romagna",
  "emilia-romagna",
  "friuli venezia giulia",
  "friuli-venezia giulia",
  "lazio",
  "liguria",
  "lombardia",
  "marche",
  "molise",
  "piemonte",
  "puglia",
  "sardegna",
  "sicilia",
  "toscana",
  "trentino alto adige",
  "trentino-alto adige",
  "umbria",
  "valle d'aosta",
  "veneto",
];

/** Parole che indicano che il bando parla davvero di residenza (non di dove si trova l'ente). */
const RESIDENZA_RE = /residen(?:za|ti|ziale)|residenti|domicili|dimor[ae]/i;

/** Estrae il comune o la regione richiesti, solo se il testo parla di residenza. */
function findResidenza(bonus: Bonus): { kind: "comune" | "regione"; name: string } | null {
  const text = bonusText(bonus).toLowerCase();
  if (!RESIDENZA_RE.test(text)) return null;

  const comune = text.match(/comune\s+di\s+([a-zà-ù'’\s-]{3,60})/);
  if (comune) {
    // Il nome del comune si ferma alla prima parola di servizio: senza questo
    // taglio "Comune di Genova - pratica GDE6791" diventava "genova pratica…".
    const name = comune[1]
      .split(/[,.;:)/]/)[0]
      .replace(
        /\s+(?:pratica|protocollo|avviso|bando|domanda|istanza|procedura|concessione|autorizzazione|area|id)\b[\s\S]*$/i,
        "",
      )
      .replace(/[\s\-–]+$/, "")
      .trim();
    if (name) return { kind: "comune", name };
  }
  for (const r of REGIONI_IT) {
    const pattern = new RegExp(`\\b${r.replace("-", "[- ]")}\\b`);
    if (pattern.test(text)) return { kind: "regione", name: r };
  }
  return null;
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function checkTerritorio(profile: Profile | null, bonus: Bonus): MatchCheck | null {
  const richiesta = findResidenza(bonus);
  if (!richiesta) return null;

  const city = normalize(profile?.city ?? "");
  const region = normalize(profile?.region ?? "");
  const target = normalize(richiesta.name);
  const isComune = richiesta.kind === "comune";
  const label = isComune
    ? `Riservato a residenti nel Comune di ${titleCase(richiesta.name)}`
    : `Riservato a residenti in ${titleCase(richiesta.name)}`;
  const hasAddress = Boolean(city || region);

  if (!hasAddress) return { label: `${label} — comune e regione da inserire nel profilo`, state: "warn" };

  const ok = isComune
    ? city.includes(target) || target.includes(city)
    : region.includes(target) || target.includes(region);

  if (ok) {
    return { label: isComune ? `Residenza ${titleCase(richiesta.name)} ok` : `Residenza ${titleCase(richiesta.name)} ok`, state: "ok" };
  }
  return { label, state: "fail" };
}

function titleCase(s: string): string {
  return s.replace(/\b[a-zà-ù]/g, (c) => c.toUpperCase());
}

// ---------------------------------------------------------------
// Età del richiedente (under 35, over 65, tra 18 e 35 anni…)
// ---------------------------------------------------------------
export interface AgeRange {
  min?: number;
  max?: number;
}

/** Cerca un intervallo di età nel testo. */
export function findAgeRange(text: string): AgeRange | null {
  const low = text.toLowerCase();
  // "tra 18 e 35 anni", "dai 18 ai 35 anni", "18-35 anni"
  const between = low.match(/(?:tra|fra|dai)\s+(\d{2})\s+(?:e|ai|a)\s+(\d{2})\s*anni/);
  if (between) {
    const a = Number(between[1]);
    const b = Number(between[2]);
    return { min: Math.min(a, b), max: Math.max(a, b) };
  }
  const dash = low.match(/\b(\d{2})\s*[-–]\s*(\d{2})\s*anni/);
  if (dash) {
    const a = Number(dash[1]);
    const b = Number(dash[2]);
    return { min: Math.min(a, b), max: Math.max(a, b) };
  }
  // "under 35", "sotto i 35 anni", "inferiore a 35 anni", "fino a 35 anni"
  const max =
    low.match(/\bunder\s*(\d{2})\b/) ??
    low.match(/(?:sotto|inferiore\s+a|non\s+superiore\s+a|fino\s+a|massimo|non\s+oltre)\s+(?:i\s+)?(\d{2})\s*anni/) ??
    low.match(/(?:sotto|inferiore\s+a|non\s+superiore\s+a|fino\s+a|massimo|non\s+oltre)\s+(?:i\s+)?(\d{2})\b/);
  if (max) return { max: Number(max[1]) };
  // "over 65", "oltre i 65 anni", "maggiore di 18 anni", "almeno 18 anni"
  const min =
    low.match(/\bover\s*(\d{2})\b/) ??
    low.match(/(?:superiore\s+a|maggiore\s+di|almeno|minimo|più\s+di|oltre)\s+(?:i\s+)?(\d{2})\s*anni/) ??
    low.match(/(?:superiore\s+a|maggiore\s+di|almeno|minimo|più\s+di|oltre)\s+(?:i\s+)?(\d{2})\b/);
  if (min) return { min: Number(min[1]) };
  return null;
}

function describeRange(range: AgeRange): string {
  if (range.min != null && range.max != null) return `tra ${range.min} e ${range.max} anni`;
  if (range.max != null) return `fino a ${range.max} anni`;
  return `almeno ${range.min} anni`;
}

function checkEtaRichiedente(profile: Profile | null, bonus: Bonus): MatchCheck | null {
  const range = findAgeRange(strictText(bonus));
  if (!range) return null;
  const birth = parseDate(profile?.birth_date);
  const label = `Età richiesta: ${describeRange(range)}`;
  if (!birth) return { label: `${label} — data di nascita da inserire nel profilo`, state: "warn" };

  const age = ageInYears(birth);
  if (range.max != null && age > range.max) {
    return { label: `Età fuori requisito (${age} anni > ${range.max})`, state: "fail" };
  }
  if (range.min != null && age < range.min) {
    return { label: `Età fuori requisito (${age} anni < ${range.min})`, state: "fail" };
  }
  return { label: `Età ok (${age} anni, ${describeRange(range)})`, state: "ok" };
}

// ---------------------------------------------------------------
// Requisito famiglia / figli (numero ed età)
// ---------------------------------------------------------------
const FIGLI_RE = /(\d+)\s*figl|figli\s*(?:a\s*carico|minorenni|minori|nati)/i;
const NUCLEO_RE = /(?:nucleo\s*familiare|famiglia)\s*(?:con|di|superiore\s*a|oltre)?\s*(\d+)/i;
/** Misure per la prima infanzia: il figlio deve avere meno di 3 anni (36 mesi). */
const NIDO_RE =
  /asilo\s*nido|nido\s*d['’]?infanzia|baby\s*parking|prima\s*infanzia|centri?\s*per\s*l['’]?infanzia|0\s*[-–]\s*3\s*anni|fino\s+a\s*3\s*anni|36\s*mesi/i;
/** Requisiti che riguardano figli minorenni. */
const MINORI_RE = /figli\s*minor|\bminori\b|sotto\s*i\s*18\s*anni|under\s*18/i;

/** Etichetta "minore di 3 anni" usata nei controlli. */
const TODDLER_MONTHS = 36;
const MINOR_MONTHS = 216;

function figliRichiesti(bonus: Bonus): number | null {
  const text = [...bonus.requirements, bonus.title].join(" ").toLowerCase();
  const m = text.match(FIGLI_RE);
  if (m) return Number(m[1]) || 1;
  return /figl/.test(text) ? 1 : null;
}

interface Kid {
  member: FamilyMember;
  birth: Date;
  months: number;
}

function kidsWithAge(profile: Profile | null): { kids: FamilyMember[]; aged: Kid[] } {
  const kids = (profile?.family_members ?? []).filter((m) => m.relation === "figlio");
  const aged: Kid[] = [];
  for (const member of kids) {
    const birth = parseDate(member.birth_date);
    if (birth) aged.push({ member, birth, months: ageInMonths(birth) });
  }
  return { kids, aged };
}

function checkFigli(profile: Profile | null, bonus: Bonus): MatchCheck | null {
  const text = bonusText(bonus).toLowerCase();
  const needsToddler = NIDO_RE.test(text);
  const needsMinor = MINORI_RE.test(text);
  const figli = figliRichiesti(bonus);
  if (!needsToddler && !needsMinor && !figli) return null;

  const { kids, aged } = kidsWithAge(profile);
  const youngest = aged.length > 0 ? aged.reduce((a, b) => (a.months <= b.months ? a : b)) : null;

  if (!profile) return { label: "Nucleo familiare — da compilare nel profilo", state: "warn" };

  // 1) Prima infanzia: serve un figlio sotto i 36 mesi.
  if (needsToddler) {
    if (kids.length === 0) {
      return { label: "Riservato a famiglie con un figlio sotto i 3 anni (nessun figlio nel nucleo)", state: "fail" };
    }
    if (!youngest) {
      return { label: "Figli senza data di nascita: indica l'età per verificare il limite dei 3 anni", state: "warn" };
    }
    if (youngest.months < TODDLER_MONTHS) {
      return { label: `Figlio sotto i 3 anni ok (${ageLabel(youngest.birth)})`, state: "ok" };
    }
    return {
      label: `Nessun figlio sotto i 3 anni: il più piccolo ha ${ageLabel(youngest.birth)}`,
      state: "fail",
    };
  }

  // 2) Figli minorenni richiesti.
  if (needsMinor) {
    if (kids.length === 0) {
      return { label: "Riservato a famiglie con figli minorenni (nessun figlio nel nucleo)", state: "fail" };
    }
    if (!youngest) {
      return { label: "Figli senza data di nascita: indica l'età per verificare la minore età", state: "warn" };
    }
    const minors = aged.filter((k) => k.months < MINOR_MONTHS).length;
    if (minors > 0) return { label: `Figli minorenni ok (${minors})`, state: "ok" };
    return { label: `Nessun figlio minorenne (il più piccolo ha ${ageLabel(youngest.birth)})`, state: "fail" };
  }

  // 3) Solo numero di figli / componenti del nucleo.
  if (figli) {
    if (kids.length === 0) {
      return {
        label: `Richiesti ${figli > 1 ? `${figli} figli` : "figli"} — nucleo non ancora compilato`,
        state: "warn",
      };
    }
    if (kids.length >= figli) {
      return { label: `Famiglia ok (${kids.length} ${kids.length === 1 ? "figlio" : "figli"})`, state: "ok" };
    }
    return { label: `Richiesti ${figli > 1 ? `${figli} figli` : "figli"} a carico`, state: "fail" };
  }

  const nucleoMin = [...bonus.requirements, bonus.title].join(" ").toLowerCase().match(NUCLEO_RE);
  if (!nucleoMin) return null;
  const userNucleo = (profile.family_members ?? []).length + 1;
  if (userNucleo >= Number(nucleoMin[1])) {
    return { label: `Nucleo ok (${userNucleo} componenti)`, state: "ok" };
  }
  return { label: `Nucleo familiare di almeno ${nucleoMin[1]} componenti`, state: "fail" };
}

// ---------------------------------------------------------------
// Requisito lavorativo
// ---------------------------------------------------------------
const WORK_MAP: { keywords: string[]; statuses: string[]; label: string }[] = [
  {
    keywords: ["disoccupat", "in cerca di occupazione", "cassa integrazione"],
    statuses: ["disoccupato"],
    label: "In cerca di occupazione",
  },
  { keywords: ["dipendent", "lavoratore subordinato"], statuses: ["dipendente"], label: "Lavoratore dipendente" },
  {
    keywords: ["autonom", "partita iva", "artigian", "commerciant"],
    statuses: ["autonomo"],
    label: "Lavoratore autonomo",
  },
  {
    keywords: ["studenti", "studente universitario", "iscritti all'universit"],
    statuses: ["studente"],
    label: "Studente",
  },
  { keywords: ["pensionat"], statuses: ["pensionato"], label: "Pensionato" },
  { keywords: ["casaling"], statuses: ["casalingo"], label: "Casalingo/a" },
];

function checkLavoro(profile: Profile | null, bonus: Bonus): MatchCheck | null {
  const text = strictText(bonus);
  const match = WORK_MAP.find((w) => w.keywords.some((k) => text.includes(k)));
  if (!match) return null;
  if (!profile?.employment_status) {
    return { label: `${match.label} — condizione lavorativa da indicare`, state: "warn" };
  }
  if (match.statuses.includes(profile.employment_status)) {
    return { label: `${match.label} ok`, state: "ok" };
  }
  return { label: `Riservato a: ${match.label.toLowerCase()}`, state: "fail" };
}

// ---------------------------------------------------------------
// Disabilità
// ---------------------------------------------------------------
const DISABIL_RE = /disabil|invalidit|non\s*autosufficien|handicap/i;
const DISABILE_FAMILIARE_RE =
  /figli?o?\s+(?:con\s+)?disabil|componente\s+con\s+disabil|familiare\s+con\s+disabil|persona\s+con\s+disabil/i;

function checkDisabilita(profile: Profile | null, bonus: Bonus): MatchCheck | null {
  const text = bonusText(bonus).toLowerCase();
  if (!DISABIL_RE.test(text)) return null;

  if (DISABILE_FAMILIARE_RE.test(text)) {
    if (!profile) return { label: "Richiesto un familiare con disabilità — profilo da compilare", state: "warn" };
    const disabled = (profile.family_members ?? []).some((m) => m.disabled);
    if (disabled) return { label: "Familiare con disabilità indicato nel profilo", state: "ok" };
    return { label: "Richiesto un familiare con disabilità (nessuno indicato nel nucleo)", state: "fail" };
  }

  // Il profilo non registra la disabilità del richiedente: non si può decidere.
  return { label: "Disabilità: non registrata nel profilo — verifica il requisito sulla fonte", state: "warn" };
}

// ---------------------------------------------------------------
// Destinatari (imprese vs persone)
// ---------------------------------------------------------------
const IMPRESE_RE = /\b(imprese|pmi|start\s?up|aziende|società|ditte individuali|professionisti|consorzi)\b/i;
const PERSONALI_RE =
  /\b(cittadini|famiglie|persone|nuclei familiari|lavoratori|disoccupati|studenti|pensionati|giovani|residenti|nucleo familiare)\b/i;

function checkDestinatari(bonus: Bonus): MatchCheck | null {
  const text = bonusText(bonus).toLowerCase();
  if (!IMPRESE_RE.test(text) || PERSONALI_RE.test(text)) return null;
  return { label: "Bando rivolto a imprese/aziende: verifica se fa per te", state: "warn" };
}

// ---------------------------------------------------------------
// Scadenza del bando
// ---------------------------------------------------------------
const MESI = [
  "gennaio",
  "febbraio",
  "marzo",
  "aprile",
  "maggio",
  "giugno",
  "luglio",
  "agosto",
  "settembre",
  "ottobre",
  "novembre",
  "dicembre",
];

/** Data del termine, se `bonus.deadline` contiene una data interpretabile. */
function findDeadline(bonus: Bonus): Date | null {
  const raw = (bonus.deadline ?? "").trim();
  if (!raw) return null;
  const numeric = raw.match(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\b/);
  if (numeric) {
    const year = Number(numeric[3]) < 100 ? 2000 + Number(numeric[3]) : Number(numeric[3]);
    return new Date(Date.UTC(year, Number(numeric[2]) - 1, Number(numeric[1])));
  }
  const textual = raw.toLowerCase().match(/\b(\d{1,2})\s+(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)\s+(\d{4})\b/);
  if (textual) {
    return new Date(Date.UTC(Number(textual[3]), MESI.indexOf(textual[2]), Number(textual[1])));
  }
  return null;
}

function checkScadenza(bonus: Bonus): MatchCheck | null {
  const date = findDeadline(bonus);
  if (!date) return null;
  const today = new Date();
  const days = Math.floor((Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())) / MS_DAY);
  if (days < 0) {
    return { label: `Termine indicato ${date.toLocaleDateString("it-IT")}: verifica se è ancora aperto`, state: "warn" };
  }
  if (days <= 30) {
    return { label: `Scadenza vicina: ${date.toLocaleDateString("it-IT")} (${days} ${days === 1 ? "giorno" : "giorni"})`, state: "ok" };
  }
  return null;
}

// ---------------------------------------------------------------
// Aggregazione
// ---------------------------------------------------------------
/** Pesi per lo stato delle verifiche nel calcolo dell'affinità. */
const SCORE_WEIGHT = { ok: 100, warn: 50, fail: 0 } as const;

/**
 * Calcola il matching tra il profilo utente e un bonus del catalogo.
 * `profile` null/incompleto → stato "unknown" con invito a completare il profilo.
 */
export function calculateBonusMatch(profile: Profile | null, bonus: Bonus): MatchResult {
  const checks = [
    checkIsee(profile, bonus),
    checkTerritorio(profile, bonus),
    checkEtaRichiedente(profile, bonus),
    checkFigli(profile, bonus),
    checkLavoro(profile, bonus),
    checkDisabilita(profile, bonus),
    checkDestinatari(bonus),
    checkScadenza(bonus),
  ].filter((c): c is MatchCheck => c !== null);

  const profileUsable = Boolean(
    profile &&
      (profile.isee_value != null ||
        profile.birth_date ||
        profile.city ||
        profile.region ||
        profile.family_members.length > 0 ||
        profile.employment_status),
  );

  if (checks.length === 0) {
    // Nessun criterio riconosciuto nel testo del bando.
    return {
      status: "unknown",
      score: profileUsable ? 60 : 0,
      checks: profileUsable
        ? []
        : [{ label: "Completa il tuo profilo per verificare se hai diritto a questo bonus", state: "warn" }],
    };
  }

  const hasFail = checks.some((c) => c.state === "fail");
  const hasWarn = checks.some((c) => c.state === "warn");
  const score = Math.round(checks.reduce((acc, c) => acc + SCORE_WEIGHT[c.state], 0) / checks.length);

  let status: MatchStatus;
  if (!profileUsable) status = "unknown";
  else if (hasFail) status = "not_eligible";
  else if (hasWarn) status = "maybe";
  else status = "eligible";

  return { status, score, checks };
}

/** Verifica rapida: l'utente può candidarsi (idoneo o da verificare)? */
export function isPotentiallyEligible(result: MatchResult): boolean {
  return result.status === "eligible" || result.status === "maybe" || result.status === "unknown";
}

/** Etichette e classi badge per lo stato di matching. */
export const MATCH_LABEL: Record<MatchStatus, string> = {
  eligible: "IDONEO",
  maybe: "VERIFICA DETTAGLI",
  not_eligible: "NON IDONEO",
  unknown: "PROFILO INCOMPLETO",
};

export const MATCH_CLASS: Record<MatchStatus, string> = {
  eligible: "border-positive/30 bg-positive/10 text-positive",
  maybe: "border-signal/30 bg-signal/10 text-signal",
  not_eligible: "border-negative/30 bg-negative/10 text-negative",
  unknown: "border-line bg-white/5 text-dim",
};
