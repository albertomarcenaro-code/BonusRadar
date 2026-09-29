import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ApiError, apiDelete, apiGet, apiPatch, apiPost, apiPut } from "@/lib/api";
import type {
  Bonus,
  Dashboard,
  DocStatus,
  DocumentFolder,
  Profile,
  ProfileIn,
  ScanStatus,
  Source,
  SourceIn,
} from "@/lib/types";

export function errMsg(e: unknown): string {
  if (e instanceof ApiError) {
    const d = (e.body as { detail?: unknown } | null)?.detail;
    if (typeof d === "string") return d;
    return `Errore ${e.status}`;
  }
  return "Connessione non riuscita";
}

export const useDashboard = () =>
  useQuery({ queryKey: ["dashboard"], queryFn: () => apiGet<Dashboard>("/dashboard"), retry: false });

export const useProfile = () =>
  useQuery({ queryKey: ["profile"], queryFn: () => apiGet<Profile | null>("/profile"), retry: false });

export const useSources = () =>
  useQuery({ queryKey: ["sources"], queryFn: () => apiGet<Source[]>("/sources"), retry: false });

export const useBonuses = (poll: boolean) =>
  useQuery({
    queryKey: ["bonus"],
    queryFn: () => apiGet<Bonus[]>("/bonus"),
    retry: false,
    refetchInterval: poll ? 4000 : false,
  });

export const useDocuments = () =>
  useQuery({ queryKey: ["documents"], queryFn: () => apiGet<DocumentFolder[]>("/documents"), retry: false });

export function useScanStatus() {
  const qc = useQueryClient();
  return useQuery({
    queryKey: ["scan"],
    queryFn: async () => {
      const prev = qc.getQueryData<ScanStatus>(["scan"]);
      const st = await apiGet<ScanStatus>("/scan/status");
      if (prev?.running && !st.running) {
        qc.invalidateQueries({ queryKey: ["bonus"] });
        qc.invalidateQueries({ queryKey: ["sources"] });
        qc.invalidateQueries({ queryKey: ["dashboard"] });
      }
      return st;
    },
    retry: false,
    refetchInterval: (q) => (q.state.data?.running ? 2500 : 30000),
  });
}

export function useInvalidateAll() {
  const qc = useQueryClient();
  return () => {
    for (const k of ["dashboard", "scan", "bonus", "sources", "documents", "profile"]) qc.invalidateQueries({ queryKey: [k] });
  };
}

export function useSaveProfile() {
  const inv = useInvalidateAll();
  return useMutation({
    mutationFn: (p: ProfileIn) => apiPut<Profile>("/profile", p),
    onSuccess: () => {
      toast.success("Profilo salvato. Sto ricalcolando la tua idoneità ai bonus…");
      inv();
    },
    onError: (e) => toast.error(errMsg(e)),
  });
}

export function useAddSource() {
  const inv = useInvalidateAll();
  return useMutation({
    mutationFn: (s: SourceIn) => apiPost<Source>("/sources", s),
    onSuccess: () => {
      toast.success("Fonte aggiunta al monitoraggio");
      inv();
    },
    onError: (e) => toast.error(errMsg(e)),
  });
}

export function useDeleteSource() {
  const inv = useInvalidateAll();
  return useMutation({
    mutationFn: (id: string) => apiDelete<{ ok: boolean }>(`/sources/${id}`),
    onSuccess: () => {
      toast.success("Fonte rimossa");
      inv();
    },
    onError: (e) => toast.error(errMsg(e)),
  });
}

export function useTriggerScan() {
  const inv = useInvalidateAll();
  return useMutation({
    mutationFn: () => apiPost<ScanStatus>("/scan"),
    onSuccess: () => {
      toast.success("Scansione AI avviata");
      inv();
    },
    onError: (e) => toast.error(errMsg(e)),
  });
}

export function useEvaluate() {
  const inv = useInvalidateAll();
  return useMutation({
    mutationFn: () => apiPost<ScanStatus>("/bonus/evaluate"),
    onSuccess: () => {
      toast.success("Valutazione idoneità avviata");
      inv();
    },
    onError: (e) => toast.error(errMsg(e)),
  });
}

export function useGenerateDocs() {
  const inv = useInvalidateAll();
  return useMutation({
    mutationFn: (bonus_id: string) => apiPost<DocumentFolder>("/documents", { bonus_id }),
    onSuccess: (f) => {
      toast.success(`Documenti pronti per la firma: ${f.bonus_title}`);
      inv();
    },
    onError: (e) => toast.error(errMsg(e)),
  });
}

export function useUpdateDocStatus() {
  const inv = useInvalidateAll();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: DocStatus }) =>
      apiPatch<DocumentFolder>(`/documents/${id}`, { status }),
    onSuccess: () => {
      toast.success("Stato aggiornato");
      inv();
    },
    onError: (e) => toast.error(errMsg(e)),
  });
}

export function useDeleteDoc() {
  const inv = useInvalidateAll();
  return useMutation({
    mutationFn: (id: string) => apiDelete<{ ok: boolean }>(`/documents/${id}`),
    onSuccess: () => {
      toast.success("Cartella eliminata");
      inv();
    },
    onError: (e) => toast.error(errMsg(e)),
  });
}
