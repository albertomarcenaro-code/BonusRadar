import { Globe, Info } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { useScanStatus, useSources } from "@/lib/queries";
import { fmtDate, fmtDateTime } from "@/lib/format";

export default function Sources() {
  const { data: sources } = useSources();
  const { data: scan } = useScanStatus();

  return (
    <div>
      <PageHeader
        eyebrow="Fonti monitorate"
        title="Siti sotto osservazione"
        description="Ogni settimana il motore di scansione AI analizza i portali istituzionali (INPS, Agenzia delle Entrate, Governo) e aggiorna il catalogo. La gestione delle fonti arriva con il backend AI."
        testId="sources-title"
      />

      <div className="mb-6 flex items-start gap-3 rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900" data-testid="sources-info-banner">
        <Info className="mt-0.5 size-4 shrink-0" />
        <p>
          In questa versione le fonti sono gestite dal catalogo centralizzato: le pagine istituzionali monitorate sono
          INPS, Agenzia delle Entrate e Governo.it. La scansione AI settimanale viene eseguita dal servizio dedicato.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <ul className="flex flex-col gap-2" data-testid="sources-table">
          {(sources ?? []).map((s) => (
            <li key={s.id} className="flex items-center gap-4 rounded-xl border border-slate-200 bg-white p-4" data-testid="source-row">
              <Globe className="size-5 shrink-0 text-slate-400" />
              <div className="min-w-0 flex-1">
                <p className="font-medium" data-testid="source-name">{s.name}</p>
                <a href={s.url} target="_blank" rel="noreferrer" className="block truncate font-mono text-xs text-[#0056B3] hover:underline">
                  {s.url}
                </a>
                <p className="mt-1 text-xs text-slate-500" data-testid="source-status">
                  Ultima scansione: {fmtDate(s.last_scanned_at)} · {s.last_status}
                </p>
              </div>
            </li>
          ))}
          {(sources ?? []).length === 0 && (
            <li className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-500">
              Nessuna fonte configurata al momento.
            </li>
          )}
        </ul>

        <aside className="h-fit rounded-xl bg-[#0F172A] p-5 text-slate-100 lg:sticky lg:top-8" data-testid="scan-status-indicator">
          <div className="flex items-center gap-2">
            <span className="size-2.5 rounded-full bg-emerald-400" />
            <p className="font-heading font-semibold">Stato del monitoraggio</p>
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-[11px] uppercase tracking-wider text-slate-400">Ultima</dt>
              <dd className="font-mono text-xs" data-testid="scan-last-run">{fmtDateTime(scan?.last_run_at)}</dd>
            </div>
            <div>
              <dt className="text-[11px] uppercase tracking-wider text-slate-400">Frequenza</dt>
              <dd className="font-mono text-xs">settimanale</dd>
            </div>
          </dl>
          <p className="mt-5 text-[11px] uppercase tracking-wider text-slate-400">Registro</p>
          <div className="mt-2 max-h-80 space-y-1 overflow-auto font-mono text-xs text-slate-300">
            {(scan?.log ?? []).length === 0 && <p className="text-slate-500">Nessun evento — scansione in arrivo.</p>}
            {(scan?.log ?? []).map((l, i) => (
              <p key={i} data-testid="scan-log-item">{l}</p>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}
