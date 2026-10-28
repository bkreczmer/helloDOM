import type { ReactNode } from "react";
import { CircleAlert } from "lucide-react";
import { cn } from "@/lib/utils";

const cardBase =
  "flex min-h-[38px] cursor-pointer items-center gap-2 rounded-control border px-3 py-2 transition-[border-color,background-color,box-shadow] duration-[180ms] ease-rs has-[:focus-visible]:shadow-focus";

export interface ChoiceCardOption<T extends string> {
  value: T;
  label: string;
  icon?: ReactNode;
}

interface ChoiceCardsProps<T extends string> {
  id: string;
  name: string;
  legend: string;
  options: readonly ChoiceCardOption<T>[];
  value: T | "";
  onChange: (value: T) => void;
  error?: string;
}

/** Single-select radio cards (same look as RoleChoice). Submits natively as one `name=value` pair. */
export function ChoiceCards<T extends string>({
  id,
  name,
  legend,
  options,
  value,
  onChange,
  error,
}: ChoiceCardsProps<T>) {
  const errorId = `${id}-error`;

  return (
    <fieldset id={id} aria-describedby={error ? errorId : undefined} className="min-w-0">
      <legend className="text-rs-fg-2 mb-1 block text-[11.5px] font-semibold">{legend}</legend>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-2">
        {options.map((option) => {
          const checked = value === option.value;
          return (
            <label
              key={option.value}
              className={cn(
                cardBase,
                checked
                  ? "border-rs-accent-strong bg-rs-surface-2"
                  : error
                    ? "border-rs-danger bg-rs-input-bg"
                    : "border-rs-input-border bg-rs-input-bg hover:border-rs-fg-3",
              )}
            >
              <input
                type="radio"
                name={name}
                value={option.value}
                checked={checked}
                onChange={() => {
                  onChange(option.value);
                }}
                aria-invalid={error ? true : undefined}
                className="sr-only"
              />
              {option.icon && (
                <span aria-hidden="true" className={cn("shrink-0", checked ? "text-rs-accent-strong" : "text-rs-fg-3")}>
                  {option.icon}
                </span>
              )}
              <span className="font-display text-rs-fg text-[13.5px] font-semibold">{option.label}</span>
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
    </fieldset>
  );
}
