import { Routes, Route } from "react-router-dom";
import AppShell from "@/components/AppShell";
import Dashboard from "@/pages/Dashboard";
import Questionnaire from "@/pages/Questionnaire";
import BonusCatalog from "@/pages/BonusCatalog";
import Documents from "@/pages/Documents";
import Sources from "@/pages/Sources";

// One <Route> per page in src/pages; BrowserRouter already wraps this in main.tsx.
export default function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/questionnaire" element={<Questionnaire />} />
        <Route path="/bonus" element={<BonusCatalog />} />
        <Route path="/documents" element={<Documents />} />
        <Route path="/sources" element={<Sources />} />
        <Route path="*" element={<Dashboard />} />
      </Route>
    </Routes>
  );
}
