import * as React from "react";

import { cn } from "@/lib/utils";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex min-h-20 w-full rounded-lg border border-input bg-white px-3 py-2 text-base shadow-xs transition-[color,box-shadow] outline-none placeholder:text-slate-400",
        "focus-visible:border-[#0056B3] focus-visible:ring-2 focus-visible:ring-[#0056B3]/25",
        "disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
