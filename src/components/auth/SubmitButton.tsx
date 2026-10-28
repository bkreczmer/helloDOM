import type { ReactNode, Ref } from "react";
import { Button } from "@/components/ui/button";

interface SubmitButtonProps {
  pending: boolean;
  pendingText: string;
  icon: ReactNode;
  children: ReactNode;
  variant?: "accent" | "destructive";
  className?: string;
  describedBy?: string;
  ref?: Ref<HTMLButtonElement>;
}

export function SubmitButton({
  pending,
  pendingText,
  icon,
  children,
  variant = "accent",
  className = "w-full",
  describedBy,
  ref,
}: SubmitButtonProps) {
  return (
    <Button
      ref={ref}
      type="submit"
      variant={variant}
      disabled={pending}
      aria-describedby={describedBy}
      className={className}
    >
      {pending ? (
        <span className="flex items-center gap-2">
          <span className="size-4 animate-spin rounded-full border-2 border-current/30 border-t-current" />
          {pendingText}
        </span>
      ) : (
        <span className="flex items-center gap-2">
          {icon}
          {children}
        </span>
      )}
    </Button>
  );
}
