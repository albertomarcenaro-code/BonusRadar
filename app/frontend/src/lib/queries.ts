import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  auth,
  DataError,
  deleteDocument,
  fetchScraperCatalog,
  generateDocuments,
  getDashboard,
  getFileUrl,
  getProfile,
  listBonuses,
  listDocuments,
  listFavorites,
  listSources,
  recordQuestionnaire,
  saveProfile as apiSaveProfile,
  scan,
  toggleFavorite,
  updateDocumentStatus,
} from "@/lib/api";
import type { Bonus, DocStatus, ProfileIn } from "@/lib/types";

export { isSupabaseConfigured } from "@/lib/supabase";

export function errMsg(e: unknown): string {
  if (e instanceof DataError) return e.message;
  if (e instanceof Error) return e.message;
  return "Operazione non riuscita";
}

export const useDashboard = () =>
  useQuery({ queryKey: ["dashboard"], queryFn: getDashboard, retry: false });

export const useProfile = () =>
  useQuery({ queryKey: ["profile"], queryFn: getProfile, retry: false });

export const useSources = () =>
  useQuery({ queryKey: ["sources"], queryFn: listSources, retry: false });

/** Catalogo JSON dello scraper: espone generated_at per l'indicatore UI. */
export const useScraperCatalog = () =>
  useQuery({
    queryKey: ["scraper-catalog"],
    queryFn: fetchScraperCatalog,
    retry: false,
    staleTime: 5 * 60_000,
  });

export const useBonuses = (poll = false) =>
  useQuery({
    queryKey: ["bonus"],
    queryFn: listBonuses,
    retry: false,
    refetchInterval: poll ? 8000 : false,
  });

export const useFavorites = () =>
  useQuery({ queryKey: ["favorites"], queryFn: listFavorites, retry: false });

export function useToggleFavorite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (bonusId: string) => toggleFavorite(bonusId),
    onSuccess: (nowFavorite) => {
      toast.success(nowFavorite ? "Aggiunto ai preferiti" : "Rimosso dai preferiti");
      qc.invalidateQueries({ queryKey: ["favorites"] });
    },
    onError: (e) => toast.error(errMsg(e)),
  });
}

export const useDocuments = () =>
  useQuery({ queryKey: ["documents"], queryFn: listDocuments, retry: false });

export const useScanStatus = () =>
  useQuery({ queryKey: ["scan"], queryFn: () => scan.status(), retry: false, refetchInterval: 60000 });

export function useInvalidateAll() {
  const qc = useQueryClient();
  return () => {
    for (const k of ["dashboard", "scan", "bonus", "sources", "documents", "profile", "favorites"]) {
      qc.invalidateQueries({ queryKey: [k] });
    }
  };
}

export function useSaveProfile() {
  const inv = useInvalidateAll();
  return useMutation({
    mutationFn: async (p: ProfileIn) => {
      const saved = await apiSaveProfile(p);
      await recordQuestionnaire(p);
      return saved;
    },
    onSuccess: () => {
      toast.success("Profilo salvato.");
      inv();
    },
    onError: (e) => toast.error(errMsg(e)),
  });
}

export function useAuthActions() {
  const inv = useInvalidateAll();
  return {
    signIn: useMutation({
      mutationFn: ({ email, password }: { email: string; password: string }) => auth.signIn(email, password),
      onSuccess: () => inv(),
      onError: (e) => toast.error(errMsg(e)),
    }),
    signUp: useMutation({
      mutationFn: ({ email, password }: { email: string; password: string }) => auth.signUp(email, password),
      onSuccess: () => inv(),
      onError: (e) => toast.error(errMsg(e)),
    }),
    signOut: useMutation({
      mutationFn: () => auth.signOut(),
      onSuccess: () => inv(),
      onError: (e) => toast.error(errMsg(e)),
    }),
  };
}

/** Scarica il file della pratica: signed URL su Supabase, toast demo altrimenti. */
export function useDownloadDoc() {
  return useMutation({
    mutationFn: ({ doc, kind }: { doc: import("@/lib/types").DocumentFolder; kind: "pdf" | "docx" }) =>
      getFileUrl(doc, kind),
    onSuccess: (url) => {
      if (url) window.open(url, "_blank");
      else toast.info("In modalità demo il documento si genera e scarica al momento della creazione della pratica.");
    },
    onError: (e) => toast.error(errMsg(e)),
  });
}

export function useGenerateDocs() {
  const inv = useInvalidateAll();
  return useMutation({
    mutationFn: ({ bonus, profile }: { bonus: Bonus; profile: import("@/lib/types").Profile }) =>
      generateDocuments(bonus, profile),
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
    mutationFn: ({ id, status }: { id: string; status: DocStatus }) => updateDocumentStatus(id, status),
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
    mutationFn: (id: string) => deleteDocument(id),
    onSuccess: () => {
      toast.success("Cartella eliminata");
      inv();
    },
    onError: (e) => toast.error(errMsg(e)),
  });
}
