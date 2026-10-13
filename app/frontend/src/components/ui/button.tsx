import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-semibold transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-[linear-gradient(180deg,#8bf3ff_0%,#22d3ee_45%,#0ea5e9_100%)] text-[#03121b] shadow-[0_10px_30px_-12px_rgba(34,211,238,0.75)] hover:shadow-[0_14px_34px_-10px_rgba(34,211,238,0.85)] hover:brightness-105 active:brightness-95",
        destructive: "bg-negative text-[#2a0410] hover:brightness-105",
        outline:
          "border border-white/12 bg-white/[0.04] text-ink backdrop-blur-sm hover:border-white/25 hover:bg-white/[0.08]",
        secondary: "bg-white text-[#04060d] hover:bg-white/90",
        ghost: "text-muted hover:bg-white/[0.07] hover:text-ink",
        link: "text-accent underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-lg px-3 text-[0.8125rem]",
        lg: "h-12 rounded-xl px-7 text-base",
        icon: "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot : "button";
  return <Comp data-slot="button" className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}

export { Button, buttonVariants };
