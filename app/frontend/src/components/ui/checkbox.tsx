import * as React from "react";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { CheckIcon } from "lucide-react";

import { cn } from "@/lib/utils";

function Checkbox({ className, ...props }: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "peer size-5 shrink-0 rounded border border-slate-300 bg-white shadow-xs transition-shadow outline-none",
        "focus-visible:border-[#0056B3] focus-visible:ring-2 focus-visible:ring-[#0056B3]/25",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "data-[state=checked]:border-[#0056B3] data-[state=checked]:bg-[#0056B3] data-[state=checked]:text-white",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator data-slot="checkbox-indicator" className="flex items-center justify-center text-current">
        <CheckIcon className="size-3.5" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export { Checkbox };
