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
 */
import type { Bonus, Profile } from "@/lib/types";

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

const ISEE_RE = /isee\s*(?:inferiore|superiore)?[^.\n]{0,30}?(\d{2,3}[.,]\d{3}(?:[.,]\d{2})?|\d{4,6})\s*(?:euro|€)?/i;

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
  const text = [...bonus.requirements, bonus.title, bonus.summary].join(" ");
  const m = text.match(ISEE_RE);
  if (!m) return null;
  const value = parseAmount(m[1]);
  if (value === null || !isMeaningfulThreshold(value)) return null;
  return value;
}

function checkIsee(profile: Profile | null, bonus: Bonus): MatchCheck | null {
  const limit = findIseeLimit(bonus);
  if (limit === null) return null;
  if (profile?.isee_value == null) {
    return { label: `ISEE richiesto ≤ ${limit.toLocaleString("it-IT")} € — da inserire nel profilo`, state: "warn" };
  }
  if (profile.isee_value <= limit) {
    return { label: `ISEE ok (${profile.isee_value.toLocaleString("it-IT")} € ≤ ${limit.toLocaleString("it-IT")} €)`, state: "ok" };
  }
  return { label: `ISEE sopra il limite richiesto (${profile.isee_value.toLocaleString("it-IT")} € > ${limit.toLocaleString("it-IT")} €)`, state: "fail" };
}

// ---------------------------------------------------------------
// Requisito territoriale
// ---------------------------------------------------------------
const COMUNI = ["genova"];
const REGIONI = ["liguria"];

function checkTerritorio(profile: Profile | null, bonus: Bonus): MatchCheck | null {
  const text = [...bonus.requirements, bonus.title, bonus.summary].join(" ").toLowerCase();
  const mentionsComune = COMUNI.some((c) => text.includes(c));
  const mentionsRegione = REGIONI.some((r) => text.includes(r));
  if (!mentionsComune && !mentionsRegione) return null;

  const isGenova = Boolean(profile?.city && profile.city.toLowerCase().includes("genova"));
  const isLiguria = Boolean(profile?.region && profile.region.toLowerCase().includes("liguria"));

  if (mentionsComune) {
    if (isGenova) return { label: "Residenza Genova ok", state: "ok" };
    if (profile && (profile.city || profile.region)) {
      return { label: "Riservato a residenti nel Comune di Genova", state: "fail" };
    }
    return { label: "Residenza Comune di Genova — da confermare", state: "warn" };
  }
  // Solo regione
  if (isLiguria || isGenova) return { label: "Residenza Liguria ok", state: "ok" };
  if (profile && (profile.region || profile.city)) {
    return { label: "Riservato a residenti in Liguria", state: "fail" };
  }
  return { label: "Residenza in Liguria — da confermare", state: "warn" };
}

// ---------------------------------------------------------------
// Requisito famiglia / figli
// ---------------------------------------------------------------
const FIGLI_RE = /(\d+)\s*figl|figli\s*(?:a\s*carico|minorenni|nati)/i;
const NUCLEO_RE = /(?:nucleo\s*familiare|famiglia)\s*(?:con|di|superiore\s*a|oltre)?\s*(\d+)/i;

function figliRichiesti(bonus: Bonus): number | null {
  const text = [...bonus.requirements, bonus.title].join(" ").toLowerCase();
  const m = text.match(FIGLI_RE);
  if (m) return Number(m[1]) || 1;
  const mention = /figl/.test(text);
  return mention ? 1 : null; // menzione generica: almeno un figlio
}

function checkFamiglia(profile: Profile | null, bonus: Bonus): MatchCheck | null {
  const text = [...bonus.requirements, bonus.title].join(" ").toLowerCase();
  const nucleoMin = text.match(NUCLEO_RE);
  const figli = figliRichiesti(bonus);
  if (!figli && !nucleoMin) return null;

  const userFigli = (profile?.family_members ?? []).filter((m) => m.relation === "figlio").length;
  const userNucleo = (profile?.family_members ?? []).length + 1;

  if (figli) {
    if (!profile) return { label: "Nucleo familiare con figli — da compilare", state: "warn" };
    if (userFigli === 0 && profile.family_members.length === 0) {
      return { label: `Richiesti ${figli > 1 ? `${figli} figli` : "figli"} — nucleo non ancora compilato`, state: "warn" };
    }
    if (userFigli >= figli) {
      return { label: `Famiglia ok (${userFigli} ${userFigli === 1 ? "figlio" : "figli"})`, state: "ok" };
    }
    return { label: `Richiesti ${figli > 1 ? `${figli} figli` : "figli"} a carico`, state: "fail" };
  }

  // Solo nucleo minimo
  if (!profile) return { label: "Composizione nucleo familiare — da compilare", state: "warn" };
  if (userNucleo >= Number(nucleoMin![1])) {
    return { label: `Nucleo ok (${userNucleo} componenti)`, state: "ok" };
  }
  return { label: `Nucleo familiare di almeno ${nucleoMin![1]} componenti`, state: "fail" };
}

// ---------------------------------------------------------------
// Requisito lavorativo
// ---------------------------------------------------------------
const WORK_MAP: { keywords: string[]; statuses: string[]; label: string }[] = [
  { keywords: ["disoccupat", "in cerca di occupazione", "cassa integrazione"], statuses: ["disoccupato"], label: "In cerca di occupazione" },
  { keywords: ["dipendent", "lavoratore subordinato"], statuses: ["dipendente"], label: "Lavoratore dipendente" },
  { keywords: ["autonom", "partita iva", "artigian", "commerciant"], statuses: ["autonomo"], label: "Lavoratore autonomo" },
  { keywords: ["studenti", "studente universitario", "iscritti all'universit"], statuses: ["studente"], label: "Studente" },
  { keywords: ["pensionat"], statuses: ["pensionato"], label: "Pensionato" },
  { keywords: ["casaling"], statuses: ["casalingo"], label: "Casalingo/a" },
];

function checkLavoro(profile: Profile | null, bonus: Bonus): MatchCheck | null {
  const text = [...bonus.requirements, bonus.title].join(" ").toLowerCase();
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
    checkFamiglia(profile, bonus),
    checkLavoro(profile, bonus),
  ].filter((c): c is MatchCheck => c !== null);

  const profileUsable = Boolean(
    profile && (profile.isee_value != null || profile.city || profile.region || profile.family_members.length > 0 || profile.employment_status),
  );

  if (checks.length === 0) {
    // Nessun criterio riconosciuto nel testo del bando.
    return {
      status: "unknown",
      score: profileUsable ? 60 : 0,
      checks: profileUsable ? [] : [{ label: "Completa il tuo profilo per verificare se hai diritto a questo bonus", state: "warn" }],
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
  eligible: "bg-[#ECFDF5] text-[#065F46] border-[#A7F3D0]",
  maybe: "bg-[#FFFBEB] text-[#92400E] border-[#FDE68A]",
  not_eligible: "bg-[#FEF2F2] text-[#991B1B] border-[#FECACA]",
  unknown: "bg-slate-100 text-slate-600 border-slate-200",
};
