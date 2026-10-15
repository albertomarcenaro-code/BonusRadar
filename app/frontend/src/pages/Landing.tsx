import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowDown,
  ArrowRight,
  Building2,
  CheckCircle2,
  Landmark,
  LogIn,
  Radar,
  Search,
  Sparkles,
  UserPlus,
} from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Reveal } from "@/components/Reveal";
import LiveScan, { demoMatches } from "@/pages/LiveScan";
import { MatchBadge, MatchChecks } from "@/components/match";
import { useScraperCatalog } from "@/lib/queries";
import { fmtDateTime, fmtDate } from "@/lib/format";
import { usePrefersReducedMotion, useScrollProgress } from "@/hooks/motion";
import { cn } from "@/lib/utils";

/** Portali ufficiali scansionati dallo scraper (settimanale). */
export const MONITORED_SOURCES: { name: string; scope: string; url: string }[] = [
  { name: "Comune di Genova", scope: "Avvisi e bandi comunali", url: "https://www.comune.genova.it" },
  { name: "Regione Liguria / Filse", scope: "Bandi e avvisi regionali", url: "https://www.regione.liguria.it" },
  { name: "INPS", scope: "Prestazioni e sussidi nazionali", url: "https://www.inps.it" },
  { name: "MIMIT", scope: "Incentivi imprese ed energia", url: "https://www.mimit.gov.it" },
  { name: "Agenzia delle Entrate", scope: "Detrazioni e agevolazioni fiscali", url: "https://www.agenziaentrate.gov.it" },
];

/** Hostname leggibile per la griglia fonti (es. "comune.genova.it"). */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Sezioni della storytelling (ordine = Parte 2.1, 4 chiare + 4 scure). */
const RAIL = [
  { id: "hero", label: "Radar" },
  { id: "problema", label: "Problema" },
  { id: "metodo", label: "Metodo" },
  { id: "scansione", label: "Scansione" },
  { id: "profilo", label: "Profilo" },
  { id: "fonti", label: "Fonti" },
  { id: "registro", label: "Registro" },
  { id: "inizia", label: "Inizia" },
];

export default function Landing() {
  const [q, setQ] = useState("");
  const [params] = useSearchParams();
  const nav = useNavigate();
  const reduced = usePrefersReducedMotion();
  const progress = useScrollProgress();
  const { data: catalog } = useScraperCatalog();
  // Memoizzato: un `?? []` inline creerebbe un array nuovo a ogni render e
  // invaliderebbe i useMemo dipendenti da `bonuses`.
  const bonuses = useMemo(() => catalog?.bonuses ?? [], [catalog]);

  // Ricerca: il valore iniziale arriva da ?q=
  useEffect(() => {
    setQ(params.get("q") ?? "");
  }, [params]);

  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Scroll-spy del rail: la sezione attiva è quella al centro del viewport
  const [active, setActive] = useState("hero");
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const els = RAIL.map((r) => document.getElementById(r.id)).filter((el): el is HTMLElement => el !== null);
    if (els.length === 0) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setActive(e.target.id);
      },
      { rootMargin: "-45% 0px -45% 0px" },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  const preview = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return [];
    return bonuses
      .filter((b) => [b.title, b.authority, b.category, b.summary].join(" ").toLowerCase().includes(needle))
      .slice(0, 4);
  }, [bonuses, q]);

  const profileMatches = useMemo(() => demoMatches(bonuses, 3), [bonuses]);

  return (
    <div className="min-h-svh bg-canvas text-ink">
      {/* ================= HEADER FISSO ================= */}
      <header
        className={cn(
          "fixed inset-x-0 top-0 z-50 transition-all duration-300",
          scrolled ? "border-b border-white/10 bg-[#04060d]/85 backdrop-blur-xl" : "border-b border-transparent",
        )}
        data-testid="landing-header"
      >
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4 sm:px-8">
          <a href="#hero" className="flex items-center gap-2.5" data-testid="landing-brand">
            <span className="grid size-9 place-items-center rounded-lg bg-[linear-gradient(180deg,#22d3ee,#2f6bff)]">
              <Radar className="size-4.5 text-[#03121b]" />
            </span>
            <span className="font-display text-lg font-bold tracking-tight text-ink">BonusRadar</span>
          </a>
          <nav className="hidden items-center gap-8 text-sm text-muted md:flex" data-testid="landing-nav">
            <a href="#scansione" className="transition-colors hover:text-accent">Scansione</a>
            <a href="#fonti" className="transition-colors hover:text-accent">Fonti</a>
            <a href="#registro" className="transition-colors hover:text-accent">Registro</a>
          </nav>
          <div className="flex items-center gap-2">
            <Link to={`/auth?returnTo=${encodeURIComponent("/dashboard")}`} data-testid="landing-login">
              <Button variant="ghost" size="sm">
                <LogIn className="size-4" /> Accedi
              </Button>
            </Link>
            <Link to={`/auth?returnTo=${encodeURIComponent("/dashboard")}&mode=signup`} data-testid="landing-signup">
              <Button size="sm">Registrati</Button>
            </Link>
          </div>
        </div>
        {/* Barra di progresso di lettura */}
        <div className="h-px w-full bg-white/5">
          <div
            className="h-px bg-[linear-gradient(90deg,#22d3ee,#2f6bff)] transition-[width] duration-150"
            style={{ width: `${progress * 100}%` }}
            data-testid="landing-progress"
          />
        </div>
      </header>

      {/* ================= RAIL SEZIONI (destro) ================= */}
      <nav
        aria-label="Sezioni della pagina"
        className="fixed right-5 top-1/2 z-40 hidden -translate-y-1/2 flex-col items-end gap-3 xl:flex"
        data-testid="landing-rail"
      >
        {RAIL.map((s) => {
          const on = active === s.id;
          return (
            <a
              key={s.id}
              href={`#${s.id}`}
              className="group flex items-center gap-3"
              aria-current={on ? "true" : undefined}
            >
              <span
                className={cn(
                  "text-[0.6875rem] font-semibold uppercase tracking-[0.16em] transition-all duration-300",
                  on ? "text-accent opacity-100" : "text-dim opacity-0 group-hover:opacity-70",
                )}
              >
                {s.label}
              </span>
              <span
                className={cn(
                  "rounded-full transition-all duration-300",
                  on ? "h-6 w-[6px] bg-accent shadow-[0_0_10px_rgba(34,211,238,0.8)]" : "h-[1.5px] w-4 bg-white/25",
                )}
              />
            </a>
          );
        })}
      </nav>

      {/* ================= SLIDE 1 · HERO (DARK) ================= */}
      <section id="hero" className="slide section-dark pt-28" data-testid="landing-hero">
        <div className="grid-fade pointer-events-none absolute inset-0" />
        {/* Orbe radar in parallasse a destra */}
        <div
          className={cn(
            "pointer-events-none absolute -right-24 top-1/2 hidden size-[26rem] -translate-y-1/2 lg:block",
            !reduced && "parallax-slow",
          )}
          aria-hidden="true"
        >
          <div className="absolute inset-0 rounded-full border border-accent/20" />
          <div className="absolute inset-[12%] rounded-full border border-accent/15" />
          <div className="absolute inset-[26%] rounded-full border border-accent/10" />
          <div className="absolute inset-0 overflow-hidden rounded-full">
            <div className="radar-sweep absolute inset-0 opacity-60" />
          </div>
          <span className="absolute left-[58%] top-[30%] size-2 animate-pulse rounded-full bg-accent shadow-[0_0_10px_rgba(34,211,238,0.9)]" />
          <span className="absolute left-[34%] top-[62%] size-1.5 animate-pulse rounded-full bg-positive" />
        </div>

        <div className="relative mx-auto w-full max-w-6xl px-4 sm:px-8">
          <Reveal>
            <span className="chip" data-testid="landing-eyebrow">
              <span className="size-1.5 animate-pulse-dot rounded-full bg-positive" />
              Bonus e bandi · Italia
            </span>
          </Reveal>

          <Reveal delay={90}>
            <h1
              className="mt-6 max-w-3xl font-display text-4xl font-bold leading-[1.06] text-ink sm:text-6xl"
              data-testid="landing-title"
            >
              Tutti i bonus a cui hai diritto,
              <br />
              <span className="text-gradient">senza perderti nessuno.</span>
            </h1>
          </Reveal>

          <Reveal delay={180}>
            <p className="mt-6 max-w-2xl text-lg leading-relaxed text-muted" data-testid="landing-subtitle">
              BonusRadar scansiona ogni settimana i portali istituzionali — Comune di Genova, Regione Liguria, INPS,
              MIMIT, Agenzia delle Entrate — filtra i bonus compatibili con il tuo profilo ISEE e prepara le domande
              precompilate pronte per la firma.
            </p>
          </Reveal>

          {/* Ricerca rapida + anteprima da ?q= */}
          <Reveal delay={260}>
            <form
              className="panel mt-8 flex max-w-xl items-center gap-2 rounded-xl p-2"
              onSubmit={(e) => {
                e.preventDefault();
                nav(`/bonus${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ""}`);
              }}
              data-testid="landing-search-form"
            >
              <Search className="ml-2 size-5 shrink-0 text-dim" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Cerca un bonus: nido, casa, ISEE, energia…"
                className="h-9 border-0 bg-transparent px-1 focus-visible:ring-0"
                aria-label="Ricerca rapida bonus"
                data-testid="landing-search-input"
              />
              <Button type="submit" className="h-9 shrink-0 px-5" data-testid="landing-search-submit">
                Cerca <ArrowRight className="size-4" />
              </Button>
            </form>

            {preview.length > 0 && (
              <div className="panel mt-3 max-w-xl rounded-xl p-2" data-testid="landing-search-preview">
                {preview.map((b) => (
                  <Link
                    key={b.id}
                    to={`/bonus?q=${encodeURIComponent(b.title)}`}
                    className="flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm transition-colors duration-150 hover:bg-white/[0.05]"
                  >
                    <span className="truncate font-medium text-ink">{b.title}</span>
                    <span className="shrink-0 rounded-full bg-accent/10 px-2 py-0.5 text-xs font-medium text-accent">
                      {b.authority}
                    </span>
                  </Link>
                ))}
                <p className="px-3 pb-1 pt-1 text-xs text-dim">
                  Anteprima dell'ultima scansione — accedi per la valutazione completa.
                </p>
              </div>
            )}
          </Reveal>

          {/* CTA finali dello hero: qui la slide termina (niente statistiche) */}
          <Reveal delay={340}>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link to={`/auth?returnTo=${encodeURIComponent("/dashboard")}&mode=signup`} data-testid="landing-cta-signup">
                <Button size="lg">
                  <UserPlus className="size-4" /> Crea il tuo profilo
                </Button>
              </Link>
              <Link to="/bonus" data-testid="landing-cta-catalog">
                <Button variant="outline" size="lg">
                  <Sparkles className="size-4" /> Esplora il catalogo
                </Button>
              </Link>
            </div>
          </Reveal>
        </div>

        {/* Indicatore "Scorri" */}
        <a
          href="#problema"
          className="absolute bottom-6 left-1/2 flex -translate-x-1/2 flex-col items-center gap-1.5 text-[0.6875rem] uppercase tracking-[0.22em] text-dim transition-colors hover:text-accent"
          data-testid="landing-scroll-indicator"
        >
          Scorri
          <ArrowDown className={cn("size-4", !reduced && "animate-bounce")} />
        </a>
      </section>

      {/* ================= SLIDE 2 · PROBLEMA (LIGHT) ================= */}
      <section id="problema" className="slide-compact section-light" data-testid="landing-problema">
        <div className="mx-auto w-full max-w-6xl px-4 sm:px-8">
          <div className="grid items-center gap-10 lg:grid-cols-[1.3fr_1fr]">
            <div>
              <Reveal>
                <p className="eyebrow">Il problema</p>
              </Reveal>
              <Reveal delay={90}>
                <h2 className="mt-4 font-display text-3xl font-bold leading-[1.1] text-ink sm:text-5xl">
                  Ogni anno lasci sul tavolo migliaia di euro di bandi a cui hai già diritto.
                </h2>
              </Reveal>
              <Reveal delay={180}>
                <p className="mt-5 max-w-2xl text-lg leading-relaxed text-muted">
                  I bandi nascono su gare diverse, con scadenze diverse e linguaggi tecnici. Nessuno li raccoglie in un
                  posto solo: cercarli uno a uno richiede ore, e quasi sempre arrivi tardi.
                </p>
              </Reveal>
            </div>
            <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-1">
              {[
                { value: "1.000+", label: "bandi pubblicati ogni anno tra i portali monitorati" },
                { value: "5", label: "portali istituzionali scansionati a ogni ciclo" },
                { value: "~30′", label: "tempo medio perso a cercarli a mano, ogni volta" },
              ].map((f, i) => (
                <Reveal key={f.value} delay={i * 100}>
                  <div className="panel flex items-baseline gap-4 px-5 py-4 sm:flex-col sm:items-start sm:gap-1">
                    <span className="font-display text-4xl font-bold text-accent">{f.value}</span>
                    <span className="text-sm text-muted">{f.label}</span>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ================= SLIDE 3 · METODO (LIGHT) ================= */}
      <section id="metodo" className="slide-compact section-light" data-testid="landing-metodo">
        <div className="mx-auto w-full max-w-6xl px-4 sm:px-8">
          <Reveal>
            <p className="eyebrow">Il metodo</p>
          </Reveal>
          <Reveal delay={90}>
            <h2 className="mt-4 max-w-3xl font-display text-3xl font-bold leading-[1.1] text-ink sm:text-5xl" data-testid="landing-how-title">
              Tre passaggi. Nessun modulo da interpretare.
            </h2>
          </Reveal>
          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {[
              {
                n: "01",
                title: "Radar settimanale",
                text: "Lo scraper rilegge i portali istituzionali, deduplica gli avvisi e verifica le scadenze: il catalogo si aggiorna da solo ogni lunedì.",
              },
              {
                n: "02",
                title: "Profilo & compatibilità",
                text: "ISEE, nucleo familiare, residenza e condizione lavorativa diventano un filtro: vedi solo i bonus per cui sei davvero idoneo.",
              },
              {
                n: "03",
                title: "Ti prepara i documenti compilati",
                text: "La domanda viene generata in PDF e Word già compilata con i tuoi dati, con scadenze e allegati sempre sott'occhio.",
              },
            ].map((s, i) => (
              <Reveal key={s.n} delay={i * 100}>
                <article className="panel interactive h-full rounded-2xl p-6" data-testid="landing-how-card">
                  <span className="font-mono text-sm font-semibold tracking-[0.2em] text-accent">{s.n}</span>
                  <h3 className="mt-3 font-display text-lg font-bold text-ink">{s.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted">{s.text}</p>
                </article>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ================= SLIDE 4 · SCANSIONE (DARK — live scan) ================= */}
      <section id="scansione" className="slide section-dark" data-testid="landing-scansione">
        <div className="mx-auto w-full max-w-6xl px-4 sm:px-8">
          <div className="mb-8 max-w-3xl">
            <Reveal>
              <h2 className="font-display text-3xl font-bold leading-[1.1] text-ink sm:text-5xl" data-testid="landing-scan-title">
                Il radar che non dorme:
                <br />
                <span className="text-gradient">scansione in tempo reale.</span>
              </h2>
            </Reveal>
            <Reveal delay={100}>
              <p className="mt-4 max-w-2xl text-lg leading-relaxed text-muted">
                Ogni lunedì il terminale parte da solo: cinque portali, deduplica, scadenze, confronto con il profilo.
                Qui sotto lo vedi girare.
              </p>
            </Reveal>
          </div>
          <Reveal delay={160}>
            <LiveScan bonuses={bonuses} />
          </Reveal>
        </div>
      </section>

      {/* ================= SLIDE 5 · PROFILO (LIGHT) ================= */}
      <section id="profilo" className="slide section-light" data-testid="landing-profilo">
        <div className="mx-auto w-full max-w-6xl px-4 sm:px-8">
          <div className="grid items-start gap-10 lg:grid-cols-[0.9fr_1.1fr]">
            <div className="min-w-0">
              <Reveal>
                <h2 className="font-display text-3xl font-bold leading-[1.1] text-ink sm:text-5xl">
                  Il tuo profilo diventa un filtro intelligente.
                </h2>
              </Reveal>
              <Reveal delay={90}>
                <p className="mt-4 text-lg leading-relaxed text-muted">
                  Compili il profilo una volta sola: da quel momento ogni bando viene valutato contro i tuoi dati reali.
                </p>
              </Reveal>
              <div className="mt-8 grid grid-cols-2 gap-3">
                {[
                  { k: "ISEE", v: "18.500 €", d: "soglia di accesso a quasi tutti i bonus" },
                  { k: "Nucleo", v: "3 persone · 1 figlio", d: "componenti e carichi a carico" },
                  { k: "Residenza", v: "Genova · Liguria", d: "comunale e regionale" },
                  { k: "Lavoro", v: "Dipendente", d: "condizione occupazionale" },
                ].map((f, i) => (
                  <Reveal key={f.k} delay={i * 90}>
                    <div className="panel-sub h-full px-4 py-3.5">
                      <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.16em] text-dim">{f.k}</p>
                      <p className="mt-1 font-display text-base font-bold text-ink">{f.v}</p>
                      <p className="mt-0.5 text-xs text-muted">{f.d}</p>
                    </div>
                  </Reveal>
                ))}
              </div>
            </div>

            <div className="min-w-0 flex flex-col gap-3">
              {profileMatches.map(({ bonus, result }, i) => (
                <Reveal key={bonus.id} delay={i * 100}>
                  <article className="panel interactive rounded-2xl p-5" data-testid="landing-profile-card">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-ink">{bonus.title}</p>
                        <p className="mt-0.5 text-sm text-muted">{bonus.authority} · {bonus.amount}</p>
                      </div>
                      <MatchBadge result={result} />
                    </div>
                    <MatchChecks result={result} className="mt-3" />
                  </article>
                </Reveal>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ================= SLIDE 6 · FONTI (LIGHT) ================= */}
      <section id="fonti" className="slide-compact section-light" data-testid="landing-fonti">
        <div className="mx-auto w-full max-w-6xl px-4 sm:px-8">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <Reveal>
                <p className="eyebrow">Fonti ufficiali</p>
              </Reveal>
              <Reveal delay={80}>
                <h2 className="mt-3 font-display text-3xl font-bold leading-[1.1] text-ink sm:text-5xl" data-testid="landing-sources-title">
                  Fonti &amp; Portali Monitorati
                </h2>
              </Reveal>
              <Reveal delay={140}>
                <p className="mt-3 max-w-2xl text-lg text-muted">
                  Aggiornamento diretto dalle fonti ufficiali: nessun aggregatore di terze parti, solo bandi verificati
                  sui portali delle istituzioni.
                </p>
              </Reveal>
            </div>
            <Reveal delay={180}>
              <span className="chip !border-positive/40 !bg-positive/10 !text-positive">
                <span className="size-1.5 animate-pulse-dot rounded-full bg-positive" />
                Scansione automatica · ogni lunedì
              </span>
            </Reveal>
          </div>

          <ul className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="landing-sources-list">
            {MONITORED_SOURCES.map((s, i) => (
              <li key={s.name}>
                <Reveal delay={i * 90}>
                  <div className="panel interactive flex h-full items-start gap-3 rounded-2xl p-5" data-testid="landing-source-card">
                    <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-accent/10">
                      {s.name.includes("Regione") ? (
                        <Building2 className="size-5 text-accent" />
                      ) : (
                        <Landmark className="size-5 text-accent" />
                      )}
                    </span>
                    <div className="min-w-0">
                      <a
                        href={s.url}
                        target="_blank"
                        rel="noreferrer"
                        className="font-semibold text-ink hover:text-accent hover:underline"
                      >
                        {s.name}
                      </a>
                      <p className="text-sm text-muted">{s.scope}</p>
                      <p className="mt-1 font-mono text-xs text-dim">{hostOf(s.url)}</p>
                    </div>
                  </div>
                </Reveal>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ================= SLIDE 7 · REGISTRO (DARK) ================= */}
      <section id="registro" className="slide section-dark" data-testid="landing-registro">
        <div className="mx-auto w-full max-w-6xl px-4 sm:px-8">
          <Reveal>
            <span className="chip">
              <span className="size-1.5 rounded-full bg-accent shadow-[0_0_8px_rgba(34,211,238,0.9)]" />
              Sistema operativo
            </span>
          </Reveal>
          <Reveal delay={80}>
            <h2 className="mt-4 font-display text-3xl font-bold leading-[1.1] text-ink sm:text-5xl" data-testid="landing-scan-card-title">
              Registro scansioni
            </h2>
          </Reveal>
          <Reveal delay={140}>
            <p className="mt-3 text-sm text-muted" data-testid="landing-last-scan">
              Ultima scansione automatica:{" "}
              <span className="font-mono font-semibold text-ink">{fmtDateTime(catalog?.generated_at ?? null)}</span>
            </p>
          </Reveal>

          <div className="mt-8 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
            <div className="flex flex-col gap-6">
              {/* Statistiche del registro */}
              <div className="grid grid-cols-3 gap-3">
                {[
                  { v: String(catalog?.count ?? bonuses.length), l: "Bonus nel catalogo", test: "landing-stat-count" },
                  { v: String(MONITORED_SOURCES.length), l: "Portali monitorati", test: "landing-stat-portals" },
                  { v: "7 gg", l: "Frequenza scansione", test: "landing-stat-frequency" },
                ].map((s, i) => (
                  <Reveal key={s.l} delay={i * 90}>
                    <div className="panel-sub px-4 py-4">
                      <dd className="font-display text-2xl font-bold text-accent sm:text-3xl" data-testid={s.test}>
                        {s.v}
                      </dd>
                      <dt className="mt-1 text-[0.6875rem] font-semibold uppercase tracking-wider text-dim">{s.l}</dt>
                    </div>
                  </Reveal>
                ))}
              </div>

              {/* Log dello scraper */}
              <Reveal delay={200}>
                <div className="terminal p-4 font-mono text-xs leading-relaxed sm:text-[0.8125rem]" data-testid="landing-scan-log">
                  <p className="text-dim">[scraper] esecuzione schedulata · GitHub Actions</p>
                  <p className="text-dim">
                    [scraper] fonti: comune.genova.it · regione.liguria.it · inps.it · mimit.gov.it ·
                    agenziaentrate.gov.it
                  </p>
                  <p className="text-dim">[scraper] deduplica avvisi · verifica scadenze</p>
                  <p className="text-positive" data-testid="landing-scan-log-ok">
                    [scraper] catalogo aggiornato: {catalog?.count ?? bonuses.length} bonus
                  </p>
                </div>
              </Reveal>
            </div>

            {/* Aside edge-accent */}
            <Reveal delay={260}>
              <aside
                className="panel edge-accent flex h-full flex-col justify-center rounded-2xl p-6 sm:p-8"
                data-testid="landing-scan-cta"
              >
                <CheckCircle2 className="size-8 text-accent" />
                <h3 className="mt-4 font-display text-2xl font-bold leading-snug text-ink">
                  Accedi per lo storico completo
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">
                  Dentro l'app trovi lo storico dettagliato di ogni scansione, le scadenze imminenti dei tuoi bonus e
                  le pratiche pronte da firmare.
                </p>
                <div className="mt-6 flex flex-wrap gap-3">
                  <Link to={`/auth?returnTo=${encodeURIComponent("/dashboard")}`} data-testid="landing-scan-cta-button">
                    <Button size="lg">
                      Accedi ora <ArrowRight className="size-4" />
                    </Button>
                  </Link>
                  <Link to="/bonus" data-testid="landing-scan-cta-catalog">
                    <Button variant="outline" size="lg">
                      <Sparkles className="size-4" /> Esplora il catalogo
                    </Button>
                  </Link>
                </div>
              </aside>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ================= SLIDE 8 · INIZIA (DARK) + FOOTER ================= */}
      <section id="inizia" className="slide section-dark" data-testid="landing-inizia">
        <div className="mx-auto w-full max-w-6xl px-4 text-center sm:px-8">
          <Reveal>
            <p className="eyebrow">Inizia ora</p>
          </Reveal>
          <Reveal delay={90}>
            <h2 className="mx-auto mt-4 max-w-3xl font-display text-3xl font-bold leading-[1.1] text-ink sm:text-5xl" data-testid="landing-final-title">
              Il prossimo bonus non deve
              <br />
              <span className="text-gradient">passarti accanto.</span>
            </h2>
          </Reveal>
          <Reveal delay={180}>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Link to={`/auth?returnTo=${encodeURIComponent("/dashboard")}&mode=signup`} data-testid="landing-final-cta-signup">
                <Button size="lg">
                  <UserPlus className="size-4" /> Crea il tuo profilo
                </Button>
              </Link>
              <Link to="/bonus" data-testid="landing-final-cta-catalog">
                <Button variant="outline" size="lg">
                  <Sparkles className="size-4" /> Esplora il catalogo
                </Button>
              </Link>
            </div>
          </Reveal>
          <Reveal delay={260}>
            <p className="mt-5 text-sm text-dim">
              Nessuna carta richiesta · i tuoi dati restano nel tuo profilo protetto
            </p>
          </Reveal>
        </div>
      </section>

      <Footer />
    </div>
  );
}

/**
 * Forza il caricamento dell'ultima versione pubblicata scartando
 * l'app-shell in cache (chiave ?v= nuova ad ogni click).
 */
function loadLatestVersion() {
  const url = new URL(window.location.href);
  url.searchParams.set("v", Date.now().toString(36));
  window.location.replace(url.toString());
}

/** Footer: riga principale + pulsante-data minimale (solo la data visibile). */
function Footer() {
  const { data: catalog } = useScraperCatalog();
  const [reloading, setReloading] = useState(false);

  const stamp = catalog?.generated_at ? fmtDate(catalog.generated_at) : null;

  return (
    <footer className="border-t border-line bg-canvas-2/70" data-testid="landing-footer">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 py-8 text-sm sm:flex-row sm:px-8">
        <div className="flex items-center gap-2" data-testid="landing-footer-brand">
          <span className="grid size-7 place-items-center rounded-md bg-[linear-gradient(180deg,#22d3ee,#2f6bff)]">
            <Radar className="size-3.5 text-[#03121b]" />
          </span>
          <span className="font-display font-bold text-ink">BonusRadar</span>
        </div>
        <div className="flex flex-col items-center gap-1.5 text-center">
          <p className="text-muted">
            Indipendente dalle istituzioni: verifica sempre i bandi sui portali ufficiali.
          </p>
          {stamp && (
            <button
              type="button"
              onClick={() => {
                setReloading(true);
                loadLatestVersion();
              }}
              disabled={reloading}
              title="Ricarica la pagina per scaricare l'ultima versione pubblicata"
              aria-label={`Ultimo aggiornamento ${stamp}. Ricarica l'ultima versione.`}
              data-testid="landing-reload"
              className="rounded font-mono text-[0.6875rem] tracking-[0.06em] text-dim/80 underline-offset-4 transition-colors duration-200 hover:text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-60"
            >
              {stamp}
            </button>
          )}
        </div>
        <Link to="/auth" className={buttonVariants({ variant: "link", size: "sm" })} data-testid="landing-footer-login">
          Accedi / Registrati
        </Link>
      </div>
    </footer>
  );
}
