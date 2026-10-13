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
          <span className="grid size-9 place-items-center rounded-lg bg-gradient-to-b from-[#8bf3ff] via-accent to-[#0ea5e9] text-[#03121b] shadow-[0_8px_24px_-10px_rgba(34,211,238,0.8)]">
            <Radar className="size-4.5" />
          </span>
          <span className="font-heading text-lg font-bold text-ink">BonusRadar</span>
        </Link>

        <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center py-10">
          <p className="eyebrow">
            {mode === "signin" ? "Bentornato" : "Crea il tuo account"}
          </p>
          <h1 className="mt-2 font-heading text-3xl font-bold text-ink sm:text-4xl" data-testid="auth-title">
            {mode === "signin" ? "Accedi alla tua radar" : "Registrati in 30 secondi"}
          </h1>
          <p className="mt-2 text-sm text-muted">
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
                className="h-11"
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
                className="h-11"
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

          <p className="mt-6 text-sm text-muted" data-testid="auth-switch">
            {mode === "signin" ? "Non hai un account?" : "Hai già un account?"}{" "}
            <button
              type="button"
              onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
              className="font-semibold text-accent hover:underline"
              data-testid="auth-toggle-mode"
            >
              {mode === "signin" ? "Registrati" : "Accedi"}
            </button>
          </p>
        </div>

        <p className="flex items-center gap-2 text-xs text-dim">
          <ShieldCheck className="size-3.5" /> I tuoi dati restano nel tuo profilo protetto. Nessuna condivisione con terze parti.
        </p>
      </div>

      {/* Colonna visuale */}
      <div className="relative hidden overflow-hidden bg-canvas-2 lg:block" data-testid="auth-visual">
        <div className="bg-grid-paper absolute inset-0 opacity-40" />
        <div className="absolute inset-0 bg-gradient-to-t from-canvas-2 via-canvas-2/40 to-transparent" />
        <div className="relative flex h-full flex-col justify-end p-14 text-ink">
          <span className="grid size-14 place-items-center rounded-2xl border border-white/15 bg-white/10 backdrop-blur">
            <Radar className="size-7 text-accent" />
          </span>
          <p className="mt-6 font-heading text-4xl font-bold leading-tight">
            Una radar sui bonus
            <br />
            <span className="text-gradient">che lavora per te.</span>
          </p>
          <p className="mt-4 max-w-md text-muted">
            Scansione settimanale dei portali istituzionali, filtraggio sul tuo profilo ISEE e pratiche precompilate pronte
            per la firma.
          </p>
          <Link to="/" className="mt-8 inline-flex w-fit items-center gap-2 text-sm font-semibold text-accent hover:underline">
            Torna alla home <ArrowRight className="size-4" />
          </Link>
        </div>
      </div>
    </div>
  );
}
