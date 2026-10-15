import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Suspense, lazy, useEffect } from "react";
import AppShell from "@/components/AppShell";
import Landing from "@/pages/Landing";

// Code-splitting: la landing (pagina pubblica di ingresso) resta nel bundle
// principale; le pagine autenticate e l'auth vengono scaricate al primo accesso.
const Dashboard = lazy(() => import("@/pages/Dashboard"));
const Profile = lazy(() => import("@/pages/Profile"));
const BonusCatalog = lazy(() => import("@/pages/BonusCatalog"));
const Auth = lazy(() => import("@/pages/Auth"));

/** Skeleton leggero mostrato mentre il chunk della pagina viene scaricato. */
function PageFallback() {
  return (
    <div className="grid min-h-svh place-items-center bg-canvas">
      <div className="h-10 w-40 animate-pulse rounded-lg bg-white/[0.06]" />
    </div>
  );
}

/** Scroll automatico all'inizio pagina a ogni cambio rotta. */
function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

export default function App() {
  return (
    <>
      <ScrollToTop />
      <Routes>
        {/* Pubbliche */}
        <Route path="/" element={<Landing />} />
        <Route path="/auth" element={<Suspense fallback={<PageFallback />}><Auth /></Suspense>} />

        {/* Autenticate (shell con sidebar + bottom nav) */}
        <Route element={<AppShell />}>
          <Route path="/dashboard" element={<Suspense fallback={<PageFallback />}><Dashboard /></Suspense>} />
          <Route path="/profile" element={<Suspense fallback={<PageFallback />}><Profile /></Suspense>} />
          <Route path="/bonus" element={<Suspense fallback={<PageFallback />}><BonusCatalog /></Suspense>} />
        </Route>

        {/* Compatibilità con le vecchie rotte: da loggato non si finisce mai sulla landing */}
        <Route path="/questionnaire" element={<Navigate to="/profile" replace />} />
        <Route path="/documents" element={<Navigate to="/profile" replace />} />
        <Route path="/sources" element={<Navigate to="/dashboard" replace />} />

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}
