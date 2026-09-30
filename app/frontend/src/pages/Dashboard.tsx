import { useMemo } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  FileSignature,
  Heart,
  Radar,
  Sparkles,
  UserCheck,
} from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Button } from "@/components/ui/button";
import { MatchBadge } from "@/components/match";
import { calculateBonusMatch } from "@/lib/matching";
import { useBonuses, useDashboard, useProfile, useScanStatus } from "@/lib/queries";
import { fmtDate, fmtDateTime } from "@/lib/format";
import type { Bonus, Profile as UserProfile } from "@/lib/types";
import { cn } from "@/lib/utils";

export default function Dashboard() {
  const { data: d } = useDashboard();
  const { data: scan } = useScanStatus();
  const { data: bonuses } = useBonuses(false);
  const { data: profile } = useProfile();

  /** Matching profilo ↔ catalogo, calcolato una sola volta. */
  const matches = useMemo(() => {
    const map = new Map<string, ReturnType<typeof calculateBonusMatch>>();
    for (const b of bonuses ?? []) map.set(b.id, calculateBonusMatch((profile ?? null) as UserProfile | null, b));
    return map;
  }, [bonuses, profile]);

  const eligibleCount = useMemo(
    () => [...matches.values()].filter((m) => m.status === "eligible").length,
    [matches],
  );

  // In evidenza: prima gli idonei, poi i "da verificare", ordinati per affinità.
  const top = useMemo(() => {
    const pool = (bonuses ?? []).filter((b) => {
      const s = matches.get(b.id)?.status;
      return s === "eligible" || s === "maybe";
    });
    const sorted = pool.sort((a, b) => (matches.get(b.id)?.score ?? 0) - (matches.get(a.id)?.score ?? 0));
    if (sorted.length > 0) return sorted.slice(0, 4);
    return (bonuses ?? []).slice(0, 4); // senza profilo: mostra comunque gli ultimi inseriti
  }, [bonuses, matches]);

  const running = scan?.running ?? false;

  return (
    <div>
      <section className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-6 sm:p-10 animate-rise">
        <div className="bg-grid-paper absolute inset-0" />
        <div className="pointer-events-none absolute -right-24 -top-24 size-80 rounded-full border border-[#0056B3]/15">
          <div className="absolute inset-8 rounded-full border border-[#0056B3]/15" />
          <div className="absolute inset-16 rounded-full border border-[#0056B3]/20" />
          <div
            className={cn("absolute inset-0 rounded-full", running && "animate-radar")}
            style={{ background: "conic-gradient(from 0deg, rgba(0,86,179,0.18), transparent 25%)" }}
          />
        </div>
        <div className="relative max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#0056B3]">
            {d?.profile_name ? `Buongiorno, ${d.profile_name.split(" ")[0]}` : "Benvenuto in BonusRadar"}
          </p>
          <h1 className="mt-3 text-4xl font-bold leading-[1.05] text-slate-900 sm:text-5xl" data-testid="dashboard-title">
            La tua panoramica:
            <br />
            <span className="text-[#0056B3]">pratiche, preferiti, scadenze.</span>
          </h1>
          <p className="mt-4 text-slate-600">
            Confrontiamo ogni settimana i requisiti dei bandi con il tuo profilo: qui trovi i bonus più compatibili, i
            preferiti e le scadenze imminenti.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            {d && !d.has_profile ? (
              <Link to="/profile" className={buttonVariants({ size: "lg" })} data-testid="cta-start-questionnaire">
                <UserCheck className="size-4" /> Completa il tuo profilo
              </Link>
            ) : (
              <Link to="/bonus" className={buttonVariants({ size: "lg" })} data-testid="cta-view-bonus">
                <Sparkles className="size-4" /> Vedi i miei bonus
              </Link>
            )}
            <Link to="/profile" data-testid="cta-goto-profile">
              <Button variant="outline" size="lg">
                <FileSignature className="size-4" /> Profilo &amp; Documenti
              </Button>
            </Link>
          </div>
          {running && (
            <p className="mt-3 font-mono text-xs text-slate-500" data-testid="dashboard-scan-phase">
              {scan?.phase}
            </p>
          )}
        </div>
      </section>

      <section className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat testId="stat-eligible" label="Idonei per te" value={eligibleCount || d?.bonus_eligible} accent="text-[#047857]" icon={CheckCircle2} />
        <Stat testId="stat-favorites" label="Preferiti salvati" value={d?.favorites_total} accent="text-[#B45309]" icon={Heart} />
        <Stat testId="stat-docs-to-sign" label="Documenti da firmare" value={d?.documents_to_sign} accent="text-[#0056B3]" icon={FileSignature} />
        <Stat testId="stat-bonus-total" label="Bonus nel catalogo" value={d?.bonus_total} accent="text-slate-900" icon={Sparkles} />
      </section>

      {!profile && (
        <section className="mt-6" data-testid="dashboard-no-profile-banner">
          <div className="rounded-2xl border border-[#FDE68A] bg-[#FFFBEB] p-4 sm:flex sm:items-center sm:justify-between">
            <p className="text-sm text-[#92400E]">
              Completa il tuo profilo per verificare se hai diritto ai bonus del catalogo: ISEE, residenza e nucleo
              familiare.
            </p>
            <Link to="/profile" className="mt-3 block shrink-0 text-sm font-semibold text-[#0056B3] hover:underline sm:mt-0" data-testid="dashboard-link-profile">
              Completa il profilo →
            </Link>
          </div>
        </section>
      )}

      <section className="mt-8 grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-xl font-bold">In evidenza per te</h2>
            <Link to="/bonus" className="flex items-center gap-1 text-sm text-[#0056B3] hover:underline" data-testid="link-all-bonus">
              Tutto il catalogo <ArrowRight className="size-4" />
            </Link>
          </div>
          <div className="flex flex-col gap-2" data-testid="dashboard-top-bonus">
            {top.length === 0 && (
              <div className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-500">
                Catalogo in aggiornamento: torna tra poco.
              </div>
            )}
            {top.map((b) => (
              <BonusMatchRow
                key={b.id}
                bonus={b}
                match={matches.get(b.id) ?? calculateBonusMatch((profile ?? null) as UserProfile | null, b)}
              />
            ))}
          </div>
        </div>
        <div className="rounded-xl bg-[#0F172A] p-5 text-slate-100" data-testid="dashboard-scan-log">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Registro scansione</p>
          <p className="mt-1 text-sm">Ultima: {fmtDateTime(d?.last_scan_at ?? scan?.last_run_at)}</p>
          <div className="mt-4 max-h-64 space-y-1 overflow-auto font-mono text-xs text-slate-300">
            {(scan?.log ?? []).length === 0 && <p className="text-slate-500">Catalogo aggiornato settimanalmente dallo scraper.</p>}
            {(scan?.log ?? []).slice(-12).map((l, i) => (
              <p key={i}>{l}</p>
            ))}
          </div>
        </div>
      </section>

      {/* Preferiti con matching */}
      <section className="mt-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xl font-bold">I tuoi preferiti</h2>
          <Link to="/bonus" className="flex items-center gap-1 text-sm text-[#0056B3] hover:underline" data-testid="link-favorites-bonus">
            Gestisci nel catalogo <ArrowRight className="size-4" />
          </Link>
        </div>
        <div className="flex flex-col gap-2" data-testid="dashboard-favorites">
          {(d?.favorite_bonuses ?? []).length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-500">
              Nessun preferito salvato: nel catalogo premi l'icona ♥ sui bonus che ti interessano.
            </div>
          ) : (
            d?.favorite_bonuses.map((b) => (
              <BonusMatchRow
                key={b.id}
                bonus={b}
                match={matches.get(b.id) ?? calculateBonusMatch((profile ?? null) as UserProfile | null, b)}
              />
            ))
          )}
        </div>
      </section>

      {/* Scadenze imminenti */}
      <section className="mt-8">
        <h2 className="text-xl font-bold">Scadenze imminenti</h2>
        <div className="mt-3 flex flex-col gap-2" data-testid="dashboard-deadlines">
          {(d?.upcoming_deadlines ?? []).length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-500">
              Nessuna scadenza entro 60 giorni con data dichiarata dai bandi.
            </div>
          ) : (
            d?.upcoming_deadlines.map((b) => (
              <Link
                key={b.id}
                to="/bonus"
                className="flex items-center gap-4 rounded-xl border border-slate-200 bg-white p-4 transition-[transform,border-color] duration-200 hover:-translate-y-0.5 hover:border-slate-400"
                data-testid={`dashboard-deadline-${b.id}`}
              >
                <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-[#FFFBEB]">
                  <CalendarClock className="size-5 text-[#B45309]" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-slate-900">{b.title}</p>
                  <p className="text-sm text-slate-500">{b.authority}</p>
                </div>
                <span className="shrink-0 rounded-full border border-[#FDE68A] bg-[#FFFBEB] px-2.5 py-0.5 text-xs font-semibold text-[#92400E]">
                  entro {fmtDate(b.deadline)}
                </span>
              </Link>
            ))
          )}
        </div>
      </section>
    </div>
  );
}

/** Riga bonus con badge di matching e verifica rapida (dashboard). */
function BonusMatchRow({ bonus: b, match }: { bonus: Bonus; match: ReturnType<typeof calculateBonusMatch> }) {
  return (
    <Link
      to="/bonus"
      className="group flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-4 transition-[transform,border-color] duration-200 hover:-translate-y-0.5 hover:border-slate-400"
      data-testid={`dashboard-bonus-${b.id}`}
    >
      <div className="min-w-0">
        <p className="truncate font-medium text-slate-900">{b.title}</p>
        <p className="truncate text-sm text-slate-500">
          {b.authority}
          {match.checks.length > 0 && (
            <span className="ml-2 hidden text-xs text-slate-400 sm:inline">
              · {match.checks[0].label}
            </span>
          )}
        </p>
      </div>
      <MatchBadge result={match} />
    </Link>
  );
}

function Stat({
  label,
  value,
  accent,
  icon: Icon,
  testId,
}: {
  label: string;
  value: number | undefined;
  accent: string;
  icon: typeof Radar;
  testId: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{label}</p>
        <Icon className="size-4 text-slate-400" />
      </div>
      <p className={cn("mt-3 font-heading text-3xl font-bold", accent)} data-testid={testId}>
        {value ?? "—"}
      </p>
    </div>
  );
}
