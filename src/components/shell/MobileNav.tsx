import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Menu } from "lucide-react";
import { cn } from "@/lib/utils";
import { isActive, navConfig } from "@/components/shell/nav";

interface MobileNavProps {
  pathname: string;
}

const DRAWER_ID = "mobile-nav-drawer";
const TABLET_UP = "(min-width: 641px)"; // --breakpoint-tablet in global.css
const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function MobileNav({ pathname }: MobileNavProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const firstLinkRef = useRef<HTMLAnchorElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const wasOpen = useRef(false);

  const close = () => {
    setOpen(false);
  };

  useEffect(() => {
    if (!open) {
      if (wasOpen.current) triggerRef.current?.focus();
      wasOpen.current = false;
      return;
    }
    wasOpen.current = true;
    firstLinkRef.current?.focus();

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        close();
        return;
      }
      // Focus trap: aria-modal promises that Tab stays inside the drawer.
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    // The drawer is portaled out of the tablet:hidden wrapper, so close it once the viewport leaves mobile.
    const tabletUp = window.matchMedia(TABLET_UP);
    const onBreakpoint = (event: MediaQueryListEvent) => {
      if (event.matches) close();
    };
    tabletUp.addEventListener("change", onBreakpoint);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
      tabletUp.removeEventListener("change", onBreakpoint);
    };
  }, [open]);

  return (
    <div className="tablet:hidden">
      <button
        ref={triggerRef}
        type="button"
        aria-label="Otwórz nawigację"
        aria-expanded={open}
        aria-controls={open ? DRAWER_ID : undefined}
        onClick={() => {
          setOpen(true);
        }}
        className="rounded-control text-rs-fg-2 ease-rs hover:bg-rs-surface-2 hover:text-rs-fg inline-flex size-9 items-center justify-center transition-colors duration-150"
      >
        <Menu className="size-5" aria-hidden="true" />
      </button>
      {open &&
        // Portal: the sticky topbar (z-10) is a stacking context; the drawer must sit above the dock (z-50).
        createPortal(
          <div className="fixed inset-0 z-[110]">
            <div aria-hidden="true" onClick={close} className="bg-rs-overlay absolute inset-0 backdrop-blur-[2px]" />
            <div
              ref={dialogRef}
              id={DRAWER_ID}
              role="dialog"
              aria-modal="true"
              aria-label="Nawigacja"
              className="bg-rs-surface border-rs-line absolute inset-y-0 left-0 flex w-[86%] max-w-[320px] flex-col gap-6 border-r px-3.5 py-[22px]"
            >
              <a
                href="/dashboard"
                className="font-display text-rs-accent-fg dark:text-rs-fg px-2.5 text-[18px] font-bold"
              >
                helloDOM
              </a>
              <nav aria-label="Główna nawigacja">
                <ul className="flex flex-col gap-1">
                  {navConfig.map(({ href, label, icon: Icon }, index) => {
                    const active = isActive(pathname, href);
                    return (
                      <li key={href}>
                        <a
                          ref={index === 0 ? firstLinkRef : undefined}
                          href={href}
                          aria-current={active ? "page" : undefined}
                          onClick={close}
                          className={cn(
                            "font-display text-rs-fg-2 ease-rs hover:bg-rs-surface-2 hover:text-rs-fg flex items-center gap-2.5 rounded-sm px-2.5 py-[9px] text-[13.5px] font-medium transition-colors duration-[120ms]",
                            active && "bg-rs-surface-2 text-rs-fg font-semibold",
                          )}
                        >
                          <Icon
                            className={cn("size-4 shrink-0", active && "text-rs-accent-strong")}
                            aria-hidden="true"
                          />
                          {label}
                        </a>
                      </li>
                    );
                  })}
                </ul>
              </nav>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
