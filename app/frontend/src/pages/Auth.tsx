import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowRight, LogIn, Radar, ShieldCheck, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuthActions } from "@/lib/queries";
import { isSupabaseConfigured } from "@/lib/queries";

/** Fallback: destinazione dopo il login quando manca il parametro ?returnTo. */
export const AUTH_FALLBACK = "/dashboard";

export default function Auth() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const { signIn, signUp } = useAuthActions();
  const nav = useNavigate();
  const [params] = useSearchParams();

  const go = () => nav(params.get("returnTo") || AUTH_FALLBACK, { replace: true });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === "signin") signIn.mutate({ email, password }, { onSuccess: go });
    else signUp.mutate({ email, password }, { onSuccess: go });
  };

  return (
    <div className="grid min-h-svh lg:grid-cols-[1fr_1.1fr]">
      {/* Colonna form */}
      <div className="flex flex-col px-5 py-6 sm:px-10 lg:px-16">
        <Link to="/" className="flex items-center gap-2.5 self-start" data-testid="auth-home-link">
          <span className="grid size-9 place-items-center rounded-lg bg-[#0056B3]">
            <Radar className="size-4.5 text-white" />
          </span>
          <span className="font-heading text-lg font-bold text-slate-900">BonusRadar Italia</span>
        </Link>

        <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center py-10">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#0056B3]">
            {mode === "signin" ? "Bentornato" : "Crea il tuo account"}
          </p>
          <h1 className="mt-2 font-heading text-3xl font-bold text-slate-900 sm:text-4xl" data-testid="auth-title">
            {mode === "signin" ? "Accedi alla tua radar" : "Registrati in 30 secondi"}
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            {mode === "signin"
              ? "Ritrova preferiti, pratiche pronte e scadenze monitorate."
              : "Profila la tua famiglia, scopri i bonus compatibili e prepara le domande."}
          </p>

          <form onSubmit={submit} className="mt-8 flex flex-col gap-4" data-testid="auth-form">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                required
                autoComplete="email"
                placeholder="mario.rossi@email.it"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-11 bg-white"
                data-testid="auth-email"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                required
                minLength={6}
                autoComplete={mode === "signin" ? "current-password" : "new-password"}
                placeholder="minimo 6 caratteri"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-11 bg-white"
                data-testid="auth-password"
              />
            </div>
            <Button type="submit" size="lg" disabled={signIn.isPending || signUp.isPending} data-testid="auth-submit">
              {mode === "signin" ? (
                <>
                  <LogIn className="size-4" /> {signIn.isPending ? "Accesso…" : "Accedi"}
                </>
              ) : (
                <>
                  <UserPlus className="size-4" /> {signUp.isPending ? "Creazione…" : "Crea account"}
                </>
              )}
            </Button>
            {!isSupabaseConfigured && (
              <Button type="button" variant="outline" size="lg" onClick={go} data-testid="auth-demo-entry">
                Entra in modalità demo
              </Button>
            )}
          </form>

          <p className="mt-6 text-sm text-slate-600" data-testid="auth-switch">
            {mode === "signin" ? "Non hai un account?" : "Hai già un account?"}{" "}
            <button
              type="button"
              onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
              className="font-semibold text-[#0056B3] hover:underline"
              data-testid="auth-toggle-mode"
            >
              {mode === "signin" ? "Registrati" : "Accedi"}
            </button>
          </p>
        </div>

        <p className="flex items-center gap-2 text-xs text-slate-400">
          <ShieldCheck className="size-3.5" /> I tuoi dati restano nel tuo profilo protetto. Nessuna condivisione con terze parti.
        </p>
      </div>

      {/* Colonna visuale */}
      <div className="relative hidden overflow-hidden bg-[#0F172A] lg:block" data-testid="auth-visual">
        <div className="bg-grid-paper absolute inset-0 opacity-40" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#0F172A] via-[#0F172A]/40 to-transparent" />
        <div className="relative flex h-full flex-col justify-end p-14 text-slate-100">
          <span className="grid size-14 place-items-center rounded-2xl border border-white/15 bg-white/10 backdrop-blur">
            <Radar className="size-7 text-sky-300" />
          </span>
          <p className="mt-6 font-heading text-4xl font-bold leading-tight">
            Una radar sui bonus
            <br />
            <span className="text-sky-300">che lavora per te.</span>
          </p>
          <p className="mt-4 max-w-md text-slate-300">
            Scansione settimanale dei portali istituzionali, filtraggio sul tuo profilo ISEE e pratiche precompilate pronte
            per la firma.
          </p>
          <Link to="/" className="mt-8 inline-flex w-fit items-center gap-2 text-sm font-semibold text-sky-300 hover:underline">
            Torna alla home <ArrowRight className="size-4" />
          </Link>
        </div>
      </div>
    </div>
  );
}
