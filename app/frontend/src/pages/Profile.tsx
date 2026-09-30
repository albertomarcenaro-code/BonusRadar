import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  Download,
  FileSignature,
  FileText,
  FolderOpen,
  Home,
  Landmark,
  Lock,
  Paperclip,
  Plus,
  Trash2,
  Upload,
  UserRound,
} from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  useAttachments,
  useDeleteAttachment,
  useDeleteDoc,
  useDocuments,
  useDownloadDoc,
  useOpenAttachment,
  useProfile,
  useSaveProfile,
  useUpdateDocStatus,
  useUploadAttachment,
} from "@/lib/queries";
import { CATEGORY_LABEL, DOC_STATUS_LABEL, EMPLOYMENT_LABEL, fmtDate, fmtDateTime } from "@/lib/format";
import type { FamilyMember, Profile, ProfileIn } from "@/lib/types";
import { cn } from "@/lib/utils";

const EMPTY: ProfileIn = {
  full_name: "",
  fiscal_code: "",
  birth_date: "",
  birth_place: "",
  gender: "",
  address: "",
  city: "",
  province: "",
  region: "",
  postal_code: "",
  phone: "",
  email: "",
  iban: "",
  employment_status: "",
  annual_income: null,
  isee_value: null,
  housing: "",
  family_members: [],
  interests: [],
  notes: "",
};

const NEW_MEMBER: FamilyMember = {
  name: "",
  relation: "figlio",
  birth_date: "",
  fiscal_code: "",
  disabled: false,
  student: false,
  dependent: true,
};

const RELATIONS: Record<string, string> = { coniuge: "Coniuge / partner", figlio: "Figlio/a", genitore: "Genitore", altro: "Altro" };
const HOUSING: Record<string, string> = { proprietario: "Proprietario", affitto: "In affitto", comodato: "Comodato / ospite", altro: "Altro" };
const INTERESTS = ["casa", "famiglia", "lavoro", "mobilita", "studio", "salute", "energia"];

const SECTIONS = [
  { id: 0, label: "Anagrafica & Residenza", icon: UserRound },
  { id: 1, label: "Nucleo familiare", icon: Home },
  { id: 2, label: "ISEE & Lavoro", icon: Landmark },
  { id: 3, label: "Interessi", icon: FolderOpen },
  { id: 4, label: "Documenti", icon: FileSignature },
] as const;

export default function Profile() {
  const { data, isLoading } = useProfile();
  if (isLoading) return <div className="h-96 animate-pulse rounded-2xl bg-white" />;
  return <ProfileForm key={data?.updated_at ?? "new"} initial={data ?? null} />;
}

function ProfileForm({ initial }: { initial: Profile | null }) {
  const [form, setForm] = useState<ProfileIn>(() => (initial ? { ...EMPTY, ...initial } : EMPTY));
  const [section, setSection] = useState(0);
  const save = useSaveProfile();

  const set = <K extends keyof ProfileIn>(k: K, v: ProfileIn[K]) => setForm((f) => ({ ...f, [k]: v }));
  const setMember = (i: number, patch: Partial<FamilyMember>) =>
    set("family_members", form.family_members.map((m, j) => (j === i ? { ...m, ...patch } : m)));
  const num = (v: string) => (v === "" ? null : Number(v));

  const field = (k: keyof ProfileIn, label: string, props: React.ComponentProps<typeof Input> = {}) => (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={k} className="text-xs font-semibold uppercase tracking-wider text-slate-500">
        {label}
      </Label>
      <Input
        id={k}
        value={(form[k] as string | number | null) ?? ""}
        onChange={(e) => set(k, e.target.value as never)}
        className="h-11 bg-white"
        data-testid={`input-${k.replace(/_/g, "-")}`}
        {...props}
      />
    </div>
  );

  return (
    <div>
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between animate-rise">
        <div className="max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#0056B3]">Il tuo spazio personale</p>
          <h1 className="mt-2 text-3xl font-bold text-slate-900 sm:text-4xl" data-testid="profile-title">
            Profilo, ISEE &amp; Documenti
          </h1>
          <p className="mt-2 text-slate-600">
            Questi dati servono a valutare la compatibilità con i bonus e a precompilare le domande. Restano nel tuo
            profilo protetto.
          </p>
        </div>
        <Button
          onClick={() => save.mutate(form)}
          disabled={save.isPending || !form.full_name.trim()}
          className="h-11 px-6"
          data-testid="btn-save-profile"
        >
          {save.isPending ? "Salvataggio…" : "Salva profilo"}
        </Button>
      </div>

      {/* Navigazione sezioni */}
      <nav className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-5" data-testid="profile-sections-nav">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setSection(s.id)}
            className={cn(
              "flex min-h-12 items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors duration-150",
              section === s.id
                ? "border-[#0056B3] bg-[#E8F0FA] font-semibold text-slate-900"
                : "border-slate-200 bg-white text-slate-600 hover:border-slate-400",
            )}
            data-testid={`profile-section-${s.id}`}
          >
            <s.icon className="size-4 shrink-0" />
            {s.label}
          </button>
        ))}
      </nav>

      {/* Sezione 1: Anagrafica e residenza */}
      {section === 0 && (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-8" data-testid="profile-section-anagrafica">
          <h2 className="mb-6 text-xl font-bold">1 · Anagrafica e Residenza</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {field("full_name", "Nome e cognome *", { required: true, placeholder: "Mario Rossi" })}
            {field("fiscal_code", "Codice fiscale", { placeholder: "RSSMRA80A01H501U", className: "h-11 bg-white font-mono uppercase" })}
            {field("birth_date", "Data di nascita", { type: "date" })}
            {field("birth_place", "Luogo di nascita")}
            {field("address", "Indirizzo di residenza", { placeholder: "Via Roma 1" })}
            {field("city", "Comune", { placeholder: "Genova" })}
            {field("province", "Provincia", { placeholder: "GE" })}
            {field("region", "Regione", { placeholder: "Liguria" })}
            {field("postal_code", "CAP")}
            {field("phone", "Telefono", { type: "tel" })}
            {field("email", "Email", { type: "email" })}
          </div>
          <p className="mt-4 rounded-lg bg-[#F5F9FE] p-3 text-sm text-slate-600">
            📍 Molti bandi locali richiedono residenza nel Comune di Genova o in Liguria: indica correttamente comune,
            provincia e regione.
          </p>
        </section>
      )}

      {/* Sezione 2: Nucleo familiare */}
      {section === 1 && (
        <section className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-5 sm:p-8" data-testid="profile-section-famiglia">
          <div>
            <h2 className="text-xl font-bold">2 · Nucleo Familiare e Figli</h2>
            <p className="mt-1 text-sm text-slate-600">
              Aggiungi i componenti del nucleo oltre a te (coniuge, figli, altri conviventi).
            </p>
          </div>
          {form.family_members.map((m, i) => (
            <div key={i} className="rounded-xl border border-slate-200 bg-slate-50 p-4" data-testid={`family-member-${i}`}>
              <div className="grid gap-3 sm:grid-cols-4">
                <Input
                  placeholder="Nome"
                  value={m.name}
                  onChange={(e) => setMember(i, { name: e.target.value })}
                  className="h-11 bg-white"
                  data-testid={`input-member-name-${i}`}
                />
                <Select value={m.relation} onValueChange={(v: string) => setMember(i, { relation: v })}>
                  <SelectTrigger className="h-11 w-full bg-white" data-testid={`select-member-relation-${i}`}>
                    <SelectValue placeholder="Parentela" />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(RELATIONS).map(([k, l]) => (
                      <SelectItem key={k} value={k}>{l}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  type="date"
                  value={m.birth_date}
                  onChange={(e) => setMember(i, { birth_date: e.target.value })}
                  className="h-11 bg-white"
                  data-testid={`input-member-birth-${i}`}
                />
                <Input
                  placeholder="Codice fiscale"
                  value={m.fiscal_code}
                  onChange={(e) => setMember(i, { fiscal_code: e.target.value })}
                  className="h-11 bg-white font-mono uppercase"
                  data-testid={`input-member-cf-${i}`}
                />
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-5 text-sm">
                {(["dependent", "disabled", "student"] as const).map((k) => (
                  <label key={k} className="flex items-center gap-2">
                    <Checkbox
                      checked={m[k]}
                      onCheckedChange={(v) => setMember(i, { [k]: Boolean(v) })}
                      data-testid={`checkbox-member-${k}-${i}`}
                    />
                    {{ dependent: "A carico", disabled: "Con disabilità", student: "Studente" }[k]}
                  </label>
                ))}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="ml-auto text-red-700"
                  onClick={() => set("family_members", form.family_members.filter((_, j) => j !== i))}
                  aria-label="Rimuovi componente"
                  data-testid={`btn-remove-member-${i}`}
                >
                  <Trash2 className="size-4" /> Rimuovi
                </Button>
              </div>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            className="h-11 self-start"
            onClick={() => set("family_members", [...form.family_members, { ...NEW_MEMBER }])}
            data-testid="btn-add-family-member"
          >
            <Plus className="size-4" /> Aggiungi componente
          </Button>
          <p className="font-mono text-xs text-slate-500" data-testid="family-count">
            Nucleo: {form.family_members.length + 1} componenti · {form.family_members.filter((m) => m.relation === "figlio").length} figli
          </p>
        </section>
      )}

      {/* Sezione 3: ISEE e lavoro */}
      {section === 2 && (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-8" data-testid="profile-section-economia">
          <h2 className="mb-6 text-xl font-bold">3 · Parametri Economici (ISEE e Lavoro)</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {field("isee_value", "Valore ISEE (€)", {
              type: "number",
              min: 0,
              step: "0.01",
              value: form.isee_value ?? "",
              onChange: (e) => set("isee_value", num(e.target.value)),
              placeholder: "es. 18500",
            })}
            {field("annual_income", "Reddito annuo lordo (€)", {
              type: "number",
              min: 0,
              value: form.annual_income ?? "",
              onChange: (e) => set("annual_income", num(e.target.value)),
            })}
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs font-semibold uppercase tracking-wider text-slate-500">Condizione lavorativa</Label>
              <Select value={form.employment_status} onValueChange={(v: string) => set("employment_status", v)}>
                <SelectTrigger className="h-11 w-full bg-white" data-testid="select-employment-status">
                  <SelectValue placeholder="Seleziona…" />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(EMPLOYMENT_LABEL).map(([k, l]) => (
                    <SelectItem key={k} value={k} data-testid={`employment-option-${k}`}>{l}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs font-semibold uppercase tracking-wider text-slate-500">Abitazione</Label>
              <Select value={form.housing} onValueChange={(v: string) => set("housing", v)}>
                <SelectTrigger className="h-11 w-full bg-white" data-testid="select-housing">
                  <SelectValue placeholder="Seleziona…" />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(HOUSING).map(([k, l]) => (
                    <SelectItem key={k} value={k}>{l}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="sm:col-span-2">
              {field("iban", "IBAN per l'accredito", { placeholder: "IT60X0542811101000000123456", className: "h-11 bg-white font-mono uppercase" })}
            </div>
          </div>
        </section>
      )}

      {/* Sezione 4: Interessi */}
      {section === 3 && (
        <section className="flex flex-col gap-5 rounded-2xl border border-slate-200 bg-white p-5 sm:p-8" data-testid="profile-section-interessi">
          <h2 className="text-xl font-bold">4 · Categorie e Aree d'Interesse</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {INTERESTS.map((k) => {
              const on = form.interests.includes(k);
              return (
                <label
                  key={k}
                  className={cn(
                    "flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border px-4 transition-colors duration-150",
                    on ? "border-[#0056B3] bg-[#E8F0FA]" : "border-slate-200 bg-white hover:border-slate-400",
                  )}
                >
                  <Checkbox
                    checked={on}
                    onCheckedChange={(v) =>
                      set("interests", v ? [...form.interests, k] : form.interests.filter((x) => x !== k))
                    }
                    data-testid={`checkbox-interest-${k}`}
                  />
                  <span className="text-sm font-medium">{CATEGORY_LABEL[k]}</span>
                </label>
              );
            })}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="notes" className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Note aggiuntive (situazioni particolari)
            </Label>
            <Textarea
              id="notes"
              value={form.notes}
              onChange={(e) => set("notes", e.target.value)}
              placeholder="es. figlio in arrivo, acquisto prima casa, invalidità civile…"
              className="bg-white"
              data-testid="input-notes"
            />
          </div>
        </section>
      )}

      {/* Sezione 5: Documenti (due tab) */}
      {section === 4 && <DocumentsSection />}

      {/* Navigazione inferiore */}
      <div className="mt-8 flex items-center justify-between border-t border-slate-100 pt-5">
        <Button
          type="button"
          variant="ghost"
          disabled={section === 0}
          onClick={() => setSection((s) => Math.max(0, s - 1))}
          data-testid="btn-prev-section"
        >
          <ArrowLeft className="size-4" /> Precedente
        </Button>
        <p className="hidden text-xs text-slate-400 sm:block">
          Sezione {section + 1} di {SECTIONS.length}
        </p>
        {section < SECTIONS.length - 1 ? (
          <Button onClick={() => setSection((s) => Math.min(SECTIONS.length - 1, s + 1))} className="h-11 px-6" data-testid="btn-next-section">
            Avanti <ArrowRight className="size-4" />
          </Button>
        ) : (
          <Link to="/dashboard" className={buttonVariants({ variant: "outline" })} data-testid="btn-goto-dashboard">
            Vai alla panoramica
          </Link>
        )}
      </div>
    </div>
  );
}

/* ============================================================
   Sezione 5 — Documenti: due tab
   ============================================================ */
function DocumentsSection() {
  const [tab, setTab] = useState<"allegati" | "moduli">("allegati");

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-8" data-testid="profile-section-documenti">
      <h2 className="text-xl font-bold">5 · Documenti</h2>

      <div className="mt-5 flex gap-2" data-testid="documents-tabs">
        <button
          type="button"
          onClick={() => setTab("allegati")}
          className={cn(
            "flex h-10 items-center gap-2 rounded-lg border px-4 text-sm font-semibold transition-colors duration-150",
            tab === "allegati" ? "border-[#0056B3] bg-[#E8F0FA] text-[#0056B3]" : "border-slate-200 bg-white text-slate-600 hover:border-slate-400",
          )}
          data-testid="tab-attachments"
        >
          <Paperclip className="size-4" /> I tuoi allegati
        </button>
        <button
          type="button"
          onClick={() => setTab("moduli")}
          className={cn(
            "flex h-10 items-center gap-2 rounded-lg border px-4 text-sm font-semibold transition-colors duration-150",
            tab === "moduli" ? "border-[#0056B3] bg-[#E8F0FA] text-[#0056B3]" : "border-slate-200 bg-white text-slate-600 hover:border-slate-400",
          )}
          data-testid="tab-moduli"
        >
          <FileSignature className="size-4" /> I tuoi moduli pronti
        </button>
      </div>

      <div className="mt-5">{tab === "allegati" ? <AttachmentsTab /> : <ModuliTab />}</div>
    </section>
  );
}

/* ---------- Tab 1: allegati (upload PDF ISEE, carta d'identità…) ---------- */
function AttachmentsTab() {
  const { data: attachments } = useAttachments();
  const upload = useUploadAttachment();
  const del = useDeleteAttachment();
  const open = useOpenAttachment();
  const inputRef = useRef<HTMLInputElement>(null);
  const [label, setLabel] = useState("");

  const onPick = (files: FileList | null) => {
    if (!files?.length) return;
    for (const f of Array.from(files)) upload.mutate({ file: f, label });
    setLabel("");
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <div className="flex flex-col gap-4" data-testid="attachments-tab">
      <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <Label htmlFor="att-label" className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Tipo di documento
            </Label>
            <Input
              id="att-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="es. Attestazione ISEE 2026, Carta d'identità…"
              className="mt-1.5 h-11 bg-white"
              data-testid="input-attachment-label"
            />
          </div>
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,.pdf"
            multiple
            className="hidden"
            onChange={(e) => onPick(e.target.files)}
            data-testid="input-attachment-file"
          />
          <Button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={upload.isPending}
            className="h-11"
            data-testid="btn-upload-attachment"
          >
            <Upload className="size-4" /> {upload.isPending ? "Caricamento…" : "Carica PDF"}
          </Button>
        </div>
        <p className="mt-3 flex items-center gap-1.5 text-xs text-slate-500">
          <Lock className="size-3.5" /> Solo PDF, max 10 MB. I file sono nel tuo archivio privato, visibili solo a te.
        </p>
      </div>

      {(attachments ?? []).length === 0 ? (
        <p className="rounded-xl border border-slate-200 p-6 text-center text-sm text-slate-500" data-testid="attachments-empty">
          Nessun allegato caricato. Carica l'attestazione ISEE e la carta d'identità per averli sempre pronti quando
          presenti una domanda.
        </p>
      ) : (
        <ul className="flex flex-col gap-2" data-testid="attachments-list">
          {(attachments ?? []).map((a) => (
            <li key={a.id} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3" data-testid="attachment-row">
              <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-[#E8F0FA]">
                <FileText className="size-5 text-[#0056B3]" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-slate-900">{a.label || a.name}</p>
                <p className="truncate font-mono text-xs text-slate-500">
                  {a.name} · {fmtDateTime(a.created_at)}
                  {a.size > 0 ? ` · ${(a.size / 1024).toFixed(0)} KB` : ""}
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => open.mutate(a)} disabled={open.isPending} data-testid="btn-open-attachment">
                <Download className="size-4" /> Apri
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-red-700"
                onClick={() => del.mutate(a)}
                disabled={del.isPending}
                aria-label={`Elimina ${a.label || a.name}`}
                data-testid="btn-delete-attachment"
              >
                <Trash2 className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ---------- Tab 2: moduli pronti (pratiche precompilate) ---------- */
function ModuliTab() {
  const { data: docs, isError } = useDocuments();

  return (
    <div className="flex flex-col gap-4" data-testid="moduli-tab">
      {isError && <p className="text-sm text-slate-500">Documenti non disponibili al momento.</p>}
      {docs && docs.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center" data-testid="moduli-empty">
          <FolderOpen className="mx-auto size-10 text-slate-300" />
          <p className="mt-3 font-medium">Nessuna pratica ancora</p>
          <p className="mt-1 text-sm text-slate-500">Dal catalogo, premi "Prepara documenti" su un bonus idoneo.</p>
          <Link to="/bonus" className={cn(buttonVariants(), "mt-5")} data-testid="moduli-go-bonus">
            Vai al catalogo
          </Link>
        </div>
      )}
      <div className="flex flex-col gap-4" data-testid="moduli-list">
        {(docs ?? []).map((d) => (
          <FolderCard key={d.id} doc={d} />
        ))}
      </div>
    </div>
  );
}

function FolderCard({ doc: d }: { doc: import("@/lib/types").DocumentFolder }) {
  const upd = useUpdateDocStatus();
  const del = useDeleteDoc();
  const dl = useDownloadDoc();
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-5 animate-rise" data-testid="document-folder-card">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex gap-4">
          <div className="grid size-12 shrink-0 place-items-center rounded-lg bg-[#E8F0FA]">
            <FolderOpen className="size-6 text-[#0056B3]" />
          </div>
          <div>
            <h3 className="text-lg font-bold leading-snug" data-testid="document-folder-title">{d.bonus_title}</h3>
            <p className="text-sm text-slate-500">
              {d.authority} · preparata il <span className="font-mono">{fmtDate(d.created_at)}</span>
            </p>
          </div>
        </div>
        <Select value={d.status} onValueChange={(v: string) => upd.mutate({ id: d.id, status: v as import("@/lib/types").DocStatus })}>
          <SelectTrigger className="h-10 w-full bg-white sm:w-44" data-testid="select-document-status">
            <SelectValue placeholder="Stato" />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(DOC_STATUS_LABEL) as import("@/lib/types").DocStatus[]).map((k) => (
              <SelectItem key={k} value={k} data-testid={`document-status-option-${k}`}>{DOC_STATUS_LABEL[k]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_1fr]">
        <div className="flex flex-col gap-2">
          {d.files.map((f) => (
            <button
              key={f.name}
              onClick={() => dl.mutate({ doc: d, kind: f.kind })}
              disabled={dl.isPending}
              className="group flex items-center gap-3 rounded-lg border border-slate-200 px-3 py-2.5 text-left transition-colors duration-150 hover:border-[#0056B3] hover:bg-[#F5F9FE]"
              data-testid={f.kind === "pdf" ? "btn-download-pdf" : "btn-download-docx"}
            >
              {f.kind === "pdf" ? <FileText className="size-5 text-red-700" /> : <Download className="size-5 text-[#0056B3]" />}
              <span className="min-w-0 flex-1 truncate font-mono text-sm">{f.name}</span>
              <Download className="size-4 text-slate-400 group-hover:text-[#0056B3]" />
            </button>
          ))}
          <div className="mt-1">
            <Button
              variant="ghost"
              className="text-red-700"
              onClick={() => del.mutate(d.id)}
              disabled={del.isPending}
              aria-label="Elimina cartella"
              data-testid="btn-delete-folder"
            >
              <Trash2 className="size-4" /> Elimina
            </Button>
          </div>
        </div>
        <div className="rounded-lg bg-slate-50 p-4 text-sm">
          {d.attachments.length > 0 && (
            <>
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Allegati da preparare</p>
              <ul className="mt-2 space-y-1 text-slate-700" data-testid="document-attachments">
                {d.attachments.map((a) => (
                  <li key={a} className="flex gap-2"><span className="text-slate-400">☐</span>{a}</li>
                ))}
              </ul>
            </>
          )}
          {d.submission_notes && (
            <>
              <p className="mt-4 text-xs font-semibold uppercase tracking-wider text-slate-500">Come presentare</p>
              <p className="mt-1 text-slate-700" data-testid="document-submission-notes">{d.submission_notes}</p>
            </>
          )}
        </div>
      </div>
    </article>
  );
}
