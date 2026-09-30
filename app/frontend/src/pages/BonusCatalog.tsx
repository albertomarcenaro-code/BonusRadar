import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CalendarClock, ExternalLink, FileText, Heart, Loader2, RefreshCw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import PageHeader from "@/components/PageHeader";
import { useBonuses, useDashboard, useDocuments, useFavorites, useGenerateDocs, useProfile, useScanStatus, useScraperCatalog, useToggleFavorite } from "@/lib/queries";
import { CATEGORY_LABEL, ELIGIBILITY_CLASS, ELIGIBILITY_LABEL, fmtDateTime } from "@/lib/format";
import type { Bonus, Eligibility } from "@/lib/types";
import { cn } from "@/lib/utils";

const FILTERS: { key: "all" | Eligibility; label: string }[] = [
  { key: "eligible", label: "Idonei" },
  { key: "maybe", label: "Da verificare" },
  { key: "all", label: "Tutti" },
  { key: "not_eligible", label: "Non idonei" },
];

export default function BonusCatalog() {
  const { data: catalog } = useScraperCatalog();
  const { data: scan } = useScanStatus();
  const running = scan?.running ?? false;
  const { data: bonuses, isError } = useBonuses(running);
  const { data: dash } = useDashboard();
  const { data: docs } = useDocuments();
  const { data: favorites } = useFavorites();
  const [filter, setFilter] = useState<"all" | Eligibility>("all");
  const [category, setCategory] = useState("tutte");
  const [params] = useSearchParams();
  // La ricerca rapida dalla landing arriva come ?q=...
  const [q, setQ] = useState(params.get("q") ?? "");

  const list = (bonuses ?? []).filter(
    (b) =>
      (filter === "all" || b.eligibility === filter) &&
      (category === "tutte" || b.category === category) &&
      (q === "" || `${b.title} ${b.authority} ${b.summary}`.toLowerCase().includes(q.toLowerCase())),
  );
  const count = (k: "all" | Eligibility) => (bonuses ?? []).filter((b) => k === "all" || b.eligibility === k).length;
  const docBonusIds = new Set((docs ?? []).map((d) => d.bonus_id));

  return (
    <div>
      <PageHeader
        eyebrow="Catalogo bonus"
        title="Bonus filtrati sul tuo profilo"
        description="L'AI confronta i requisiti di ogni bando con i dati tuoi e della tua famiglia e ti spiega perché sei (o non sei) idoneo."
        testId="bonus-title"
        actions={
          <Button
            variant="outline"
            className="h-11"
            disabled
            title="La valutazione AI dell'idoneità arriva con il motore di scansione"
            data-testid="btn-reevaluate"
          >
            Valutazione AI in arrivo
          </Button>
        }
      />

      {catalog?.generated_at && (
        <p className="mb-4 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-slate-500" data-testid="bonus-last-update">
          <RefreshCw className="size-3.5" />
          <span>
            Ultimo aggiornamento: <span className="font-medium text-slate-700">{fmtDateTime(catalog.generated_at)}</span>
          </span>
          <span className="text-slate-400">· scansione automatica delle fonti ufficiali (ogni lunedì)</span>
        </p>
      )}

      {dash && !dash.has_profile && (
        <div className="mb-6 flex flex-col gap-3 rounded-xl border border-[#FDE68A] bg-[#FFFBEB] p-4 sm:flex-row sm:items-center sm:justify-between" data-testid="bonus-no-profile-banner">
          <p className="text-sm text-[#92400E]">Completa il profilo: senza i tuoi dati non possiamo valutare la tua idoneità.</p>
          <Link to="/profile" className="text-sm font-semibold text-[#0056B3] hover:underline" data-testid="link-to-profile">
            Vai al profilo →
          </Link>
        </div>
      )}
      {running && (
        <div className="mb-6 flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 text-sm" data-testid="bonus-scan-running">
          <Loader2 className="size-4 animate-spin text-[#0056B3]" />
          <span className="font-mono text-xs text-slate-600">{scan?.phase || "Analisi in corso…"}</span>
        </div>
      )}

      <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={cn(
                "min-h-9 rounded-md px-3 text-sm transition-colors duration-150",
                filter === f.key ? "bg-white font-semibold text-slate-900 shadow-xs" : "text-slate-600 hover:text-slate-900",
              )}
              data-testid={`bonus-filter-eligibility-${f.key}`}
            >
              {f.label} <span className="font-mono text-xs text-slate-400">{count(f.key)}</span>
            </button>
          ))}
        </div>
        <Select value={category} onValueChange={(v: string) => setCategory(v)}>
          <SelectTrigger className="h-11 w-full bg-white lg:w-52" data-testid="bonus-filter-category-select">
            <SelectValue placeholder="Tutte le categorie" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="tutte">Tutte le categorie</SelectItem>
            {Object.entries(CATEGORY_LABEL).map(([k, l]) => (
              <SelectItem key={k} value={k}>{l}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="relative lg:ml-auto lg:w-72">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Cerca bonus o ente…"
            className="h-11 bg-white pl-9"
            data-testid="bonus-search-input"
          />
        </div>
      </div>

      {isError && <p className="text-sm text-slate-500">Catalogo non disponibile al momento.</p>}
      <div className="grid gap-4 md:grid-cols-2" data-testid="bonus-list">
        {list.map((b, i) => (
          <BonusCard
            key={b.id}
            bonus={b}
            index={i}
            hasProfile={!!dash?.has_profile}
            hasDocs={docBonusIds.has(b.id)}
            isFavorite={(favorites ?? []).includes(b.id)}
          />
        ))}
        {bonuses && list.length === 0 && (
          <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500 md:col-span-2" data-testid="bonus-empty">
            Nessun bonus corrisponde ai filtri selezionati.
          </div>
        )}
      </div>
    </div>
  );
}

function BonusCard({
  bonus: b,
  index,
  hasProfile,
  hasDocs,
  isFavorite,
}: {
  bonus: Bonus;
  index: number;
  hasProfile: boolean;
  hasDocs: boolean;
  isFavorite: boolean;
}) {
  const gen = useGenerateDocs();
  const profileQ = useProfile();
  const fav = useToggleFavorite();
  const [open, setOpen] = useState(false);
  return (
    <article
      className="flex flex-col rounded-xl border border-slate-200 bg-white p-5 transition-[transform,border-color] duration-200 ease-out hover:-translate-y-0.5 hover:border-slate-400 animate-rise"
      style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}
      data-testid="bonus-card"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            {b.authority} · {CATEGORY_LABEL[b.category] ?? b.category}
          </p>
          <h3 className="mt-1 text-lg font-bold leading-snug text-slate-900" data-testid="bonus-card-title">{b.title}</h3>
        </div>
        <span
          className={cn("shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-semibold", ELIGIBILITY_CLASS[b.eligibility])}
          data-testid="bonus-eligibility-badge"
        >
          {ELIGIBILITY_LABEL[b.eligibility]}
        </span>
      </div>
      <p className="mt-2 text-sm text-slate-600">{b.summary}</p>
      <div className="mt-3 flex flex-wrap gap-2 text-xs">
        {b.amount && (
          <span className="rounded-md bg-[#E8F0FA] px-2 py-1 font-mono font-medium text-[#004085]" data-testid="bonus-amount-badge">
            {b.amount}
          </span>
        )}
        {b.deadline && (
          <span className="flex items-center gap-1 rounded-md bg-slate-100 px-2 py-1 text-slate-700" data-testid="bonus-deadline">
            <CalendarClock className="size-3" /> {b.deadline}
          </span>
        )}
        {b.is_new && <span className="rounded-md bg-emerald-50 px-2 py-1 font-semibold text-emerald-700">Nuovo</span>}
      </div>

      {b.eligibility_reason && (
        <div className="mt-4 rounded-lg border-l-2 border-[#0056B3] bg-slate-50 p-3 text-sm text-slate-700" data-testid="bonus-ai-explanation-box">
          <span className="font-semibold text-slate-900">Analisi AI: </span>
          {b.eligibility_reason}
        </div>
      )}

      <button
        className="mt-3 self-start text-sm text-[#0056B3] hover:underline"
        onClick={() => setOpen(!open)}
        data-testid="btn-toggle-requirements"
      >
        {open ? "Nascondi requisiti" : `Requisiti e documenti (${b.requirements.length})`}
      </button>
      {open && (
        <div className="mt-2 grid gap-3 text-sm sm:grid-cols-2" data-testid="bonus-requirements">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Requisiti</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-slate-700">
              {b.requirements.map((r) => <li key={r}>{r}</li>)}
            </ul>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Documenti</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-slate-700">
              {b.required_documents.map((r) => <li key={r}>{r}</li>)}
            </ul>
          </div>
        </div>
      )}

      <div className="mt-auto flex items-center justify-between gap-2 pt-5">
        <div className="flex items-center gap-1">
          <button
            className={cn(
              "flex h-8 items-center gap-1 rounded-md px-2 text-xs transition-colors duration-150",
              isFavorite ? "text-red-600" : "text-slate-500 hover:text-red-600",
            )}
            onClick={() => fav.mutate(b.id)}
            aria-label={isFavorite ? "Rimuovi dai preferiti" : "Aggiungi ai preferiti"}
            data-testid="btn-toggle-favorite"
          >
            <Heart className={cn("size-4", isFavorite && "fill-current")} />
            {isFavorite ? "Preferito" : "Preferito"}
          </button>
          {b.source_url ? (
            <a href={b.source_url} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-900" data-testid="bonus-source-link">
              <ExternalLink className="size-3" /> Fonte
            </a>
          ) : null}
        </div>
        <Button
          disabled={!hasProfile || gen.isPending || b.eligibility === "not_eligible"}
          onClick={() => {
            if (profileQ.data) gen.mutate({ bonus: b, profile: profileQ.data });
          }}
          className="h-10"
          data-testid="btn-generate-docs"
        >
          {gen.isPending ? <Loader2 className="size-4 animate-spin" /> : <FileText className="size-4" />}
          {gen.isPending ? "Compilazione…" : hasDocs ? "Rigenera documenti" : "Prepara documenti"}
        </Button>
      </div>
    </article>
  );
}
