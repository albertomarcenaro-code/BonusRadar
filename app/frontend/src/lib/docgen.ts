/**
 * Generazione documenti nel browser (modalità demo, senza backend):
 *  - PDF  → finestra di stampa con foglio A4 (Salva come PDF)
 *  - DOCX → file HTML con MIME Word, apribile in Word/LibreOffice
 * In modalità Supabase la generazione "vera" restà al backend; qui produciamo
 * comunque un file scaricabile usando i dati del profilo.
 */
import type { Bonus, DocumentFile, Profile } from "@/lib/types";

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "documento";
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function buildHtml(bonus: Bonus, profile: Profile): string {
  const today = new Date().toLocaleDateString("it-IT");
  const rows = [
    ["Richiedente", profile.full_name || "________"],
    ["Codice fiscale", profile.fiscal_code || "________"],
    ["Nato/a a", `${profile.birth_place || "________"} il ${profile.birth_date || "________"}`],
    [
      "Residenza",
      [profile.address, profile.postal_code, profile.city, profile.province].filter(Boolean).join(", ") || "________",
    ],
    ["Condizione lavorativa", profile.employment_status || "________"],
    ["ISEE", profile.isee_value != null ? `${profile.isee_value} €` : "________"],
    ["Reddito annuo", profile.annual_income != null ? `${profile.annual_income} €` : "________"],
    ["IBAN", profile.iban || "________"],
  ];

  const memberRows = (profile.family_members ?? [])
    .map(
      (m) =>
        `<tr><td>${esc(m.name || "________")}</td><td>${esc(m.relation)}</td><td>${esc(m.birth_date)}</td><td>${
          m.dependent ? "Sì" : "No"
        }</td></tr>`,
    )
    .join("");

  return `<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8" />
<title>Domanda ${esc(bonus.title)}</title>
<style>
  @page { size: A4; margin: 2cm; }
  body { font-family: Georgia, 'Times New Roman', serif; font-size: 11pt; color: #111827; margin: 0; }
  h1 { font-size: 15pt; margin: 0 0 4pt; }
  h2 { font-size: 11pt; color: #0056B3; margin: 14pt 0 4pt; text-transform: uppercase; letter-spacing: 0.06em; }
  table { width: 100%; border-collapse: collapse; margin-top: 4pt; }
  td, th { border: 0.5pt solid #CBD5E1; padding: 4pt 6pt; text-align: left; vertical-align: top; }
  th { background: #F1F5F9; width: 34%; }
  .muted { color: #4B5563; }
  .sign { margin-top: 28pt; }
</style>
</head>
<body>
  <p class="muted">Spett.le ${esc(bonus.authority)}</p>
  <h1>Domanda di accesso — ${esc(bonus.title)}</h1>
  <p>Il/La sottoscritto/a <strong>${esc(profile.full_name || "________")}</strong>, nato/a a
     ${esc(profile.birth_place || "________")} il ${esc(profile.birth_date || "________")},
     residente in ${esc(profile.city || "________")}, <strong>CHIEDE</strong> di accedere al beneficio
     «${esc(bonus.title)}» (${esc(bonus.amount || "importo da definire")}), in base ai requisiti di seguito dichiarati.</p>

  <h2>Dati del richiedente</h2>
  <table><tbody>
    ${rows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join("")}
  </tbody></table>

  ${
    memberRows
      ? `<h2>Nucleo familiare</h2><table><thead><tr><th>Nome</th><th>Parentela</th><th>Nascita</th><th>A carico</th></tr></thead><tbody>${memberRows}</tbody></table>`
      : ""
  }

  <h2>Dichiarazioni sostitutive (DPR 445/2000)</h2>
  <ul>
    ${(bonus.requirements.length ? bonus.requirements : ["I requisiti previsti dal bando"]).map((r) => `<li>${esc(r)}</li>`).join("")}
  </ul>

  <h2>Allegati</h2>
  <ul>${(bonus.required_documents.length ? bonus.required_documents : ["Documento d'identità"]).map((d) => `<li>[ ] ${esc(d)}</li>`).join("")}</ul>

  <p class="sign">${esc(profile.city || "________")}, ${today}<br /><br />Firma del richiedente ______________________________<br />${esc(
    profile.full_name || "",
  )}</p>
</body>
</html>`;
}

export function makeFileNames(bonusTitle: string): { base: string; files: DocumentFile[] } {
  const base = `domanda-${slug(bonusTitle)}`;
  return { base, files: [{ name: `${base}.pdf`, kind: "pdf" }, { name: `${base}.docx`, kind: "docx" }] };
}

export function openPrintWindow(html: string): void {
  const w = window.open("", "_blank", "width=900,height=1000");
  if (!w) return;
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 400);
}

export function downloadHtmlAsDocx(html: string, fileName: string): void {
  const blob = new Blob(["\ufeff", html], { type: "application/msword" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
