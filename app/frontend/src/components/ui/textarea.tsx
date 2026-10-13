import * as React from "react";

import { cn } from "@/lib/utils";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex min-h-20 w-full rounded-xl border border-white/10 bg-white/[0.035] px-3.5 py-2.5 text-base text-ink shadow-none transition-[color,border-color,box-shadow] outline-none placeholder:text-dim",
        "focus-visible:border-accent/60 focus-visible:ring-4 focus-visible:ring-accent/10",
        "disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
