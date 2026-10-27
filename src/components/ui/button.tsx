import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-control border border-rs-line-strong bg-rs-surface font-display text-[13px] font-semibold text-rs-fg transition-[translate,box-shadow,background-color,border-color,color] duration-[180ms] ease-rs hover:-translate-y-0.5 hover:shadow-[0_6px_18px_rgba(15,23,42,.08)] disabled:pointer-events-none disabled:translate-y-0 disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "",
        primary: "border-rs-fg bg-rs-fg text-rs-surface",
        accent:
          "border-rs-accent bg-rs-accent font-bold text-rs-accent-on hover:border-rs-accent-hover hover:bg-rs-accent-hover",
        ghost: "border-transparent bg-transparent hover:translate-y-0 hover:bg-rs-surface-2 hover:shadow-none",
        link: "border-transparent bg-transparent text-rs-accent-fg underline-offset-4 hover:translate-y-0 hover:underline hover:shadow-none",
        destructive:
          "border-rs-danger bg-rs-danger text-rs-accent-on hover:border-[color-mix(in_oklab,var(--rs-danger)_85%,black)] hover:bg-[color-mix(in_oklab,var(--rs-danger)_85%,black)]",
      },
      size: {
        default: "h-[38px] px-4 py-2.5",
        sm: "h-[30px] gap-1.5 px-3 py-1",
        lg: "h-[46px] px-5 py-3",
        icon: "size-[34px] p-0",
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
