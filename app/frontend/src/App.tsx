import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useEffect } from "react";
import AppShell from "@/components/AppShell";
import Dashboard from "@/pages/Dashboard";
import Profile from "@/pages/Profile";
import BonusCatalog from "@/pages/BonusCatalog";
import Landing from "@/pages/Landing";
import Auth from "@/pages/Auth";

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
        <Route path="/auth" element={<Auth />} />

        {/* Autenticate (shell con sidebar + bottom nav) */}
        <Route element={<AppShell />}>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/bonus" element={<BonusCatalog />} />
        </Route>

        {/* Compatibilità con le vecchie rotte */}
        <Route path="/questionnaire" element={<Navigate to="/profile" replace />} />
        <Route path="/documents" element={<Navigate to="/profile" replace />} />
        <Route path="/sources" element={<Navigate to="/" replace />} />

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}
