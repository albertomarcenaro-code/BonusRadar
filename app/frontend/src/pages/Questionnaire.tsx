import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowRight, Check, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import PageHeader from "@/components/PageHeader";
import { useProfile, useSaveProfile } from "@/lib/queries";
import { CATEGORY_LABEL, EMPLOYMENT_LABEL } from "@/lib/format";
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

const STEPS = ["Dati anagrafici", "Nucleo familiare", "Situazione economica", "Interessi"];
const RELATIONS: Record<string, string> = { coniuge: "Coniuge / partner", figlio: "Figlio/a", genitore: "Genitore", altro: "Altro" };
const HOUSING: Record<string, string> = { proprietario: "Proprietario", affitto: "In affitto", comodato: "Comodato / ospite", altro: "Altro" };
const INTERESTS = ["casa", "famiglia", "lavoro", "mobilita", "studio", "salute", "energia"];

export default function Questionnaire() {
  const { data, isLoading } = useProfile();
  if (isLoading) return <div className="h-96 animate-pulse rounded-2xl bg-white" />;
  return <QuestionnaireForm key={data?.updated_at ?? "new"} initial={data ?? null} />;
}

function QuestionnaireForm({ initial }: { initial: Profile | null }) {
  const [form, setForm] = useState<ProfileIn>(() => (initial ? { ...EMPTY, ...initial } : EMPTY));
  const [step, setStep] = useState(0);
  const save = useSaveProfile();
  const nav = useNavigate();

  const set = <K extends keyof ProfileIn>(k: K, v: ProfileIn[K]) => setForm((f) => ({ ...f, [k]: v }));
  const setMember = (i: number, patch: Partial<FamilyMember>) =>
    set("family_members", form.family_members.map((m, j) => (j === i ? { ...m, ...patch } : m)));
  const num = (v: string) => (v === "" ? null : Number(v));

  const submit = () => {
    if (!form.full_name.trim()) {
      setStep(0);
      return;
    }
    save.mutate(form, { onSuccess: () => nav("/bonus") });
  };

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
      <PageHeader
        eyebrow="Questionario iniziale"
        title="Il tuo profilo e la tua famiglia"
        description="Questi dati servono all'AI per filtrare i bonus a cui puoi accedere e per compilare automaticamente le domande. Restano salvati solo nella tua app."
        testId="questionnaire-title"
      />

      <ol className="mb-6 grid grid-cols-4 gap-2" data-testid="questionnaire-stepper">
        {STEPS.map((s, i) => (
          <li key={s}>
            <button
              type="button"
              onClick={() => setStep(i)}
              className="w-full text-left"
              data-testid={`step-${i}`}
            >
              <div className={cn("h-1.5 rounded-full transition-colors duration-300", i <= step ? "bg-[#0056B3]" : "bg-slate-200")} />
              <p className={cn("mt-2 hidden text-xs sm:block", i === step ? "font-semibold text-slate-900" : "text-slate-500")}>
                {i + 1}. {s}
              </p>
            </button>
          </li>
        ))}
      </ol>

      <form
        className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-8"
        data-testid="questionnaire-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (step < STEPS.length - 1) setStep(step + 1);
          else submit();
        }}
      >
        <h2 className="mb-6 text-xl font-bold">{STEPS[step]}</h2>

        {step === 0 && (
          <div className="grid gap-4 sm:grid-cols-2">
            {field("full_name", "Nome e cognome *", { required: true, placeholder: "Mario Rossi" })}
            {field("fiscal_code", "Codice fiscale", { placeholder: "RSSMRA80A01H501U", className: "h-11 bg-white font-mono uppercase" })}
            {field("birth_date", "Data di nascita", { type: "date" })}
            {field("birth_place", "Luogo di nascita")}
            {field("address", "Indirizzo di residenza", { placeholder: "Via Roma 1" })}
            {field("city", "Comune")}
            {field("province", "Provincia", { placeholder: "MI" })}
            {field("region", "Regione", { placeholder: "Lombardia" })}
            {field("postal_code", "CAP")}
            {field("phone", "Telefono", { type: "tel" })}
            {field("email", "Email", { type: "email" })}
          </div>
        )}

        {step === 1 && (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-slate-600">Aggiungi i componenti del nucleo familiare oltre a te (coniuge, figli, altri conviventi).</p>
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
          </div>
        )}

        {step === 2 && (
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
        )}

        {step === 3 && (
          <div className="flex flex-col gap-5">
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
          </div>
        )}

        <div className="mt-8 flex items-center justify-between border-t border-slate-100 pt-5">
          <Button
            type="button"
            variant="ghost"
            disabled={step === 0}
            onClick={() => setStep(step - 1)}
            data-testid="btn-prev-step"
          >
            <ArrowLeft className="size-4" /> Indietro
          </Button>
          {step < STEPS.length - 1 ? (
            <Button type="submit" className="h-11 px-6" data-testid="btn-next-step">
              Avanti <ArrowRight className="size-4" />
            </Button>
          ) : (
            <Button type="submit" className="h-11 px-6" disabled={save.isPending} data-testid="btn-save-profile">
              <Check className="size-4" /> {save.isPending ? "Salvataggio…" : "Salva e trova i miei bonus"}
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}
