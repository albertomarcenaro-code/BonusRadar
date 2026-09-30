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
  if (state === "ok") return <Check className="size-4 shrink-0 text-emerald-600" />;
  if (state === "warn") return <AlertTriangle className="size-4 shrink-0 text-amber-600" />;
  return <X className="size-4 shrink-0 text-red-600" />;
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
              c.state === "ok" && "text-slate-700",
              c.state === "warn" && "text-amber-800",
              c.state === "fail" && "text-slate-700",
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
        className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 transition-colors duration-150 hover:bg-slate-200"
        data-testid="match-fallback-compact"
      >
        <UserRound className="size-3.5" /> Completa il profilo per la valutazione
      </Link>
    );
  }
  return (
    <div className="mt-4 flex flex-col gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 sm:flex-row sm:items-center sm:justify-between" data-testid="match-fallback">
      <p className="flex items-center gap-2 text-sm text-slate-600">
        <UserRound className="size-4 shrink-0 text-slate-400" />
        Completa il tuo profilo per verificare se hai diritto a questo bonus.
      </p>
      <Link
        to="/profile"
        className="shrink-0 rounded-lg bg-[#0056B3] px-3 py-1.5 text-center text-sm font-semibold text-white transition-colors duration-150 hover:bg-[#004085]"
        data-testid="match-fallback-cta"
      >
        Completa il profilo
      </Link>
    </div>
  );
}
