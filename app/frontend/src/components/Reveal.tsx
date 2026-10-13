import { useEffect, useRef, useState, type CSSProperties, type ElementType, type HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type RevealProps = HTMLAttributes<HTMLDivElement> & {
  children: React.ReactNode;
  className?: string;
  /** Ritardo in ms prima dell'inizio della transizione (stagger: i * 80~110). */
  delay?: number;
  /** Distanza iniziale di traslazione in px. */
  y?: number;
  style?: CSSProperties;
  as?: ElementType;
};

/**
 * Rivelazione on-scroll: IntersectionObserver toggla data-visible,
 * il CSS (.reveal) fa il motion. Con reduced-motion, o senza
 * IntersectionObserver, il contenuto è visibile subito.
 */
export function Reveal({ children, className, delay = 0, y = 26, style, ...rest }: RevealProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (
      typeof IntersectionObserver === "undefined" ||
      (typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches)
    ) {
      setVisible(true);
      return;
    }
    let frame = 0;
    let done = false;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) show();
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0.15 },
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
      setVisible(true);
      stop();
    };
    // Fallback: se l'observer non scatta (salti di scroll rapidi, ecc.) il
    // contenuto si rivela comunque appena la cima entra o supera il viewport.
    const check = () => {
      if (el.getBoundingClientRect().top < window.innerHeight * 0.9) show();
    };
    io.observe(el);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    check();
    return stop;
  }, []);

  return (
    <div
      ref={ref}
      data-visible={visible}
      className={cn("reveal", className)}
      style={{ "--reveal-delay": `${delay}ms`, "--reveal-y": `${y}px`, ...style } as CSSProperties}
      {...rest}
    >
      {children}
    </div>
  );
}
