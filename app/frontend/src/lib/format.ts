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
  eligible: "bg-[#ECFDF5] text-[#065F46] border-[#A7F3D0]",
  maybe: "bg-[#FFFBEB] text-[#92400E] border-[#FDE68A]",
  not_eligible: "bg-[#FEF2F2] text-[#991B1B] border-[#FECACA]",
  unknown: "bg-slate-100 text-slate-600 border-slate-200",
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
