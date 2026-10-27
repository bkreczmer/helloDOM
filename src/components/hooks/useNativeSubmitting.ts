import { useEffect, useState } from "react";

/**
 * Pending state for a form that submits natively (action URL, full page navigation).
 * `useFormStatus` only tracks React form actions, so it never reports pending here.
 * Resets when the page is restored from the back/forward cache, so the button isn't stuck disabled.
 */
export function useNativeSubmitting() {
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) setSubmitting(false);
    };
    window.addEventListener("pageshow", onPageShow);
    return () => {
      window.removeEventListener("pageshow", onPageShow);
    };
  }, []);

  return [submitting, setSubmitting] as const;
}
