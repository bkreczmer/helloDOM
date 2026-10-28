import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

// design-system.md, Badge: 600 10.5px, padding 3×7, radius 4, accent-soft background, accent-fg text.
// In dark, accent-soft stays near-white while accent-fg turns light, so dark uses surface-3 / fg instead
// (light: accent-fg on accent-soft ≈ 7:1; dark: fg on surface-3 ≈ 10:1).
const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-badge px-[7px] py-[3px] font-display text-[10.5px] font-semibold [&>svg]:pointer-events-none [&>svg]:size-3",
  {
    variants: {
      variant: {
        default: "bg-rs-accent-soft text-rs-accent-fg dark:bg-rs-surface-3 dark:text-rs-fg",
        secondary: "bg-rs-surface-2 text-rs-fg",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function Badge({
  className,
  variant,
  asChild = false,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "span";

  return <Comp data-slot="badge" className={cn(badgeVariants({ variant, className }))} {...props} />;
}

export { Badge, badgeVariants };
