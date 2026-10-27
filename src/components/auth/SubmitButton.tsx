import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";

interface SubmitButtonProps {
  pending: boolean;
  pendingText: string;
  icon: ReactNode;
  children: ReactNode;
}

export function SubmitButton({ pending, pendingText, icon, children }: SubmitButtonProps) {
  return (
    <Button type="submit" variant="accent" disabled={pending} className="w-full">
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
