import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";

// Chips and status pills (design system §4.6): 13px, pill, soft surface. Status = dot + word.
const badgeVariants = cva(
  "inline-flex items-center justify-center rounded-full px-2.5 py-0.5 text-[13px] leading-5 font-medium tracking-[-0.01em] w-fit whitespace-nowrap shrink-0 [&>svg]:size-3 gap-1.5 [&>svg]:pointer-events-none focus-visible:ring-ring/60 focus-visible:ring-[3px] overflow-hidden",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground",
        secondary: "bg-surface-1 text-foreground",
        destructive: "bg-destructive text-white dark:text-background",
        outline: "bg-surface-1 text-muted-foreground",
        success: "bg-surface-1 text-success",
        warning: "bg-surface-1 text-warning",
        danger: "bg-surface-1 text-destructive",
        stub: "font-mono text-[11px] text-muted-foreground border border-dashed border-muted-foreground/60 bg-transparent",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

function Badge({ className, variant, asChild = false, ...props }: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "span";
  return <Comp data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />;
}

/** The coloured dot inside a pill (the dot colours are fills only; the label carries the meaning). */
function Dot({ tone, className }: { tone: "pass" | "block" | "pending" | "idle"; className?: string }) {
  const bg = tone === "pass" ? "bg-pass-dot" : tone === "block" ? "bg-block-dot" : tone === "pending" ? "bg-pending-dot" : "bg-muted-2";
  return <span aria-hidden="true" className={cn("inline-block size-2 shrink-0 rounded-full", bg, className)} />;
}

export { Badge, Dot, badgeVariants };
