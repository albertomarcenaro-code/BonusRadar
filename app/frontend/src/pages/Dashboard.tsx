import { Link } from "react-router-dom";
import { ArrowRight, CheckCircle2, FileSignature, Globe, Radar, Sparkles, UserCheck } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Button } from "@/components/ui/button";
import { useBonuses, useDashboard, useScanStatus, useTriggerScan } from "@/lib/queries";
import { ELIGIBILITY_CLASS, ELIGIBILITY_LABEL, fmtDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

export default function Dashboard() {
  const { data: d } = useDashboard();
  const { data: scan } = useScanStatus();
  const { data: bonuses } = useBonuses(false);
  const scanMut = useTriggerScan();
  const top = (bonuses ?? []).filter((b) => b.eligibility === "eligible" || b.eligibility === "maybe").slice(0, 4);
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
            I bonus a cui hai diritto,
            <br />
            <span className="text-[#0056B3]">già pronti da firmare.</span>
          </h1>
          <p className="mt-4 text-slate-600">
            Monitoriamo ogni settimana i siti istituzionali, l'AI filtra solo i bonus compatibili con te e la tua famiglia e
            prepara le domande precompilate in PDF e Word.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            {d && !d.has_profile ? (
              <Link to="/questionnaire" className={buttonVariants({ size: "lg" })} data-testid="cta-start-questionnaire">
                <UserCheck className="size-4" /> Compila il questionario iniziale
              </Link>
            ) : (
              <Link to="/bonus" className={buttonVariants({ size: "lg" })} data-testid="cta-view-bonus">
                <Sparkles className="size-4" /> Vedi i miei bonus
              </Link>
            )}
            <Button
              variant="outline"
              size="lg"
              disabled={running || scanMut.isPending}
              onClick={() => scanMut.mutate()}
              data-testid="btn-dashboard-scan"
            >
              <Radar className={cn("size-4", running && "animate-radar")} />
              {running ? "Scansione in corso…" : "Avvia scansione ora"}
            </Button>
          </div>
          {running && (
            <p className="mt-3 font-mono text-xs text-slate-500" data-testid="dashboard-scan-phase">
              {scan?.phase}
            </p>
          )}
        </div>
      </section>

      <section className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat testId="stat-eligible" label="Bonus idonei" value={d?.bonus_eligible} accent="text-[#047857]" icon={CheckCircle2} />
        <Stat testId="stat-maybe" label="Da verificare" value={d?.bonus_maybe} accent="text-[#B45309]" icon={Sparkles} />
        <Stat testId="stat-docs-to-sign" label="Documenti da firmare" value={d?.documents_to_sign} accent="text-[#0056B3]" icon={FileSignature} />
        <Stat testId="stat-sources" label="Fonti monitorate" value={d?.sources_total} accent="text-slate-900" icon={Globe} />
      </section>

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
                {d?.has_profile
                  ? "Nessun bonus idoneo ancora: la valutazione AI potrebbe essere in corso o puoi avviare una scansione."
                  : "Compila il questionario per scoprire a quali bonus puoi accedere."}
              </div>
            )}
            {top.map((b) => (
              <Link
                key={b.id}
                to="/bonus"
                className="group flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-4 transition-[transform,border-color] duration-200 hover:-translate-y-0.5 hover:border-slate-400"
                data-testid={`dashboard-bonus-${b.id}`}
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-slate-900">{b.title}</p>
                  <p className="text-sm text-slate-500">{b.authority} · {b.amount}</p>
                </div>
                <span className={cn("shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-medium", ELIGIBILITY_CLASS[b.eligibility])}>
                  {ELIGIBILITY_LABEL[b.eligibility]}
                </span>
              </Link>
            ))}
          </div>
        </div>
        <div className="rounded-xl bg-[#0F172A] p-5 text-slate-100" data-testid="dashboard-scan-log">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Registro scansione</p>
          <p className="mt-1 text-sm">Ultima: {fmtDateTime(scan?.last_run_at)}</p>
          <div className="mt-4 max-h-64 space-y-1 overflow-auto font-mono text-xs text-slate-300">
            {(scan?.log ?? []).length === 0 && <p className="text-slate-500">Nessuna scansione eseguita.</p>}
            {(scan?.log ?? []).slice(-12).map((l, i) => (
              <p key={i}>{l}</p>
            ))}
          </div>
        </div>
      </section>
    </div>
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
  icon: typeof Globe;
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
