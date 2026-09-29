import { Link } from "react-router-dom";
import { Download, FileText, FileType2, FolderOpen, Trash2 } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import PageHeader from "@/components/PageHeader";
import { useDeleteDoc, useDownloadDoc, useDocuments, useUpdateDocStatus } from "@/lib/queries";
import { DOC_STATUS_LABEL, fmtDate } from "@/lib/format";
import type { DocStatus, DocumentFolder } from "@/lib/types";
import { cn } from "@/lib/utils";

export default function Documents() {
  const { data: docs, isError } = useDocuments();
  return (
    <div>
      <PageHeader
        eyebrow="Cartella pratiche"
        title="I miei documenti"
        description="Ogni bonus ha la sua cartella con la domanda precompilata in PDF e Word, pronta per firma e invio."
        testId="documents-title"
      />
      {isError && <p className="text-sm text-slate-500">Documenti non disponibili al momento.</p>}
      {docs && docs.length === 0 && (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center" data-testid="documents-empty">
          <FolderOpen className="mx-auto size-10 text-slate-300" />
          <p className="mt-3 font-medium">Nessuna cartella ancora</p>
          <p className="mt-1 text-sm text-slate-500">Dal catalogo, premi "Prepara documenti" su un bonus idoneo.</p>
          <Link to="/bonus" className={cn(buttonVariants(), "mt-5")} data-testid="documents-go-bonus">
            Vai al catalogo
          </Link>
        </div>
      )}
      <div className="flex flex-col gap-4" data-testid="documents-list">
        {(docs ?? []).map((d) => (
          <FolderCard key={d.id} doc={d} />
        ))}
      </div>
    </div>
  );
}

function FolderCard({ doc: d }: { doc: DocumentFolder }) {
  const upd = useUpdateDocStatus();
  const del = useDeleteDoc();
  const dl = useDownloadDoc();
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-5 animate-rise" data-testid="document-folder-card">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex gap-4">
          <div className="grid size-12 shrink-0 place-items-center rounded-lg bg-[#E8F0FA]">
            <FolderOpen className="size-6 text-[#0056B3]" />
          </div>
          <div>
            <h3 className="text-lg font-bold leading-snug" data-testid="document-folder-title">{d.bonus_title}</h3>
            <p className="text-sm text-slate-500">
              {d.authority} · preparata il <span className="font-mono">{fmtDate(d.created_at)}</span>
            </p>
          </div>
        </div>
        <Select value={d.status} onValueChange={(v: string) => upd.mutate({ id: d.id, status: v as DocStatus })}>
          <SelectTrigger className="h-10 w-full bg-white sm:w-44" data-testid="select-document-status">
            <SelectValue placeholder="Stato" />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(DOC_STATUS_LABEL) as DocStatus[]).map((k) => (
              <SelectItem key={k} value={k} data-testid={`document-status-option-${k}`}>{DOC_STATUS_LABEL[k]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_1fr]">
        <div className="flex flex-col gap-2">
          {d.files.map((f) => (
            <button
              key={f.name}
              onClick={() => dl.mutate({ doc: d, kind: f.kind })}
              disabled={dl.isPending}
              className="group flex items-center gap-3 rounded-lg border border-slate-200 px-3 py-2.5 text-left transition-colors duration-150 hover:border-[#0056B3] hover:bg-[#F5F9FE]"
              data-testid={f.kind === "pdf" ? "btn-download-pdf" : "btn-download-docx"}
            >
              {f.kind === "pdf" ? <FileText className="size-5 text-red-700" /> : <FileType2 className="size-5 text-[#0056B3]" />}
              <span className="min-w-0 flex-1 truncate font-mono text-sm">{f.name}</span>
              <Download className="size-4 text-slate-400 group-hover:text-[#0056B3]" />
            </button>
          ))}
          <div className="mt-1 flex flex-wrap gap-2">
            <Button
              variant="ghost"
              className="text-red-700"
              onClick={() => del.mutate(d.id)}
              disabled={del.isPending}
              aria-label="Elimina cartella"
              data-testid="btn-delete-folder"
            >
              <Trash2 className="size-4" /> Elimina
            </Button>
          </div>
        </div>
        <div className="rounded-lg bg-slate-50 p-4 text-sm">
          {d.attachments.length > 0 && (
            <>
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Allegati da preparare</p>
              <ul className="mt-2 space-y-1 text-slate-700" data-testid="document-attachments">
                {d.attachments.map((a) => (
                  <li key={a} className="flex gap-2"><span className="text-slate-400">☐</span>{a}</li>
                ))}
              </ul>
            </>
          )}
          {d.submission_notes && (
            <>
              <p className="mt-4 text-xs font-semibold uppercase tracking-wider text-slate-500">Come presentare</p>
              <p className="mt-1 text-slate-700" data-testid="document-submission-notes">{d.submission_notes}</p>
            </>
          )}
        </div>
      </div>
    </article>
  );
}
