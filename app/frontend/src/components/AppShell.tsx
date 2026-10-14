import { NavLink, Outlet, useLocation } from "react-router-dom";
import { CloudOff, LayoutDashboard, Radar, Sparkles, UserCheck } from "lucide-react";
import { Toaster } from "@/components/ui/sonner";
import UserMenu from "@/components/UserMenu";
import { isSupabaseConfigured, useScanStatus } from "@/lib/queries";
import { fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";

const LINKS = [
  { to: "/profile", label: "Mio Profilo & Documenti", short: "Profilo", icon: UserCheck, id: "profile", end: false },
  { to: "/dashboard", label: "Panoramica", short: "Panoramica", icon: LayoutDashboard, id: "dashboard", end: false },
  { to: "/bonus", label: "Catalogo Bonus", short: "Bonus", icon: Sparkles, id: "bonus", end: false },
];

/**
 * Shell per le pagine autenticate (/profile, /dashboard, /bonus).
 * La landing pubblica (/) e /auth vivono fuori dalla shell.
 */
export default function AppShell() {
  const { data: scan } = useScanStatus();
  const demoMode = !isSupabaseConfigured;
  const location = useLocation();

  return (
    <div className="min-h-svh bg-canvas text-ink">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-white/8 bg-canvas-2/70 backdrop-blur-xl lg:flex">
        <div className="flex items-center justify-between px-5 py-6">
          <NavLink to="/dashboard" className="flex items-center gap-3">
            <div className="relative grid size-10 place-items-center rounded-lg bg-[linear-gradient(180deg,#22d3ee,#2f6bff)]">
              <Radar className="size-5 text-[#03121b]" />
            </div>
            <div>
              <p className="font-display text-lg font-bold leading-none" data-testid="app-name">BonusRadar</p>
              <p className="mt-1 text-[11px] uppercase tracking-[0.18em] text-dim">Italia</p>
            </div>
          </NavLink>
          <UserMenu />
        </div>
        <nav className="mt-4 flex flex-col gap-1 px-3" data-testid="sidebar-nav">
          {LINKS.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.end}
              data-testid={`nav-${l.id}`}
              className={({ isActive }) =>
                cn(
                  "relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors duration-150",
                  isActive
                    ? "bg-white/[0.07] text-ink before:absolute before:left-0 before:top-1/2 before:h-4 before:w-[2px] before:-translate-y-1/2 before:rounded-full before:bg-accent before:shadow-[0_0_8px_rgba(34,211,238,0.9)]"
                    : "text-muted hover:bg-white/[0.04] hover:text-ink",
                )
              }
            >
              <l.icon className="size-4" />
              {l.label}
            </NavLink>
          ))}
        </nav>
        <div className="m-4 mt-auto rounded-xl border border-line bg-white/[0.03] p-4" data-testid="sidebar-scan-status">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-dim">Monitoraggio</p>
          <div className="mt-2 flex items-center gap-2 text-sm text-ink">
            <span className={cn("size-2 rounded-full", scan?.running ? "animate-pulse-dot bg-signal" : "bg-positive animate-pulse-dot")} />
            {scan?.running ? "Scansione in corso" : "Attivo · settimanale"}
          </div>
          <p className="mt-1 font-mono text-xs text-dim">Prossima: {fmtDate(scan?.next_run_at) === "—" ? "a breve" : fmtDate(scan?.next_run_at)}</p>
        </div>
      </aside>

      <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-white/10 bg-[#04060d]/85 px-4 py-3 backdrop-blur-xl lg:hidden">
        <NavLink to="/dashboard" className="flex items-center gap-2">
          <div className="grid size-8 place-items-center rounded-md bg-[linear-gradient(180deg,#22d3ee,#2f6bff)]">
            <Radar className="size-4 text-[#03121b]" />
          </div>
          <p className="font-display font-bold text-ink">BonusRadar</p>
        </NavLink>
        {scan?.running && <span className="ml-auto size-2 animate-pulse-dot rounded-full bg-signal" />}
        <div className={scan?.running ? "" : "ml-auto"}>
          <UserMenu />
        </div>
      </header>

      {demoMode && (
        <div
          className="flex items-center justify-center gap-2 border-b border-amber-400/20 bg-amber-400/[0.07] px-4 py-2.5 text-sm text-amber-200"
          data-testid="demo-mode-banner"
        >
          <CloudOff className="size-4 shrink-0" />
          <span>
            Modalità demo — i dati sono salvati solo in questo browser. Configura Supabase (VITE_SUPABASE_URL e
            VITE_SUPABASE_ANON_KEY) per salvare tutto nel cloud.
          </span>
        </div>
      )}

      <main className="pb-24 lg:pb-0 lg:pl-64" key={location.pathname}>
        <div className="mx-auto max-w-6xl px-4 py-6 sm:px-8 lg:py-10">
          <Outlet />
        </div>
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-3 border-t border-white/10 bg-[#04060d]/90 backdrop-blur-xl lg:hidden">
        {LINKS.map((l) => (
          <NavLink
            key={l.to}
            to={l.to}
            end={l.end}
            data-testid={`mobile-nav-${l.id}`}
            className={({ isActive }) =>
              cn(
                "flex min-h-14 flex-col items-center justify-center gap-1 text-[11px] transition-colors duration-150",
                isActive ? "text-accent [filter:drop-shadow(0_0_6px_rgba(34,211,238,0.7))]" : "text-dim",
              )
            }
          >
            <l.icon className="size-5" />
            {l.short}
          </NavLink>
        ))}
      </nav>
      <Toaster richColors />
    </div>
  );
}
