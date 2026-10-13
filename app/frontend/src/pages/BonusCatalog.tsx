import { useMemo, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CalendarClock, ExternalLink, FileText, Heart, Loader2, RefreshCw, RotateCcw, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import PageHeader from "@/components/PageHeader";
import { MatchBadge, MatchChecks, MatchFallbackCta } from "@/components/match";
import { calculateBonusMatch } from "@/lib/matching";
import type { MatchStatus } from "@/lib/matching";
import { useBonuses, useDashboard, useDiscarded, useDocuments, useFavorites, useGenerateDocs, useProfile, useScanStatus, useScraperCatalog, useToggleDiscarded, useToggleFavorite } from "@/lib/queries";
import { CATEGORY_LABEL, fmtDateTime } from "@/lib/format";
import type { Bonus, Profile as UserProfile } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Filtri di idoneità basati sul matching con il profilo dell'utente. */
const FILTERS: { key: "all" | MatchStatus; label: string }[] = [
  { key: "eligible", label: "Idonei per me" },
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
  const { data: discarded } = useDiscarded();
  const { data: profile } = useProfile();
  const favSet = useMemo(() => new Set(favorites ?? []), [favorites]);
  const discSet = useMemo(() => new Set(discarded ?? []), [discarded]);
  const [filter, setFilter] = useState<"all" | MatchStatus>("all");
  const [category, setCategory] = useState("tutte");
  const [params] = useSearchParams();
  // La ricerca rapida dalla landing arriva come ?q=...
  const [q, setQ] = useState(params.get("q") ?? "");

  /** Matching calcolato una sola volta per bonus (profilo corrente). */
  const matchMap = useMemo(() => {
    const map = new Map<string, ReturnType<typeof calculateBonusMatch>>();
    for (const b of bonuses ?? []) map.set(b.id, calculateBonusMatch((profile ?? null) as UserProfile | null, b));
    return map;
  }, [bonuses, profile]);

  const eligibleCount = useMemo(
    () => [...matchMap.values()].filter((m) => m.status === "eligible").length,
    [matchMap],
  );

  // I bonus scartati escono dal griglia del catalogo: restano nel contenitore "Scartati".
  const list = (bonuses ?? []).filter(
    (b) =>
      !discSet.has(b.id) &&
      (filter === "all" || matchMap.get(b.id)?.status === filter) &&
      (category === "tutte" || b.category === category) &&
      (q === "" || `${b.title} ${b.authority} ${b.summary}`.toLowerCase().includes(q.toLowerCase())),
  );
  const count = (k: "all" | MatchStatus) =>
    k === "all" ? (bonuses ?? []).length : [...matchMap.values()].filter((m) => m.status === k).length;
  const docBonusIds = new Set((docs ?? []).map((d) => d.bonus_id));
  const favoriteBonuses = (bonuses ?? []).filter((b) => favSet.has(b.id));
  const discardedBonuses = (bonuses ?? []).filter((b) => discSet.has(b.id));

  return (
    <div>
      <PageHeader
        eyebrow="Catalogo bonus"
        title="Bonus filtrati sul tuo profilo"
        description="Confrontiamo i requisiti di ogni bando con i dati tuoi e della tua famiglia: badge di idoneità, percentuale di affinità e verifiche nel dettaglio."
        testId="bonus-title"
        actions={
          <Button
            variant="outline"
            className="h-11"
            disabled
            title="La valutazione AI approfondita arriva con il motore di scansione"
            data-testid="btn-reevaluate"
          >
            Valutazione AI in arrivo
          </Button>
        }
      />

      {catalog?.generated_at && (
        <p className="mb-4 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted" data-testid="bonus-last-update">
          <RefreshCw className="size-3.5" />
          <span>
            Ultimo aggiornamento: <span className="font-medium text-ink">{fmtDateTime(catalog.generated_at)}</span>
          </span>
          <span className="text-dim">· scansione automatica delle fonti ufficiali (ogni lunedì)</span>
        </p>
      )}

      {dash && !dash.has_profile && (
        <div className="mb-6 flex flex-col gap-3 rounded-xl border border-signal/30 bg-signal/10 p-4 sm:flex-row sm:items-center sm:justify-between" data-testid="bonus-no-profile-banner">
          <p className="text-sm text-signal">Completa il tuo profilo per verificare se hai diritto ai bonus del catalogo.</p>
          <Link to="/profile" className="text-sm font-semibold text-accent hover:underline" data-testid="link-to-profile">
            Vai al profilo →
          </Link>
        </div>
      )}
      {running && (
        <div className="mb-6 flex items-center gap-3 rounded-xl border border-line bg-white/[0.03] p-4 text-sm" data-testid="bonus-scan-running">
          <Loader2 className="size-4 animate-spin text-accent" />
          <span className="font-mono text-xs text-muted">{scan?.phase || "Analisi in corso…"}</span>
        </div>
      )}

      <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="flex flex-wrap gap-1 rounded-lg bg-white/[0.05] p-1" data-testid="bonus-match-filters">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={cn(
                "min-h-9 rounded-md px-3 text-sm transition-colors duration-150",
                filter === f.key ? "bg-white/[0.1] font-semibold text-ink shadow-xs" : "text-muted hover:text-ink",
              )}
              data-testid={`bonus-filter-eligibility-${f.key}`}
            >
              {f.label} <span className="font-mono text-xs text-dim">{count(f.key)}</span>
            </button>
          ))}
        </div>
        <Select value={category} onValueChange={(v: string) => setCategory(v)}>
          <SelectTrigger className="h-11 w-full lg:w-52" data-testid="bonus-filter-category-select">
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
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-dim" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Cerca bonus o ente…"
            className="h-11 pl-9"
            data-testid="bonus-search-input"
          />
        </div>
      </div>

      {/* Contenitori: preferiti e scartati, sempre visibili sopra il catalogo */}
      <div className="mb-6 grid gap-4 md:grid-cols-2" data-testid="bonus-collections">
        <CollectionPanel
          title="I tuoi preferiti"
          icon={<Heart className="size-4" />}
          tone="favorite"
          testId="favorites-panel"
          items={favoriteBonuses}
          emptyHint="Nessun preferito: tocca il cuoricino su una scheda per salvarlo qui."
        />
        <CollectionPanel
          title="Scartati"
          icon={<X className="size-4" />}
          tone="discarded"
          testId="discarded-panel"
          items={discardedBonuses}
          emptyHint="Nessun bonus scartato: puoi escluderli dal catalogo con il pulsante × su ogni scheda."
        />
      </div>

      {isError && <p className="text-sm text-muted">Catalogo non disponibile al momento.</p>}
      <div className="grid gap-4 md:grid-cols-2" data-testid="bonus-list">
        {list.map((b, i) => (
          <BonusCard
            key={b.id}
            bonus={b}
            index={i}
            profile={(profile ?? null) as UserProfile | null}
            match={matchMap.get(b.id) ?? calculateBonusMatch((profile ?? null) as UserProfile | null, b)}
            hasDocs={docBonusIds.has(b.id)}
            isFavorite={favSet.has(b.id)}
          />
        ))}
        {bonuses && list.length === 0 && (
          <div className="rounded-xl border border-dashed border-line bg-white/[0.03] p-8 text-center text-sm text-muted md:col-span-2" data-testid="bonus-empty">
            {filter === "eligible" && eligibleCount === 0
              ? "Nessun bonus risulta idoneo con i dati attuali del profilo: completa o aggiorna il tuo profilo, oppure esplora tutto il catalogo."
              : "Nessun bonus corrisponde ai filtri selezionati."}
          </div>
        )}
      </div>
    </div>
  );
}

function BonusCard({
  bonus: b,
  index,
  profile,
  match,
  hasDocs,
  isFavorite,
}: {
  bonus: Bonus;
  index: number;
  profile: UserProfile | null;
  match: ReturnType<typeof calculateBonusMatch>;
  hasDocs: boolean;
  isFavorite: boolean;
}) {
  const gen = useGenerateDocs();
  const fav = useToggleFavorite();
  const discard = useToggleDiscarded();
  const [open, setOpen] = useState(false);
  return (
    <article
      className="panel interactive flex flex-col rounded-2xl p-5 animate-rise"
      style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}
      data-testid="bonus-card"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wider text-dim">
            {b.authority} · {CATEGORY_LABEL[b.category] ?? b.category}
          </p>
          <h3 className="mt-1 font-display text-lg font-bold leading-snug text-ink" data-testid="bonus-card-title">{b.title}</h3>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {/* Cuoricino: aggiunge/rimuove dai preferiti */}
          <button
            className={cn(
              "flex size-9 items-center justify-center rounded-full transition-colors duration-150",
              isFavorite ? "bg-negative/10 text-negative" : "text-dim hover:bg-white/[0.06] hover:text-negative",
            )}
            onClick={() => fav.mutate(b.id)}
            aria-label={isFavorite ? "Rimuovi dai preferiti" : "Aggiungi ai preferiti"}
            aria-pressed={isFavorite}
            data-testid="btn-toggle-favorite"
          >
            <Heart className={cn("size-4.5", isFavorite && "fill-current")} />
          </button>
          {/* Scarta: esclude dal catalogo, resta nel contenitore "Scartati" */}
          <button
            className="flex size-9 items-center justify-center rounded-full text-dim transition-colors duration-150 hover:bg-white/[0.06] hover:text-ink"
            onClick={() => discard.mutate(b.id)}
            aria-label="Scarta questo bonus"
            data-testid="btn-toggle-discard"
          >
            <X className="size-4.5" />
          </button>
          <MatchBadge result={match} testId="bonus-eligibility-badge" />
        </div>
      </div>
      <p className="mt-2 text-sm text-muted">{b.summary}</p>
      <div className="mt-3 flex flex-wrap gap-2 text-xs">
        {b.amount && (
          <span className="rounded-md bg-accent/10 px-2 py-1 font-mono font-medium text-accent" data-testid="bonus-amount-badge">
            {b.amount}
          </span>
        )}
        {b.deadline && (
          <span className="flex items-center gap-1 rounded-md bg-white/[0.06] px-2 py-1 text-muted" data-testid="bonus-deadline">
            <CalendarClock className="size-3" /> {b.deadline}
          </span>
        )}
        {b.is_new && <span className="rounded-md bg-positive/10 px-2 py-1 font-semibold text-positive">Nuovo</span>}
      </div>

      {/* Dettaglio verifiche sul profilo / invito a completarlo */}
      {!profile ? (
        <MatchFallbackCta />
      ) : (
        match.checks.length > 0 && (
          <div className="mt-4 rounded-lg border border-line bg-white/[0.03] p-3" data-testid="bonus-match-checks">
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-dim">Verifiche sul tuo profilo</p>
            <MatchChecks result={match} />
          </div>
        )
      )}

      {b.eligibility_reason && (
        <div className="mt-4 rounded-lg border-l-2 border-accent bg-white/[0.03] p-3 text-sm text-muted" data-testid="bonus-ai-explanation-box">
          <span className="font-semibold text-ink">Analisi AI: </span>
          {b.eligibility_reason}
        </div>
      )}

      <button
        className="mt-3 self-start text-sm text-accent hover:underline"
        onClick={() => setOpen(!open)}
        data-testid="btn-toggle-requirements"
      >
        {open ? "Nascondi requisiti" : `Requisiti e documenti (${b.requirements.length})`}
      </button>
      {open && (
        <div className="mt-2 grid gap-3 text-sm sm:grid-cols-2" data-testid="bonus-requirements">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-dim">Requisiti</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-muted">
              {b.requirements.map((r) => <li key={r}>{r}</li>)}
            </ul>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-dim">Documenti</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-muted">
              {b.required_documents.map((r) => <li key={r}>{r}</li>)}
            </ul>
          </div>
        </div>
      )}

      <div className="mt-auto flex items-center justify-between gap-2 pt-5">
        <div className="flex items-center gap-1">
          {b.source_url ? (
            <a href={b.source_url} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-xs text-dim hover:text-ink" data-testid="bonus-source-link">
              <ExternalLink className="size-3" /> Fonte
            </a>
          ) : null}
        </div>
        <Button
          disabled={!profile || gen.isPending || match.status === "not_eligible"}
          onClick={() => {
            if (profile) gen.mutate({ bonus: b, profile });
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

/** Contenitore compatto di preferiti/scartati sopra il catalogo. */
function CollectionPanel({
  title,
  icon,
  tone,
  testId,
  items,
  emptyHint,
}: {
  title: string;
  icon: ReactNode;
  tone: "favorite" | "discarded";
  testId: string;
  items: Bonus[];
  emptyHint: string;
}) {
  const fav = useToggleFavorite();
  const discard = useToggleDiscarded();
  const remove = tone === "favorite" ? fav : discard;
  return (
    <section
      className="rounded-xl border border-line bg-white/[0.03] p-4"
      data-testid={testId}
      aria-label={title}
    >
      <header className="flex items-center gap-2">
        <span className={cn("flex size-7 items-center justify-center rounded-md", tone === "favorite" ? "bg-negative/10 text-negative" : "bg-white/[0.06] text-dim")}>
          {icon}
        </span>
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        <span className="font-mono text-xs text-dim" data-testid={`${testId}-count`}>{items.length}</span>
      </header>
      {items.length === 0 ? (
        <p className="mt-2 text-xs text-dim">{emptyHint}</p>
      ) : (
        <ul className="mt-3 space-y-1.5">
          {items.map((b) => (
            <li
              key={b.id}
              className="flex min-w-0 items-center gap-2 rounded-lg border border-line/60 bg-white/[0.02] px-3 py-2"
              data-testid={`${testId}-item`}
            >
              <span className="min-w-0 flex-1 truncate text-sm text-ink" title={b.title}>{b.title}</span>
              <button
                className={cn(
                  "flex size-8 shrink-0 items-center justify-center rounded-md transition-colors duration-150",
                  tone === "favorite"
                    ? "text-negative hover:bg-negative/10"
                    : "text-dim hover:bg-white/[0.06] hover:text-ink",
                )}
                onClick={() => remove.mutate(b.id)}
                aria-label={tone === "favorite" ? "Rimuovi dai preferiti" : "Ripristina tra i bonus del catalogo"}
                data-testid={tone === "favorite" ? "btn-remove-favorite" : "btn-restore-discarded"}
              >
                {tone === "favorite" ? <Heart className="size-4 fill-current" /> : <RotateCcw className="size-4" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
