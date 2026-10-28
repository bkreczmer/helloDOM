import type { HTMLAttributes, ReactNode } from "react";
import { CircleAlert } from "lucide-react";
import { cn } from "@/lib/utils";

const inputBase =
  "h-[38px] w-full rounded-control border border-rs-input-border bg-rs-input-bg py-2.5 pr-3 pl-9 font-body text-[13.5px] font-medium text-rs-fg transition-[border-color,box-shadow] duration-[180ms] ease-rs placeholder:text-rs-fg-3 hover:not-focus:not-data-[state=error]:border-rs-fg-3 focus:border-rs-focus-border focus:shadow-focus focus:outline-none data-[state=error]:border-rs-danger";

interface FormFieldProps {
  id: string;
  name?: string;
  label: string;
  type?: string;
  autoComplete?: string;
  inputMode?: HTMLAttributes<HTMLInputElement>["inputMode"];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  error?: string;
  hint?: ReactNode;
  icon: ReactNode;
  endContent?: ReactNode;
}

export function FormField({
  id,
  name,
  label,
  type = "text",
  autoComplete,
  inputMode,
  value,
  onChange,
  placeholder,
  error,
  hint,
  icon,
  endContent,
}: FormFieldProps) {
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;

  return (
    <div>
      <label htmlFor={id} className="text-rs-fg-2 mb-1 block text-[11.5px] font-semibold">
        {label}
      </label>
      <div className="relative">
        <span className="text-rs-fg-3 pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2">{icon}</span>
        <input
          id={id}
          name={name ?? id}
          type={type}
          autoComplete={autoComplete}
          inputMode={inputMode}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
          }}
          placeholder={placeholder}
          data-state={error ? "error" : undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : hint ? hintId : undefined}
          className={cn(inputBase, endContent ? "pr-9" : undefined)}
        />
        {endContent}
      </div>
      {error ? (
        <p id={errorId} className="text-rs-danger-fg mt-1 flex items-center gap-1 text-[11.5px]">
          <CircleAlert className="size-3" />
          {error}
        </p>
      ) : (
        hint && <div id={hintId}>{hint}</div>
      )}
    </div>
  );
}
