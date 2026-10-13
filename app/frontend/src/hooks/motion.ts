import { useEffect, useState } from "react";

/**
 * True quando l'utente ha richiesto reduced-motion a livello di sistema.
 * Usato per mostrare subito i contenuti reveal e per fermare le sequenze
 * animate (log radar, transizioni) senza nascondere nulla.
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

/**
 * IntersectionObserver one-shot: diventa true quando il nodo entra in
 * viewport (con rootMargin negativo in basso per anticipare l'ingresso).
 * Se l'observer non è disponibile, o se il nodo non viene mai osservato,
 * il contenuto resta comunque visibile (setInView(true) di fallback).
 */
export function useInView<T extends HTMLElement>(rootMargin = "0px 0px -12% 0px", threshold = 0.15) {
  const [node, setNode] = useState<T | null>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    if (!node) return;
    if (typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    let frame = 0;
    let done = false;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) show();
      },
      { rootMargin, threshold },
    );
    const onScroll = () => {
      if (!frame)
        frame = requestAnimationFrame(() => {
          frame = 0;
          check();
        });
    };
    const stop = () => {
      if (done) return;
      done = true;
      io.disconnect();
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
    const show = () => {
      setInView(true);
      stop();
    };
    // Fallback: se l'observer non scatta (salti di scroll rapidi) la sequenza
    // parte comunque appena la cima del nodo entra o supera il viewport.
    const check = () => {
      if (node.getBoundingClientRect().top < window.innerHeight * 0.9) show();
    };
    io.observe(node);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    check();
    return stop;
  }, [node, rootMargin, threshold]);
  return { ref: setNode, inView };
}

/**
 * Progresso di scorrimento della pagina, 0 → 1.
 * rAF-throttled su scroll/resize; nessuno scroll-jacking.
 */
export function useScrollProgress(): number {
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    let frame = 0;
    const compute = () => {
      frame = 0;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      setProgress(max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(compute);
    };
    compute();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);
  return progress;
}
