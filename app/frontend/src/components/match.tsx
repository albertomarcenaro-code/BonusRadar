import { AlertTriangle, Check, UserRound, X } from "lucide-react";
import { Link } from "react-router-dom";
import { MATCH_CLASS, MATCH_LABEL } from "@/lib/matching";
import type { MatchResult } from "@/lib/matching";
import { cn } from "@/lib/utils";

/**
 * Badge di idoneità personalizzato derivato dal matching profilo ↔ bando.
 * Stati: IDONEO (verde), VERIFICA DETTAGLI (giallo), NON IDONEO (rosso),
 * PROFILO INCOMPLETO (grigio). Include la percentuale di affinità.
 */
export function MatchBadge({
  result,
  size = "default",
  testId = "match-badge",
}: {
  result: MatchResult;
  size?: "default" | "lg";
  testId?: string;
}) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-full border font-semibold",
        size === "lg" ? "px-3 py-1 text-sm" : "px-2.5 py-0.5 text-xs",
        MATCH_CLASS[result.status],
      )}
      data-testid={testId}
      data-match-status={result.status}
    >
      {MATCH_LABEL[result.status]}
      {result.status !== "unknown" && <span className="ml-1.5 font-mono">{result.score}%</span>}
    </span>
  );
}

/** Icona per il singolo check (✓ / ⚠ / ✕). */
function CheckIcon({ state }: { state: "ok" | "warn" | "fail" }) {
  if (state === "ok") return <Check className="size-4 shrink-0 text-positive" />;
  if (state === "warn") return <AlertTriangle className="size-4 shrink-0 text-signal" />;
  return <X className="size-4 shrink-0 text-negative" />;
}

/**
 * Dettaglio delle verifiche del matching (es. "✓ ISEE ok", "✓ Residenza Genova ok",
 * "⚠ Età figli da confermare").
 */
export function MatchChecks({ result, className }: { result: MatchResult; className?: string }) {
  if (result.checks.length === 0) return null;
  return (
    <ul className={cn("space-y-1.5 text-sm", className)} data-testid="match-checks">
      {result.checks.map((c, i) => (
        <li key={i} className="flex items-start gap-2">
          <CheckIcon state={c.state} />
          <span
            className={cn(
              c.state === "ok" && "text-muted",
              c.state === "warn" && "text-signal",
              c.state === "fail" && "text-muted",
            )}
          >
            {c.label}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Fallback quando l'utente non ha ancora un profilo: invito chiaro a
 * completarlo prima di valutare l'idoneità al bonus.
 */
export function MatchFallbackCta({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return (
      <Link
        to="/profile"
        className="inline-flex items-center gap-1.5 rounded-full border border-line bg-white/[0.05] px-3 py-1 text-xs font-semibold text-muted transition-colors duration-150 hover:border-accent/40 hover:text-ink"
        data-testid="match-fallback-compact"
      >
        <UserRound className="size-3.5" /> Completa il profilo per la valutazione
      </Link>
    );
  }
  return (
    <div className="mt-4 flex flex-col gap-2 rounded-xl border border-line bg-white/[0.03] p-3 sm:flex-row sm:items-center sm:justify-between" data-testid="match-fallback">
      <p className="flex items-center gap-2 text-sm text-muted">
        <UserRound className="size-4 shrink-0 text-dim" />
        Completa il tuo profilo per verificare se hai diritto a questo bonus.
      </p>
      <Link
        to="/profile"
        className="shrink-0 rounded-lg bg-[linear-gradient(180deg,#8bf3ff,#22d3ee_45%,#0ea5e9)] px-3 py-1.5 text-center text-sm font-semibold text-[#03121b] transition-all duration-150 hover:brightness-105"
        data-testid="match-fallback-cta"
      >
        Completa il profilo
      </Link>
    </div>
  );
}
