import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Info, LogOut, UserRound } from "lucide-react";
import { useAuthActions, useAuthUser } from "@/lib/queries";

/**
 * Menu del profilo (avatar in alto a destra): mostra l'account collegato,
 * il tipo di account e il logout. Chiusura con click fuori, tasto Esc o
 * selezione di una voce.
 */
export default function UserMenu() {
  const { data: user } = useAuthUser();
  const { signOut } = useAuthActions();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Chiude il menu su click esterno o Esc.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!user) return null;

  const handleSignOut = () => {
    setOpen(false);
    signOut.mutate(undefined, {
      onSuccess: () => nav("/", { replace: true }),
    });
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex size-9 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-600 transition-colors duration-150 hover:border-[#0056B3] hover:text-[#0056B3]"
        aria-label="Menu account"
        aria-expanded={open}
        aria-haspopup="menu"
        data-testid="user-menu-button"
      >
        <UserRound className="size-4.5" />
        <span className="absolute inset-0 rounded-full ring-[#0056B3]/30 ring-offset-2 transition-shadow duration-150" style={{ boxShadow: open ? "0 0 0 2px rgba(0,86,179,0.25)" : undefined }} />
      </button>

      {open && (
        <div
          className="absolute right-0 top-11 z-50 w-64 rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg"
          role="menu"
          data-testid="user-menu"
        >
          <div className="border-b border-slate-100 px-3 py-2.5">
            <p className="truncate text-sm font-semibold text-slate-900" data-testid="user-menu-email">
              {user.email || "Account locale"}
            </p>
            <p className="text-xs text-slate-500">Account BonusRadar</p>
          </div>

          <div className="px-3 py-2 text-xs text-slate-500" data-testid="user-menu-info">
            <p className="flex items-start gap-2">
              <Info className="mt-0.5 size-3.5 shrink-0" />
              Profilo, documenti e preferiti sono salvati in questo account.
            </p>
          </div>

          <button
            onClick={handleSignOut}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-red-700 transition-colors duration-150 hover:bg-red-50"
            role="menuitem"
            data-testid="user-menu-signout"
          >
            <LogOut className="size-4" /> Esci dall'account
          </button>
        </div>
      )}
    </div>
    );
}
