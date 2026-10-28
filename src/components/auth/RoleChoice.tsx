import type { ReactNode } from "react";
import { BriefcaseBusiness, CircleAlert, Home } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Role } from "@/types";

const OPTIONS: { value: Role; label: string; description: string; icon: ReactNode }[] = [
  {
    value: "owner",
    label: "Właściciel",
    description: "Chcę sprzedać lub wynająć nieruchomość",
    icon: <Home className="size-5" />,
  },
  {
    value: "agent",
    label: "Agent",
    description: "Pośredniczę w sprzedaży i wynajmie",
    icon: <BriefcaseBusiness className="size-5" />,
  },
];

const cardBase =
  "flex cursor-pointer flex-col gap-1.5 rounded-control border p-3 transition-[border-color,background-color,box-shadow] duration-[180ms] ease-rs has-[:focus-visible]:shadow-focus";

interface RoleChoiceProps {
  value: Role | "";
  onChange: (role: Role) => void;
  error?: string;
}

export function RoleChoice({ value, onChange, error }: RoleChoiceProps) {
  const errorId = "role-error";
  const noteId = "role-note";

  return (
    <fieldset aria-describedby={error ? `${errorId} ${noteId}` : noteId}>
      <legend className="text-rs-fg-2 mb-1 block text-[11.5px] font-semibold">Kim jesteś?</legend>
      <div className="grid grid-cols-2 gap-2">
        {OPTIONS.map((option) => {
          const checked = value === option.value;
          return (
            <label
              key={option.value}
              className={cn(
                cardBase,
                checked
                  ? "border-rs-accent-strong bg-rs-surface-2"
                  : error
                    ? "border-rs-danger"
                    : "border-rs-input-border hover:border-rs-fg-3",
              )}
            >
              <input
                type="radio"
                name="role"
                value={option.value}
                checked={checked}
                onChange={() => {
                  onChange(option.value);
                }}
                aria-invalid={error ? true : undefined}
                className="sr-only"
              />
              <span className={cn(checked ? "text-rs-accent-strong" : "text-rs-fg-3")}>{option.icon}</span>
              <span className="font-display text-rs-fg text-[13.5px] font-semibold">{option.label}</span>
              <span className="text-rs-fg-2 text-[11.5px] leading-snug">{option.description}</span>
            </label>
          );
        })}
      </div>
      {error && (
        <p id={errorId} className="text-rs-danger-fg mt-1 flex items-center gap-1 text-[11.5px]">
          <CircleAlert className="size-3" />
          {error}
        </p>
      )}
      <p id={noteId} className="text-rs-fg-3 mt-1 text-[11.5px]">
        Roli nie można później zmienić.
      </p>
    </fieldset>
  );
}
