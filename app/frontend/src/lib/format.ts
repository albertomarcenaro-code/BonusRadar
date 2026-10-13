import type { DocStatus, Eligibility } from "@/lib/types";

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("it-IT", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export const ELIGIBILITY_LABEL: Record<Eligibility, string> = {
  eligible: "Idoneo",
  maybe: "Da verificare",
  not_eligible: "Non idoneo",
  unknown: "Non valutato",
};

export const ELIGIBILITY_CLASS: Record<Eligibility, string> = {
  eligible: "border-positive/30 bg-positive/10 text-positive",
  maybe: "border-signal/30 bg-signal/10 text-signal",
  not_eligible: "border-negative/30 bg-negative/10 text-negative",
  unknown: "border-line bg-white/5 text-dim",
};

export const DOC_STATUS_LABEL: Record<DocStatus, string> = {
  da_firmare: "Da firmare",
  firmato: "Firmato",
  inviato: "Inviato",
  approvato: "Approvato",
};

export const CATEGORY_LABEL: Record<string, string> = {
  casa: "Casa & Edilizia",
  famiglia: "Famiglia & Figli",
  lavoro: "Lavoro & Impresa",
  mobilita: "Mobilità",
  studio: "Studio & Cultura",
  salute: "Salute",
  energia: "Energia",
  altro: "Altro",
};

export const EMPLOYMENT_LABEL: Record<string, string> = {
  dipendente: "Lavoratore dipendente",
  autonomo: "Lavoratore autonomo / P.IVA",
  disoccupato: "Disoccupato / in cerca",
  studente: "Studente",
  pensionato: "Pensionato",
  casalingo: "Casalingo/a",
  altro: "Altro",
};
