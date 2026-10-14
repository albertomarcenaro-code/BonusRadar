import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CalendarClock, ExternalLink, FileText, Heart, Loader2, Radar, RefreshCw, RotateCcw, Search, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import PageHeader from "@/components/PageHeader";
import { MatchBadge, MatchChecks, MatchFallbackCta } from "@/components/match";
import { calculateBonusMatch } from "@/lib/matching";
import type { MatchStatus } from "@/lib/matching";
import { searchLocalBonuses } from "@/lib/webSearch";
import { useBonuses, useDashboard, useDiscarded, useDocuments, useFavorites, useGenerateDocs, useProfile, useScanStatus, useScraperCatalog, useToggleDiscarded, useToggleFavorite, useWebSearch } from "@/lib/queries";
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

/** Ricerche rapide: avviano subito anche la scansione web on-demand. */
const QUICK_FILTERS = [
  { label: "Pannelli solari", q: "pannelli solari" },
  { label: "Ristrutturazioni", q: "ristrutturazione casa" },
  { label: "Asilo nido", q: "asilo nido" },
  { label: "Affitto giovani", q: "affitto giovani" },
  { label: "Disoccupazione", q: "disoccupazione" },
  { label: "Mobilità elettrica", q: "mobilità elettrica" },
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
  const [params, setParams] = useSearchParams();
  // La ricerca rapida dalla landing arriva come ?q=...; ?bonus=<id> apre il drawer.
  const [q, setQ] = useState(params.get("q") ?? "");
  const openId = params.get("bonus");

  // Ricerca locale "intelligente" (scoring con sinonimi, ordinata per rilevanza).
  const localMatches = useMemo(() => searchLocalBonuses(bonuses ?? [], q), [bonuses, q]);

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

  // I bonus scartati escono dalla griglia del catalogo: restano nel contenitore "Scartati".
  // Con una query attiva l'elenco è ordinato per rilevanza decrescente.
  const list = useMemo(() => {
    const base = (bonuses ?? []).filter(
      (b) =>
        !discSet.has(b.id) &&
        (filter === "all" || matchMap.get(b.id)?.status === filter) &&
        (category === "tutte" || b.category === category),
    );
    if (!q.trim()) return base;
    const scored = new Map(localMatches.map((r) => [r.bonus.id, r.relevance]));
    return base.filter((b) => scored.has(b.id)).sort((a, b) => (scored.get(b.id) ?? 0) - (scored.get(a.id) ?? 0));
  }, [bonuses, discSet, filter, category, q, localMatches, matchMap]);

  const count = (k: "all" | MatchStatus) =>
    k === "all" ? (bonuses ?? []).length : [...matchMap.values()].filter((m) => m.status === k).length;
  const docBonusIds = new Set((docs ?? []).map((d) => d.bonus_id));
  const favoriteBonuses = (bonuses ?? []).filter((b) => favSet.has(b.id));
  const discardedBonuses = (bonuses ?? []).filter((b) => discSet.has(b.id));

  // ------------------------------------------------------------------
  // Scansione web on-demand
  // ------------------------------------------------------------------
  const { start: startWeb, reset: resetWeb, isScanning, phase, result, webBonuses, lastQuery } = useWebSearch();

  // Se la ricerca locale non trova nulla per una query "complessa", la scansione
  // web parte in background senza che l'utente debba premere nulla.
  useEffect(() => {
    const trimmed = q.trim();
    if (trimmed.length < 8 || isScanning) return;
    const t = setTimeout(() => {
      const localCount = searchLocalBonuses(bonuses ?? [], trimmed).filter((r) => !discSet.has(r.bonus.id)).length;
      if (localCount === 0 && lastQuery !== trimmed) void startWeb(trimmed);
    }, 900);
    return () => clearTimeout(t);
  }, [q, bonuses, discSet, isScanning, lastQuery, startWeb]);

  const runQuickFilter = (value: string) => {
    setQ(value);
    void startWeb(value);
  };

  // ------------------------------------------------------------------
  // Drawer dettaglio bonus (?bonus=<id>, aperto anche dalla Panoramica)
  // ------------------------------------------------------------------
  const openDetail = (id: string) => {
    const next = new URLSearchParams(params);
    next.set("bonus", id);
    setParams(next);
  };
  const closeDetail = () => {
    const next = new URLSearchParams(params);
    next.delete("bonus");
    setParams(next, { replace: true });
  };

  useEffect(() => {
    if (!openId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeDetail();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId, params]);

  /** Bonus aperto nel drawer: dal catalogo locale o dai risultati della scansione web. */
  const detail = useMemo(() => {
    if (!openId) return null;
    const inDb = (bonuses ?? []).find((b) => b.id === openId);
    if (inDb) {
      return {
        bonus: inDb,
        match: matchMap.get(inDb.id) ?? calculateBonusMatch((profile ?? null) as UserProfile | null, inDb),
        isLocal: true,
      };
    }
    const inWeb = webBonuses.find((w) => w.bonus.id === openId);
    if (inWeb) return { bonus: inWeb.bonus, match: inWeb.match, isLocal: false };
    return null;
  }, [openId, bonuses, matchMap, profile, webBonuses]);

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

      {/* ------------------------------------------------------------
          Ricerca potenziata: contenitore dedicato + scansione web on-demand
      */}
      <div className="mb-4" data-testid="bonus-search-box">
        <div className="panel flex flex-col gap-3 rounded-2xl p-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-4 top-1/2 size-4.5 -translate-y-1/2 text-dim" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && q.trim()) void startWeb(q);
              }}
              placeholder="Cerca un bando, un argomento o un ente… es. «pannelli solari», «ristrutturazione»"
              className="h-12 rounded-xl bg-white/[0.04] pl-12 pr-4"
              aria-label="Cerca bonus nel catalogo e sul web"
              data-testid="bonus-search-input"
            />
          </div>
          <Button
            className="h-12 shrink-0"
            disabled={!q.trim() || isScanning}
            onClick={() => void startWeb(q)}
            data-testid="btn-web-scan"
          >
            {isScanning ? <Loader2 className="size-4 animate-spin" /> : <Radar className="size-4" />}
            {isScanning ? "Scansione in corso…" : "Scansione web"}
          </Button>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2" data-testid="bonus-quick-filters">
          <span className="text-xs text-dim">Ricerche rapide:</span>
          {QUICK_FILTERS.map((f) => (
            <button
              key={f.q}
              onClick={() => runQuickFilter(f.q)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium transition-colors duration-150",
                q === f.q
                  ? "border-accent/40 bg-accent/10 text-accent"
                  : "border-line bg-white/[0.03] text-muted hover:border-accent/30 hover:text-ink",
              )}
              data-testid={`bonus-quick-filter-${f.label.toLowerCase().replace(/\s+/g, "-")}`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Stato di scansione web: radar in azione + fasi + progress bar */}
      {isScanning && (
        <div className="panel mb-6 overflow-hidden rounded-2xl p-5" data-testid="bonus-web-scan-status">
          <div className="flex items-center gap-4">
            <div className="relative grid size-12 shrink-0 place-items-center">
              <span className="absolute inset-0 rounded-full border border-accent/25" />
              <span className="radar-sweep absolute inset-1 rounded-full" />
              <span className="radar-ping absolute size-3 rounded-full bg-accent/70" />
              <Radar className="relative size-5 text-accent" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-ink">Scansione fonti ufficiali e bandi in corso…</p>
              <p className="mt-0.5 truncate font-mono text-xs text-accent" data-testid="bonus-web-scan-phase">{phase}</p>
              <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/[0.06]">
                <div className="scan-progress-bar h-full w-1/3 rounded-full bg-gradient-to-r from-accent/50 via-accent to-accent/50" />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Risultati della scansione web: nuovi bandi con badge di idoneità dinamici */}
      {!isScanning && result && (
        <section className="mb-8" data-testid="bonus-web-results">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 font-display text-xl font-bold text-ink" data-testid="bonus-web-results-title">
              <Sparkles className="size-5 text-accent" />
              Risultati della scansione web
              <span className="font-mono text-sm font-normal text-dim">({webBonuses.length + result.leads.length})</span>
            </h2>
            <button onClick={resetWeb} className="text-sm text-dim hover:text-ink" data-testid="btn-close-web-results">
              Chiudi risultati
            </button>
          </div>
          {webBonuses.length === 0 && result.leads.length === 0 ? (
            <div className="rounded-xl border border-dashed border-line bg-white/[0.03] p-6 text-sm text-muted" data-testid="bonus-web-results-empty">
              La scansione non ha trovato bandi nuovi per «{lastQuery}». Prova a riformulare la ricerca o esplora il catalogo locale.
            </div>
          ) : (
            <>
              <div className="grid gap-4 md:grid-cols-2">
                {webBonuses.map(({ bonus: b, match }) => (
                  <article
                    key={b.id}
                    className="panel interactive flex cursor-pointer flex-col rounded-2xl p-5"
                    onClick={() => openDetail(b.id)}
                    data-testid="bonus-web-result"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-xs font-semibold uppercase tracking-wider text-dim">
                          {b.authority} · {CATEGORY_LABEL[b.category] ?? b.category}
                        </p>
                        <h3 className="mt-1 font-display text-lg font-bold leading-snug text-ink">{b.title}</h3>
                      </div>
                      <MatchBadge result={match} size="lg" testId="bonus-web-result-badge" />
                    </div>
                    <p className="mt-2 text-sm text-muted">{b.summary}</p>
                    <div className="mt-3 flex flex-wrap gap-2 text-xs">
                      {b.amount && <span className="rounded-md bg-accent/10 px-2 py-1 font-mono font-medium text-accent">{b.amount}</span>}
                      {b.deadline && (
                        <span className="flex items-center gap-1 rounded-md bg-white/[0.06] px-2 py-1 text-muted">
                          <CalendarClock className="size-3" /> {b.deadline}
                        </span>
                      )}
                      <span className="rounded-md bg-positive/10 px-2 py-1 font-semibold text-positive">Trovato ora</span>
                    </div>
                    <div className="mt-auto flex items-center justify-between gap-2 pt-4">
                      <span className="text-xs text-dim">Scansione web on-demand</span>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          openDetail(b.id);
                        }}
                        data-testid="btn-open-web-result"
                      >
                        Apri scheda
                      </Button>
                    </div>
                  </article>
                ))}
              </div>
              {result.leads.length > 0 && (
                <div className="mt-4 rounded-xl border border-line bg-white/[0.03] p-4" data-testid="bonus-web-leads">
                  <p className="text-xs font-semibold uppercase tracking-wider text-dim">Approfondimenti dal web</p>
                  <ul className="mt-2 space-y-2">
                    {result.leads.map((l) => (
                      <li key={l.url} className="min-w-0">
                        <a
                          href={l.url}
                          target="_blank"
                          rel="noreferrer"
                          className="group flex items-start gap-2 text-sm text-ink hover:text-accent"
                        >
                          <ExternalLink className="mt-0.5 size-3.5 shrink-0 text-dim group-hover:text-accent" />
                          <span className="min-w-0">
                            <span className="font-medium">{l.title}</span>
                            {l.snippet && <span className="block truncate text-muted">{l.snippet}</span>}
                          </span>
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </section>
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
            onOpen={() => openDetail(b.id)}
          />
        ))}
        {bonuses && list.length === 0 && (
          <div className="rounded-xl border border-dashed border-line bg-white/[0.03] p-8 text-center text-sm text-muted md:col-span-2" data-testid="bonus-empty">
            {filter === "eligible" && eligibleCount === 0
              ? "Nessun bonus risulta idoneo con i dati attuali del profilo: completa o aggiorna il tuo profilo, oppure esplora tutto il catalogo."
              : q.trim()
                ? `Nessun risultato locale per «${q.trim()}». Premi «Scansione web» per cercare anche nelle fonti ufficiali.`
                : "Nessun bonus corrisponde ai filtri selezionati."}
          </div>
        )}
      </div>

      {/* Drawer di dettaglio: overlay con backdrop-blur che sfoca il catalogo */}
      {detail && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/40 backdrop-blur-md"
            onClick={closeDetail}
            aria-hidden
            data-testid="bonus-detail-backdrop"
          />
          <div
            className="pointer-events-none fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:p-8"
            role="dialog"
            aria-modal="true"
            aria-label="Dettaglio bonus"
            onClick={closeDetail}
            data-testid="bonus-detail-drawer"
          >
            <BonusDetailPanel
              bonus={detail.bonus}
              match={detail.match}
              isLocal={detail.isLocal}
              isFavorite={favSet.has(detail.bonus.id)}
              hasDocs={docBonusIds.has(detail.bonus.id)}
              profile={(profile ?? null) as UserProfile | null}
              onClose={closeDetail}
            />
          </div>
        </>
      )}
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
  onOpen,
}: {
  bonus: Bonus;
  index: number;
  profile: UserProfile | null;
  match: ReturnType<typeof calculateBonusMatch>;
  hasDocs: boolean;
  isFavorite: boolean;
  onOpen: () => void;
}) {
  const gen = useGenerateDocs();
  const fav = useToggleFavorite();
  const discard = useToggleDiscarded();
  const [open, setOpen] = useState(false);
  return (
    <article
      className="panel interactive flex cursor-pointer flex-col rounded-2xl p-5 animate-rise"
      style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}
      onClick={onOpen}
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
            onClick={(e) => {
              e.stopPropagation();
              fav.mutate(b.id);
            }}
            aria-label={isFavorite ? "Rimuovi dai preferiti" : "Aggiungi ai preferiti"}
            aria-pressed={isFavorite}
            data-testid="btn-toggle-favorite"
          >
            <Heart className={cn("size-4.5", isFavorite && "fill-current")} />
          </button>
          {/* Scarta: esclude dal catalogo, resta nel contenitore "Scartati" */}
          <button
            className="flex size-9 items-center justify-center rounded-full text-dim transition-colors duration-150 hover:bg-white/[0.06] hover:text-ink"
            onClick={(e) => {
              e.stopPropagation();
              discard.mutate(b.id);
            }}
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
        onClick={(e) => {
          e.stopPropagation();
          setOpen(!open);
        }}
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
            <a
              href={b.source_url}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 text-xs text-dim hover:text-ink"
              onClick={(e) => e.stopPropagation()}
              data-testid="bonus-source-link"
            >
              <ExternalLink className="size-3" /> Fonte
            </a>
          ) : null}
        </div>
        <Button
          disabled={!profile || gen.isPending || match.status === "not_eligible"}
          onClick={(e) => {
            e.stopPropagation();
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

/**
 * Pannello di dettaglio del bonus nel drawer: badge grande, verifiche,
 * requisiti/documenti completi e azioni. Per i bandid scoperti dal web
 * (non ancora nel catalogo locale) mostra la sola CTA alla fonte ufficiale.
 */
function BonusDetailPanel({
  bonus: b,
  match,
  isLocal,
  isFavorite,
  hasDocs,
  profile,
  onClose,
}: {
  bonus: Bonus;
  match: ReturnType<typeof calculateBonusMatch>;
  isLocal: boolean;
  isFavorite: boolean;
  hasDocs: boolean;
  profile: UserProfile | null;
  onClose: () => void;
}) {
  const gen = useGenerateDocs();
  const fav = useToggleFavorite();
  return (
    <div
      className="panel pointer-events-auto relative mt-4 w-full max-w-2xl rounded-2xl p-6 animate-rise sm:mt-8"
      onClick={(e) => e.stopPropagation()}
      data-testid="bonus-detail-panel"
    >
      <button
        className="absolute right-4 top-4 flex size-9 items-center justify-center rounded-full text-dim transition-colors duration-150 hover:bg-white/[0.06] hover:text-ink"
        onClick={onClose}
        aria-label="Chiudi dettaglio"
        data-testid="btn-close-detail"
      >
        <X className="size-5" />
      </button>

      <p className="pr-12 text-xs font-semibold uppercase tracking-wider text-dim">
        {b.authority} · {CATEGORY_LABEL[b.category] ?? b.category}
      </p>
      <h2 className="mt-1 pr-12 font-display text-2xl font-bold leading-snug text-ink" data-testid="bonus-detail-title">
        {b.title}
      </h2>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <MatchBadge result={match} size="lg" testId="bonus-detail-badge" />
        {b.amount && <span className="rounded-md bg-accent/10 px-2 py-1 font-mono text-sm font-medium text-accent">{b.amount}</span>}
        {b.deadline && (
          <span className="flex items-center gap-1 rounded-md bg-white/[0.06] px-2 py-1 text-sm text-muted">
            <CalendarClock className="size-3.5" /> {b.deadline}
          </span>
        )}
        {!isLocal && <span className="rounded-md bg-positive/10 px-2 py-1 text-xs font-semibold text-positive">Trovato dalla scansione web</span>}
      </div>

      <p className="mt-4 text-sm leading-relaxed text-muted">{b.summary}</p>

      {profile && match.checks.length > 0 && (
        <div className="mt-5 rounded-xl border border-line bg-white/[0.03] p-4" data-testid="bonus-detail-checks">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-dim">Verifiche sul tuo profilo</p>
          <MatchChecks result={match} />
        </div>
      )}
      {!profile && <MatchFallbackCta />}

      {b.eligibility_reason && (
        <div className="mt-4 rounded-lg border-l-2 border-accent bg-white/[0.03] p-3 text-sm text-muted">
          <span className="font-semibold text-ink">Analisi AI: </span>
          {b.eligibility_reason}
        </div>
      )}

      <div className="mt-5 grid gap-4 text-sm sm:grid-cols-2" data-testid="bonus-detail-requirements">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-dim">Requisiti ({b.requirements.length})</p>
          <ul className="mt-2 list-disc space-y-1 pl-4 text-muted">
            {b.requirements.length === 0 && <li>Nessun requisito dichiarato nel bando.</li>}
            {b.requirements.map((r) => <li key={r}>{r}</li>)}
          </ul>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-dim">Documenti ({b.required_documents.length})</p>
          <ul className="mt-2 list-disc space-y-1 pl-4 text-muted">
            {b.required_documents.length === 0 && <li>Nessun documento dichiarato nel bando.</li>}
            {b.required_documents.map((r) => <li key={r}>{r}</li>)}
          </ul>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-line pt-5">
        {isLocal ? (
          <>
            <Button
              variant={isFavorite ? "default" : "outline"}
              className="h-10"
              onClick={() => fav.mutate(b.id)}
              data-testid="btn-detail-favorite"
            >
              <Heart className={cn("size-4", isFavorite && "fill-current")} />
              {isFavorite ? "Nei preferiti" : "Aggiungi ai preferiti"}
            </Button>
            <Button
              className="h-10"
              disabled={!profile || gen.isPending || match.status === "not_eligible"}
              onClick={() => {
                if (profile) gen.mutate({ bonus: b, profile });
              }}
              data-testid="btn-detail-generate-docs"
            >
              {gen.isPending ? <Loader2 className="size-4 animate-spin" /> : <FileText className="size-4" />}
              {gen.isPending ? "Compilazione…" : hasDocs ? "Rigenera documenti" : "Prepara documenti"}
            </Button>
          </>
        ) : (
          <p className="text-sm text-dim">
            Bando ancora non presente nel catalogo locale: consultalo sul sito ufficiale dell'ente per candidarti.
          </p>
        )}
        {b.source_url && (
          <a
            href={b.source_url}
            target="_blank"
            rel="noreferrer"
            className={cn(
              "ml-auto flex items-center gap-1.5 rounded-lg border border-line bg-white/[0.04] px-3 py-2 text-sm font-medium text-ink transition-colors duration-150 hover:border-accent/40 hover:text-accent",
            )}
            data-testid="btn-detail-source"
          >
            <ExternalLink className="size-4" /> Fonte ufficiale
          </a>
        )}
      </div>
    </div>
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
