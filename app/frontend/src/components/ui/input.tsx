import * as React from "react";

import { cn } from "@/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "flex h-10 w-full min-w-0 rounded-lg border border-input bg-white px-3 py-2 text-base text-foreground shadow-xs transition-[color,box-shadow] outline-none",
        "placeholder:text-slate-400 selection:bg-[#0056B3] selection:text-white",
        "focus-visible:border-[#0056B3] focus-visible:ring-2 focus-visible:ring-[#0056B3]/25",
        "disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
