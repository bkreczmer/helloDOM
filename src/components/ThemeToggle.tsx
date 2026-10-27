import { Moon, Sun } from "lucide-react";

type Theme = "light" | "dark";

function toggleTheme() {
  const root = document.documentElement;
  const next: Theme = root.dataset.theme === "dark" ? "light" : "dark";
  root.dataset.theme = next;
  try {
    localStorage.setItem("theme", next);
  } catch {
    // Storage unavailable (private mode, blocked site data): theme still applies for this page.
  }
}

export default function ThemeToggle() {
  return (
    <button
      type="button"
      aria-label="Przełącz motyw"
      onClick={toggleTheme}
      className="rounded-control text-rs-fg-2 ease-rs hover:bg-rs-surface-2 hover:text-rs-fg inline-flex size-[34px] items-center justify-center transition-colors duration-150"
    >
      <Moon className="size-4 dark:hidden" aria-hidden="true" />
      <Sun className="hidden size-4 dark:block" aria-hidden="true" />
    </button>
  );
}
