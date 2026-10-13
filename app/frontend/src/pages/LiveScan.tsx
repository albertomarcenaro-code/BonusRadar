import { useEffect, useMemo, useRef, useState } from "react";
import { MatchBadge } from "@/components/match";
import { Reveal } from "@/components/Reveal";
import { calculateBonusMatch } from "@/lib/matching";
import { useInView, usePrefersReducedMotion } from "@/hooks/motion";
import type { Bonus, Profile } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Righe del log dello scraper (sequenza della slide "scansione"). */
const LOG_LINES: { text: string; tone?: "ok" | "accent" | "muted" }[] = [
  { text: "avvio scansione 5 portali", tone: "muted" },
  { text: "comune.genova.it → 3 avvisi", tone: "accent" },
  { text: "regione.liguria.it → 2 bandi", tone: "accent" },
  { text: "inps.it → 7 prestazioni", tone: "accent" },
  { text: "mimit.gov.it → 1 incentivo", tone: "accent" },
  { text: "agenziaentrate.gov.it → 4 agevolazioni", tone: "accent" },
  { text: "deduplica e verifica scadenze", tone: "muted" },
  { text: "confronto con il profilo (ISEE, nucleo, residenza)", tone: "muted" },
  { text: "compatibilità calcolata ✓", tone: "ok" },
];

/** Profilo demo per il matching della landing (non tocca i dati utente). */
export const DEMO_PROFILE: Profile = {
  full_name: "Mario Rossi",
  fiscal_code: "",
  birth_date: "",
  birth_place: "",
  gender: "",
  address: "",
  city: "Genova",
  province: "GE",
  region: "Liguria",
  postal_code: "",
  phone: "",
  email: "",
  iban: "",
  employment_status: "dipendente",
  annual_income: 24000,
  isee_value: 18500,
  housing: "affitto",
  family_members: [
    {
      name: "Giulia",
      relation: "figlio",
      birth_date: "2018-05-12",
      fiscal_code: "",
      disabled: false,
      student: true,
      dependent: true,
    },
  ],
  interests: [],
  notes: "",
  updated_at: "",
};

const TONE_CLASS: Record<string, string> = {
  ok: "text-positive",
  accent: "text-accent",
  muted: "text-muted",
};

/** 3 bonus del catalogo reale compatibili con il profilo demo. */
export function demoMatches(bonuses: Bonus[], limit = 3): { bonus: Bonus; result: ReturnType<typeof calculateBonusMatch> }[] {
  const scored = bonuses.map((b) => ({ bonus: b, result: calculateBonusMatch(DEMO_PROFILE, b) }));
  const rank = { eligible: 0, maybe: 1, unknown: 2, not_eligible: 3 } as const;
  scored.sort((a, b) => rank[a.result.status] - rank[b.result.status] || b.result.score - a.result.score);
  return scored.slice(0, limit);
}

/**
 * Slide "scansione" (DARK): terminale con log animato + orbe radar +
 * 3 offerte individuate con badge di idoneità calcolati dal motore reale.
 * La sequenza parte solo quando la sezione entra in viewport; con
 * reduced-motion mostra tutto subito.
 */
export default function LiveScan({ bonuses }: { bonuses: Bonus[] }) {
  const { ref, inView } = useInView<HTMLDivElement>();
  const reduced = usePrefersReducedMotion();
  const [lines, setLines] = useState(0);
  const [scanning, setScanning] = useState(false);
  const timer = useRef<number | null>(null);

  const offers = useMemo(() => demoMatches(bonuses, 3), [bonuses]);

  useEffect(() => {
    if (!inView) return;
    if (reduced) {
      setLines(LOG_LINES.length);
      setScanning(false);
      return;
    }
    let i = 0;
    setLines(0);
    setScanning(true);
    const tick = () => {
      i += 1;
      setLines(i);
      if (i < LOG_LINES.length) {
        timer.current = window.setTimeout(tick, 620);
      } else {
        // pausa ~3.6s poi loop
        timer.current = window.setTimeout(() => {
          i = 0;
          setLines(0);
          timer.current = window.setTimeout(tick, 620);
        }, 3600);
      }
    };
    timer.current = window.setTimeout(tick, 300);
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [inView, reduced]);

  const progress = Math.round((lines / LOG_LINES.length) * 100);
  const statusChip =
    scanning && lines < LOG_LINES.length ? (
      <span className="chip !border-signal/40 !bg-signal/10 !text-signal">
        <span className="size-1.5 animate-pulse-dot rounded-full bg-signal" />
        Scansione in corso
      </span>
    ) : (
      <span className="chip !border-positive/40 !bg-positive/10 !text-positive">
        <span className="size-1.5 animate-pulse-dot rounded-full bg-positive" />
        Radar attivo · ogni lunedì
      </span>
    );

  return (
    <div ref={ref} className="grid items-center gap-10 lg:grid-cols-[1.15fr_0.85fr]" data-testid="landing-scan-console">
      {/* ---------- Terminale scraper log ---------- */}
      <div className="terminal overflow-hidden" data-testid="landing-scan-log">
        <div className="flex items-center gap-2 border-b border-accent/15 px-4 py-3">
          <span className="size-2.5 rounded-full bg-[#ff5f57]" />
          <span className="size-2.5 rounded-full bg-[#febc2e]" />
          <span className="size-2.5 rounded-full bg-[#28c840]" />
          <span className="ml-2 font-mono text-[0.6875rem] tracking-[0.08em] text-dim">radar · scraper log</span>
          <span className="ml-auto">{statusChip}</span>
        </div>

        <div className="min-h-[248px] px-4 py-4 font-mono text-xs leading-relaxed sm:text-[0.8125rem]">
          {LOG_LINES.slice(0, lines).map((l, i) => (
            <p key={i} className={cn("terminal-line flex gap-2 py-0.5", TONE_CLASS[l.tone ?? "muted"])}>
              <span className="text-dim">›</span>
              <span className={cn(l.tone === "muted" && "text-muted")}>{l.text}</span>
            </p>
          ))}
          {lines < LOG_LINES.length && (
            <p className="flex gap-2 py-0.5 text-muted">
              <span className="text-dim">›</span>
              <span className="inline-block h-4 w-2 animate-pulse bg-accent/70" aria-hidden="true" />
            </p>
          )}
        </div>

        <div className="border-t border-accent/15 px-4 py-3">
          <div className="flex items-center justify-between text-[0.6875rem] text-dim">
            <span>Avanzamento scansione</span>
            <span className="font-mono text-accent">{progress}%</span>
          </div>
          <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-white/8">
            <div
              className="h-full rounded-full bg-[linear-gradient(90deg,#22d3ee,#2f6bff)] transition-[width] duration-500 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      </div>

      {/* ---------- Orbe radar + offerte ---------- */}
      <div className="min-w-0 flex flex-col items-center gap-8">
        <RadarOrb scanning={scanning && lines < LOG_LINES.length} reduced={reduced} />
        <Offers offers={offers} />
      </div>
    </div>
  );
}

/** Orbe radar: 4 anelli, sweep, 5 blip, box centrale "live". */
function RadarOrb({ scanning, reduced }: { scanning: boolean; reduced: boolean }) {
  const blips = [
    { top: "22%", left: "63%", delay: "0s" },
    { top: "38%", left: "78%", delay: "0.7s" },
    { top: "66%", left: "70%", delay: "1.3s" },
    { top: "72%", left: "34%", delay: "0.4s" },
    { top: "30%", left: "26%", delay: "1.8s" },
  ];
  return (
    <div
      className={cn(
        "relative aspect-square w-full max-w-[300px] shrink-0 rounded-full transition-shadow duration-500",
        scanning && "neon-ring",
      )}
      aria-hidden="true"
    >
      <div className="absolute inset-0 rounded-full border border-accent/25" />
      <div className="absolute inset-[11%] rounded-full border border-accent/20" />
      <div className="absolute inset-[23%] rounded-full border border-accent/15" />
      <div className="absolute inset-[35%] rounded-full border border-accent/10" />
      {!reduced && (
        <div className="absolute inset-0 overflow-hidden rounded-full">
          <div className="radar-sweep absolute inset-0" />
        </div>
      )}
      {blips.map((b, i) => (
        <span
          key={i}
          className={cn("absolute size-1.5 rounded-full bg-accent shadow-[0_0_8px_rgba(34,211,238,0.9)]", !reduced && "animate-pulse")}
          style={{ top: b.top, left: b.left, animationDelay: b.delay }}
        />
      ))}
      <div
        className={cn(
          "absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-xl bg-canvas/90 px-4 py-2.5 text-center",
          scanning ? "neon-ring" : "border border-accent/25",
        )}
      >
        <p className="font-mono text-[0.625rem] uppercase tracking-[0.24em] text-accent">live</p>
        <p className="mt-0.5 text-[0.625rem] text-dim">5 portali</p>
      </div>
    </div>
  );
}

/** Le 3 offerte individuate, compaiono in sequenza con badge di idoneità. */
function Offers({ offers }: { offers: { bonus: Bonus; result: ReturnType<typeof calculateBonusMatch> }[] }) {
  if (offers.length === 0) return null;
  return (
    <div className="w-full">
      <p className="eyebrow mb-3 text-center">Offerte individuate</p>
      <ul className="flex flex-col gap-2.5">
        {offers.map(({ bonus, result }, i) => (
          <li key={bonus.id}>
            <Reveal delay={i * 110} y={16}>
              <div
                className="panel interactive flex items-center gap-3 rounded-xl px-4 py-3"
                data-testid="landing-offer-card"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-ink">{bonus.title}</p>
                  <p className="truncate text-xs text-dim">{bonus.authority}</p>
                </div>
                <MatchBadge result={result} testId="landing-offer-badge" />
              </div>
            </Reveal>
          </li>
        ))}
      </ul>
    </div>
  );
}
