import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowRight,
  Building2,
  CalendarClock,
  FileSignature,
  Landmark,
  LogIn,
  Radar,
  Search,
  ShieldCheck,
  Sparkles,
  UserPlus,
} from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useScraperCatalog } from "@/lib/queries";
import { fmtDateTime } from "@/lib/format";

/** Portali ufficiali scansionati dallo scraper (settimanale). */
export const MONITORED_SOURCES: { name: string; scope: string; url: string }[] = [
  { name: "Comune di Genova", scope: "Avvisi e bandi comunali", url: "https://www.comune.genova.it" },
  { name: "Regione Liguria / Filse", scope: "Bandi e avvisi regionali", url: "https://www.regione.liguria.it" },
  { name: "INPS", scope: "Prestazioni e sussidi nazionali", url: "https://www.inps.it" },
  { name: "MIMIT", scope: "Incentivi imprese ed energia", url: "https://www.mimit.gov.it" },
  { name: "Agenzia delle Entrate", scope: "Detrazioni e agevolazioni fiscali", url: "https://www.agenziaentrate.gov.it" },
];

export default function Landing() {
  const [q, setQ] = useState("");
  const nav = useNavigate();
  const { data: catalog } = useScraperCatalog();
  const bonuses = catalog?.bonuses ?? [];

  const preview = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const pool = needle
      ? bonuses.filter((b) =>
          [b.title, b.authority, b.category, b.summary].join(" ").toLowerCase().includes(needle),
        )
      : bonuses;
    return pool.slice(0, 4);
  }, [bonuses, q]);

  return (
    <div className="min-h-svh bg-background">
      {/* Barra superiore */}
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-8">
          <div className="flex items-center gap-2.5" data-testid="landing-brand">
            <span className="grid size-9 place-items-center rounded-lg bg-[#0056B3]">
              <Radar className="size-4.5 text-white" />
            </span>
            <span className="font-heading text-lg font-bold text-slate-900">BonusRadar Italia</span>
          </div>
          <nav className="hidden items-center gap-8 text-sm text-slate-600 md:flex" data-testid="landing-nav">
            <a href="#fonti" className="hover:text-slate-900">Fonti monitorate</a>
            <a href="#registro" className="hover:text-slate-900">Registro scansioni</a>
          </nav>
          <div className="flex items-center gap-2">
            <Link to={`/auth?returnTo=${encodeURIComponent("/dashboard")}`} data-testid="landing-login">
              <Button variant="ghost" size="sm" className="text-slate-700">
                <LogIn className="size-4" /> Accedi
              </Button>
            </Link>
            <Link to={`/auth?returnTo=${encodeURIComponent("/dashboard")}&mode=signup`} data-testid="landing-signup">
              <Button size="sm">Registrati</Button>
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden border-b border-slate-200">
        <div className="bg-grid-paper absolute inset-0" />
        <div className="pointer-events-none absolute -right-28 -top-28 size-96 rounded-full border border-[#0056B3]/15">
          <div className="absolute inset-10 rounded-full border border-[#0056B3]/15" />
          <div className="absolute inset-20 rounded-full border border-[#0056B3]/20" />
          <div
            className="absolute inset-0 rounded-full"
            style={{ background: "conic-gradient(from 0deg, rgba(0,86,179,0.15), transparent 25%)" }}
          />
        </div>

        <div className="relative mx-auto max-w-6xl px-4 py-16 sm:px-8 sm:py-24">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#0056B3]" data-testid="landing-eyebrow">
            Bonus e bandi · Italia
          </p>
          <h1 className="mt-4 max-w-3xl font-heading text-4xl font-bold leading-[1.08] text-slate-900 sm:text-6xl" data-testid="landing-title">
            Tutti i bonus a cui hai diritto,
            <br />
            <span className="text-[#0056B3]">senza perderti nessuno.</span>
          </h1>
          <p className="mt-5 max-w-2xl text-lg text-slate-600" data-testid="landing-subtitle">
            BonusRadar scansiona ogni settimana i portali istituzionali — Comune di Genova, Regione Liguria, INPS, MIMIT,
            Agenzia delle Entrate — filtra i bonus compatibili con il tuo profilo ISEE e prepara le domande precompilate
            pronte per la firma.
          </p>

          {/* Ricerca rapida */}
          <form
            className="mt-8 flex max-w-xl items-center gap-2 rounded-xl border border-slate-300 bg-white p-2 shadow-sm focus-within:border-[#0056B3]"
            onSubmit={(e) => {
              e.preventDefault();
              nav(`/bonus${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ""}`);
            }}
            data-testid="landing-search-form"
          >
            <Search className="ml-2 size-5 shrink-0 text-slate-400" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Cerca un bonus: nido, casa, ISEE, energia…"
              className="h-11 border-0 bg-transparent shadow-none focus-visible:ring-0"
              aria-label="Ricerca rapida bonus"
              data-testid="landing-search-input"
            />
            <Button type="submit" className="h-11 shrink-0 px-5" data-testid="landing-search-submit">
              Cerca <ArrowRight className="size-4" />
            </Button>
          </form>

          {preview.length > 0 && (
            <div className="mt-4 max-w-xl rounded-xl border border-slate-200 bg-white/90 p-2 backdrop-blur" data-testid="landing-search-preview">
              {preview.map((b) => (
                <Link
                  key={b.id}
                  to={`/bonus?q=${encodeURIComponent(b.title)}`}
                  className="flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm transition-colors duration-150 hover:bg-[#F5F9FE]"
                >
                  <span className="truncate font-medium text-slate-800">{b.title}</span>
                  <span className="shrink-0 rounded-full bg-[#E8F0FA] px-2 py-0.5 text-xs font-medium text-[#0056B3]">{b.authority}</span>
                </Link>
              ))}
              <p className="px-3 pb-1 pt-1 text-xs text-slate-400">Anteprima dell'ultima scansione — accedi per la valutazione completa.</p>
            </div>
          )}

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
        </div>
      </section>

      {/* Come funziona */}
      <section className="mx-auto max-w-6xl px-4 py-14 sm:px-8">
        <h2 className="font-heading text-2xl font-bold text-slate-900 sm:text-3xl" data-testid="landing-how-title">
          Come funziona
        </h2>
        <div className="mt-6 grid gap-4 md:grid-cols-3">
          {[
            {
              icon: Radar,
              title: "1 · Radar settimanale",
              text: "Lo scraper analizza i portali istituzionali e aggiorna il catalogo con i nuovi bandi.",
            },
            {
              icon: FileSignature,
              title: "2 · Profilo & compatibilità",
              text: "Con ISEE, nucleo familiare e residenza calcoliamo a quali bonus puoi accedere davvero.",
            },
            {
              icon: CalendarClock,
              title: "3 · Domande pronte",
              text: "Le pratiche vengono precompilate in PDF e Word, con scadenze e allegati sempre sott'occhio.",
            },
          ].map((s) => (
            <article key={s.title} className="rounded-xl border border-slate-200 bg-white p-6 animate-rise" data-testid="landing-how-card">
              <span className="grid size-10 place-items-center rounded-lg bg-[#E8F0FA]">
                <s.icon className="size-5 text-[#0056B3]" />
              </span>
              <h3 className="mt-4 font-heading text-lg font-bold text-slate-900">{s.title}</h3>
              <p className="mt-1.5 text-sm text-slate-600">{s.text}</p>
            </article>
          ))}
        </div>
      </section>

      {/* Fonti & Portali Monitorati */}
      <section id="fonti" className="border-y border-slate-200 bg-white">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:px-8">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#0056B3]">Fonti ufficiali</p>
              <h2 className="mt-2 font-heading text-2xl font-bold text-slate-900 sm:text-3xl" data-testid="landing-sources-title">
                Fonti &amp; Portali Monitorati
              </h2>
              <p className="mt-2 max-w-2xl text-slate-600">
                Aggiornamento diretto dalle fonti ufficiali: nessun aggregatore di terze parti, solo bandi verificati sui
                portali delle istituzioni.
              </p>
            </div>
            <span className="rounded-full border border-emerald-200 bg-[#ECFDF5] px-3 py-1 text-xs font-semibold text-[#065F46]">
              Scansione automatica · ogni lunedì
            </span>
          </div>

          <ul className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="landing-sources-list">
            {MONITORED_SOURCES.map((s) => (
              <li key={s.name} className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4" data-testid="landing-source-card">
                <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-slate-100">
                  {s.name.includes("Regione") ? <Building2 className="size-5 text-slate-600" /> : <Landmark className="size-5 text-slate-600" />}
                </span>
                <div className="min-w-0">
                  <a href={s.url} target="_blank" rel="noreferrer" className="font-medium text-slate-900 hover:text-[#0056B3] hover:underline">
                    {s.name}
                  </a>
                  <p className="text-sm text-slate-500">{s.scope}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Anteprima registro scansioni */}
      <section id="registro" className="mx-auto max-w-6xl px-4 py-14 sm:px-8">
        <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
          <div className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8" data-testid="landing-scan-card">
            <div className="flex items-center gap-2">
              <span className="size-2.5 rounded-full bg-emerald-400" />
              <h2 className="font-heading text-xl font-bold text-slate-900">Registro scansioni</h2>
            </div>
            <p className="mt-3 text-sm text-slate-600" data-testid="landing-last-scan">
              Ultima scansione automatica:{" "}
              <span className="font-mono font-semibold text-slate-900">{fmtDateTime(catalog?.generated_at ?? null)}</span>
            </p>
            <dl className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3">
              <div className="rounded-xl bg-slate-50 p-4">
                <dd className="font-heading text-3xl font-bold text-[#0056B3]" data-testid="landing-stat-count">{catalog?.count ?? bonuses.length}</dd>
                <dt className="mt-1 text-xs font-semibold uppercase tracking-wider text-slate-500">Bonus nel catalogo</dt>
              </div>
              <div className="rounded-xl bg-slate-50 p-4">
                <dd className="font-heading text-3xl font-bold text-slate-900">{MONITORED_SOURCES.length}</dd>
                <dt className="mt-1 text-xs font-semibold uppercase tracking-wider text-slate-500">Portali monitorati</dt>
              </div>
              <div className="rounded-xl bg-slate-50 p-4">
                <dd className="font-heading text-3xl font-bold text-slate-900">7 gg</dd>
                <dt className="mt-1 text-xs font-semibold uppercase tracking-wider text-slate-500">Frequenza scansione</dt>
              </div>
            </dl>
            <div className="mt-5 rounded-xl bg-[#0F172A] p-4 font-mono text-xs text-slate-300" data-testid="landing-scan-log">
              <p className="text-slate-400">[scraper] esecuzione schedulata · GitHub Actions</p>
              <p className="text-slate-400">[scraper] fonti: comune.genova.it · regione.liguria.it · inps.it · mimit.gov.it · agenziaentrate.gov.it</p>
              <p className="text-emerald-400">[scraper] catalogo aggiornato: {catalog?.count ?? bonuses.length} bonus</p>
            </div>
          </div>

          <aside className="flex flex-col justify-center rounded-2xl bg-[#0056B3] p-6 text-white sm:p-8" data-testid="landing-scan-cta">
            <ShieldCheck className="size-8" />
            <h3 className="mt-4 font-heading text-2xl font-bold leading-snug">
              Accedi per lo storico completo
            </h3>
            <p className="mt-2 text-sm text-sky-100">
              Dentro l'app trovi lo storico dettagliato di ogni scansione, le scadenze imminenti dei tuoi bonus e le
              pratiche pronte da firmare.
            </p>
            <Link to={`/auth?returnTo=${encodeURIComponent("/dashboard")}`} data-testid="landing-scan-cta-button" className="mt-6 w-fit">
              <Button variant="secondary" size="lg" className="bg-white text-[#0056B3] hover:bg-sky-50">
                Accedi ora <ArrowRight className="size-4" />
              </Button>
            </Link>
          </aside>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-4 py-8 text-sm text-slate-500 sm:flex-row sm:px-8">
          <div className="flex items-center gap-2">
            <span className="grid size-7 place-items-center rounded-md bg-[#0056B3]">
              <Radar className="size-3.5 text-white" />
            </span>
            <span className="font-heading font-bold text-slate-900">BonusRadar Italia</span>
          </div>
          <p>Indipendente dalle istituzioni: verifica sempre i bandi sui portali ufficiali.</p>
          <Link to="/auth" className={buttonVariants({ variant: "link", size: "sm" })} data-testid="landing-footer-login">
            Accedi / Registrati
          </Link>
        </div>
      </footer>
    </div>
  );
}
