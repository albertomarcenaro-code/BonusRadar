import { useState } from "react";
import { Globe, Plus, Radar, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import PageHeader from "@/components/PageHeader";
import { useAddSource, useDeleteSource, useScanStatus, useSources, useTriggerScan } from "@/lib/queries";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

export default function Sources() {
  const { data: sources, isError } = useSources();
  const { data: scan } = useScanStatus();
  const add = useAddSource();
  const del = useDeleteSource();
  const scanMut = useTriggerScan();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const running = scan?.running ?? false;

  return (
    <div>
      <PageHeader
        eyebrow="Fonti monitorate"
        title="Siti sotto osservazione"
        description="Ogni settimana l'app scarica queste pagine e Claude Sonnet 4.5 estrae i nuovi bonus. Aggiungi i siti di Regione e Comune per bandi locali."
        testId="sources-title"
        actions={
          <Button className="h-11" disabled={running || scanMut.isPending} onClick={() => scanMut.mutate()} data-testid="btn-trigger-manual-scan">
            <Radar className={cn("size-4", running && "animate-radar")} />
            {running ? "Scansione in corso…" : "Avvia scansione ora"}
          </Button>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <div>
          <form
            className="mb-4 flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-4 sm:flex-row"
            onSubmit={(e) => {
              e.preventDefault();
              add.mutate({ name, url }, { onSuccess: () => { setName(""); setUrl(""); } });
            }}
            data-testid="add-source-form"
          >
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome (es. Regione Lazio)" className="h-11 sm:w-52" data-testid="input-new-source-name" />
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" required className="h-11 flex-1 font-mono text-sm" data-testid="input-new-source-url" />
            <Button type="submit" className="h-11" disabled={add.isPending} data-testid="btn-add-source">
              <Plus className="size-4" /> Aggiungi
            </Button>
          </form>

          {isError && <p className="text-sm text-slate-500">Fonti non disponibili al momento.</p>}
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
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => del.mutate(s.id)}
                  aria-label={`Rimuovi ${s.name}`}
                  className="text-slate-400 hover:text-red-700"
                  data-testid="btn-delete-source"
                >
                  <Trash2 className="size-4" />
                </Button>
              </li>
            ))}
            {sources && sources.length === 0 && (
              <li className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-500">Nessuna fonte. Aggiungine una sopra.</li>
            )}
          </ul>
        </div>

        <aside className="h-fit rounded-xl bg-[#0F172A] p-5 text-slate-100 lg:sticky lg:top-8" data-testid="scan-status-indicator">
          <div className="flex items-center gap-2">
            <span className={cn("size-2.5 rounded-full", running ? "animate-pulse-dot bg-amber-400" : "bg-emerald-400")} />
            <p className="font-heading font-semibold">{running ? "Scansione in corso" : "In attesa"}</p>
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-[11px] uppercase tracking-wider text-slate-400">Ultima</dt>
              <dd className="font-mono text-xs" data-testid="scan-last-run">{fmtDateTime(scan?.last_run_at)}</dd>
            </div>
            <div>
              <dt className="text-[11px] uppercase tracking-wider text-slate-400">Prossima automatica</dt>
              <dd className="font-mono text-xs" data-testid="scan-next-run">{scan?.next_run_at ? fmtDate(scan.next_run_at) : "entro 1 ora"}</dd>
            </div>
          </dl>
          <p className="mt-5 text-[11px] uppercase tracking-wider text-slate-400">Registro</p>
          <div className="mt-2 max-h-80 space-y-1 overflow-auto font-mono text-xs text-slate-300">
            {(scan?.log ?? []).length === 0 && <p className="text-slate-500">Nessun evento.</p>}
            {(scan?.log ?? []).map((l, i) => (
              <p key={i} data-testid="scan-log-item">{l}</p>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}
