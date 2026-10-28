import { Check, CircleAlert } from "lucide-react";
import { cn } from "@/lib/utils";

const chipBase =
  "flex min-h-[38px] cursor-pointer items-center gap-2 rounded-control border px-3 py-2 font-body text-[13px] leading-snug font-medium text-rs-fg transition-[border-color,background-color,box-shadow] duration-[180ms] ease-rs has-[:focus-visible]:shadow-focus";

export interface ChoiceOption<T extends string> {
  value: T;
  label: string;
}

interface ChoiceChipsProps<T extends string> {
  id: string;
  name: string;
  legend: string;
  options: readonly ChoiceOption<T>[];
  value: readonly T[];
  onChange: (value: T[]) => void;
  error?: string;
  hint?: string;
}

/** Multi-select checkbox tiles (same look as RoleChoice). Submits natively: one `name=value` pair per checked tile. */
export function ChoiceChips<T extends string>({
  id,
  name,
  legend,
  options,
  value,
  onChange,
  error,
  hint,
}: ChoiceChipsProps<T>) {
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(" ") || undefined;

  function toggle(option: T, checked: boolean) {
    // Keep the dictionary order regardless of the click order.
    const next = new Set(value);
    if (checked) next.add(option);
    else next.delete(option);
    onChange(options.map((o) => o.value).filter((v) => next.has(v)));
  }

  return (
    <fieldset id={id} aria-describedby={describedBy} className="min-w-0">
      <legend className="text-rs-fg-2 mb-1 block text-[11.5px] font-semibold">{legend}</legend>
      {hint && (
        <p id={hintId} className="text-rs-fg-3 mb-2 text-[11.5px]">
          {hint}
        </p>
      )}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(136px,1fr))] gap-2">
        {options.map((option) => {
          const checked = value.includes(option.value);
          return (
            <label
              key={option.value}
              className={cn(
                chipBase,
                checked
                  ? "border-rs-accent-strong bg-rs-surface-2"
                  : error
                    ? "border-rs-danger bg-rs-input-bg"
                    : "border-rs-input-border bg-rs-input-bg hover:border-rs-fg-3",
              )}
            >
              <input
                type="checkbox"
                name={name}
                value={option.value}
                checked={checked}
                onChange={(e) => {
                  toggle(option.value, e.target.checked);
                }}
                aria-invalid={error ? true : undefined}
                className="sr-only"
              />
              <span
                aria-hidden="true"
                className={cn(
                  "rounded-badge inline-flex size-4 shrink-0 items-center justify-center border",
                  checked
                    ? "border-rs-accent-strong bg-rs-accent-strong text-rs-accent-on"
                    : "border-rs-input-border bg-rs-input-bg",
                )}
              >
                {checked && <Check className="size-3" strokeWidth={3} />}
              </span>
              <span className="min-w-0">{option.label}</span>
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
