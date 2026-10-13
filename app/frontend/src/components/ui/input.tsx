import * as React from "react";

import { cn } from "@/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "flex h-11 w-full min-w-0 rounded-xl border border-white/10 bg-white/[0.035] px-3.5 py-2 text-base text-ink shadow-none transition-[color,border-color,box-shadow] outline-none",
        "placeholder:text-dim selection:bg-accent/30 selection:text-canvas",
        "focus-visible:border-accent/60 focus-visible:ring-4 focus-visible:ring-accent/10",
        "disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
