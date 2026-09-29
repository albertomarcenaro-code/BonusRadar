import { NavLink, Outlet } from "react-router-dom";
import { CloudOff, FolderArchive, Globe, LayoutDashboard, Radar, Sparkles, UserCheck } from "lucide-react";
import { Toaster } from "@/components/ui/sonner";
import { useDashboard, useScanStatus } from "@/lib/queries";
import { fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";

const LINKS = [
  { to: "/", label: "Panoramica", short: "Home", icon: LayoutDashboard, id: "dashboard" },
  { to: "/bonus", label: "Catalogo Bonus", short: "Bonus", icon: Sparkles, id: "bonus" },
  { to: "/documents", label: "I Miei Documenti", short: "Documenti", icon: FolderArchive, id: "documents" },
  { to: "/sources", label: "Fonti Monitorate", short: "Fonti", icon: Globe, id: "sources" },
  { to: "/questionnaire", label: "Profilo & ISEE", short: "Profilo", icon: UserCheck, id: "questionnaire" },
];

export default function AppShell() {
  const { data: scan } = useScanStatus();
  const { isError: backendDown } = useDashboard();
  return (
    <div className="min-h-svh bg-background">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col bg-sidebar text-sidebar-foreground lg:flex">
        <div className="flex items-center gap-3 px-6 py-6">
          <div className="relative grid size-10 place-items-center rounded-lg bg-[#0056B3]">
            <Radar className="size-5 text-white" />
          </div>
          <div>
            <p className="font-heading text-lg font-bold leading-none" data-testid="app-name">BonusRadar</p>
            <p className="mt-1 text-[11px] uppercase tracking-[0.18em] text-slate-400">Italia</p>
          </div>
        </div>
        <nav className="mt-4 flex flex-col gap-1 px-3">
          {LINKS.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.to === "/"}
              data-testid={`nav-${l.id}`}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm transition-colors duration-150",
                  isActive ? "bg-sidebar-accent text-white" : "text-slate-400 hover:bg-sidebar-accent/60 hover:text-white",
                )
              }
            >
              <l.icon className="size-4" />
              {l.label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto m-4 rounded-lg border border-sidebar-border bg-sidebar-accent/50 p-4" data-testid="sidebar-scan-status">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Monitoraggio</p>
          <div className="mt-2 flex items-center gap-2 text-sm">
            <span className={cn("size-2 rounded-full", scan?.running ? "animate-pulse-dot bg-amber-400" : "bg-emerald-400")} />
            {scan?.running ? "Scansione in corso" : "Attivo · settimanale"}
          </div>
          <p className="mt-1 font-mono text-xs text-slate-400">Prossima: {fmtDate(scan?.next_run_at) === "—" ? "a breve" : fmtDate(scan?.next_run_at)}</p>
        </div>
      </aside>

      <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-border bg-white/85 px-4 py-3 backdrop-blur-md lg:hidden">
        <div className="grid size-8 place-items-center rounded-md bg-[#0056B3]">
          <Radar className="size-4 text-white" />
        </div>
        <p className="font-heading font-bold">BonusRadar Italia</p>
        {scan?.running && <span className="ml-auto size-2 animate-pulse-dot rounded-full bg-amber-500" />}
      </header>

      {backendDown && (
        <div
          className="flex items-center justify-center gap-2 bg-[#FFFBEB] px-4 py-2.5 text-sm text-[#92400E]"
          data-testid="backend-offline-banner"
        >
          <CloudOff className="size-4 shrink-0" />
          <span>
            Backend non raggiungibile — i dati non sono disponibili. Controlla che FastAPI e MongoDB siano attivi.
          </span>
        </div>
      )}

      <main className="pb-24 lg:pb-0 lg:pl-64">
        <div className="mx-auto max-w-6xl px-4 py-6 sm:px-8 lg:py-10">
          <Outlet />
        </div>
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-border bg-white/95 backdrop-blur-md lg:hidden">
        {LINKS.map((l) => (
          <NavLink
            key={l.to}
            to={l.to}
            end={l.to === "/"}
            data-testid={`mobile-nav-${l.id}`}
            className={({ isActive }) =>
              cn("flex min-h-14 flex-col items-center justify-center gap-1 text-[11px]", isActive ? "text-[#0056B3]" : "text-slate-500")
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
