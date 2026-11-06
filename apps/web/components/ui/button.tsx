import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";

// Pills (design system §4.3): hover lifts 1px with the lift shadow (pointer devices only), press scales 0.98.
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-medium tracking-[-0.01em] transition-[color,background-color,box-shadow,transform] duration-150 ease-[var(--ease-out)] active:scale-[0.98] active:translate-y-0 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:ring-ring/60 focus-visible:ring-[3px] aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:-translate-y-px hover:shadow-lift",
        destructive: "bg-destructive text-white dark:text-background hover:-translate-y-px hover:shadow-lift",
        outline: "border border-border bg-background hover:bg-surface-1",
        secondary: "bg-surface-1 text-foreground border border-border hover:bg-surface-2",
        ghost: "hover:bg-surface-1",
        link: "text-foreground underline-offset-4 hover:underline rounded-none",
      },
      size: {
        default: "h-10 px-5 has-[>svg]:px-4 pointer-coarse:h-11",
        sm: "h-8 gap-1.5 px-3.5 pointer-coarse:h-11",
        lg: "h-14 px-[30px] text-[15px] font-semibold",
        icon: "size-10 pointer-coarse:size-11",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  type,
  ...props
}: React.ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "button";
  return <Comp data-slot="button" className={cn(buttonVariants({ variant, size, className }))} {...(asChild ? {} : { type: type ?? "button" })} {...props} />;
}

export { Button, buttonVariants };
