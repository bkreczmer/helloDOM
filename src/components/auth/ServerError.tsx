import { CircleAlert } from "lucide-react";

interface ServerErrorProps {
  message?: string | null;
}

export function ServerError({ message }: ServerErrorProps) {
  if (!message) return null;

  return (
    <p
      role="alert"
      className="rounded-control bg-rs-danger-soft text-rs-danger-fg flex items-center gap-2 border border-[color-mix(in_oklab,var(--rs-danger)_30%,transparent)] px-3 py-2 text-[13px]"
    >
      <CircleAlert className="size-4 shrink-0" />
      {message}
    </p>
  );
}
