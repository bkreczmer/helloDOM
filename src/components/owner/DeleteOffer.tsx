import { useEffect, useId, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/auth/SubmitButton";
import { useNativeSubmitting } from "@/components/hooks/useNativeSubmitting";
import { cn } from "@/lib/utils";
import type { OfferStatus } from "@/types";

interface DeleteOfferProps {
  offerId: string;
  status: OfferStatus;
}

// Shown before the confirmation, so the server-rendered page already says what the deletion takes away.
const HINT_TEXT: Record<OfferStatus, string> = {
  draft: "Usunięcie kasuje ofertę razem z historią zaproszeń.",
  seeking_agent: "Usunięcie kasuje ofertę razem z historią zaproszeń.",
  invited: "Po usunięciu zaproszony agent straci dostęp do oferty.",
  in_progress: "Po usunięciu agent, który obsługuje tę ofertę, straci do niej dostęp.",
};

const CONFIRM_TEXT: Record<OfferStatus, string> = {
  draft: "Usuniemy ofertę razem z historią zaproszeń. Tego nie da się cofnąć.",
  seeking_agent: "Usuniemy ofertę razem z historią zaproszeń. Tego nie da się cofnąć.",
  invited: "Zaproszony agent straci dostęp do oferty, a zaproszenie zniknie. Tego nie da się cofnąć.",
  in_progress: "Agent, który obsługuje tę ofertę, straci do niej dostęp. Tego nie da się cofnąć.",
};

const textClass = "text-[13px] leading-[1.6] text-rs-fg-2";
const actionsClass = "flex flex-wrap gap-2";

/** "Usuń ofertę" with an inline confirmation: the deletion is final. Submits natively to the API route. */
export function DeleteOffer({ offerId, status }: DeleteOfferProps) {
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useNativeSubmitting();
  const deleteRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const confirmTextId = useId();
  // Which button gets the focus after the step changes; null on the first render, so the page load moves nothing.
  const focusTarget = useRef<"confirm" | "delete" | null>(null);

  useEffect(() => {
    const target = focusTarget.current;
    focusTarget.current = null;
    if (target === "confirm") confirmRef.current?.focus();
    else if (target === "delete") deleteRef.current?.focus();
  }, [confirming]);

  const open = () => {
    focusTarget.current = "confirm";
    setConfirming(true);
  };

  const cancel = () => {
    focusTarget.current = "delete";
    setConfirming(false);
  };

  if (!confirming) {
    return (
      <div className="flex flex-col gap-2.5">
        <p className={textClass}>{HINT_TEXT[status]}</p>
        <div className={actionsClass}>
          <Button ref={deleteRef} type="button" variant="destructive" onClick={open}>
            <Trash2 aria-hidden="true" />
            Usuń ofertę
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form
      method="POST"
      action="/api/owner/offers/delete"
      className="flex flex-col gap-2.5"
      onSubmit={() => {
        setSubmitting(true);
      }}
    >
      <input type="hidden" name="offerId" value={offerId} />
      <p id={confirmTextId} className={cn(textClass, "text-rs-fg font-semibold")}>
        {CONFIRM_TEXT[status]}
      </p>
      <div className={actionsClass}>
        <SubmitButton
          ref={confirmRef}
          pending={submitting}
          pendingText="Usuwanie…"
          icon={<Trash2 aria-hidden="true" />}
          variant="destructive"
          className="w-auto"
          describedBy={confirmTextId}
        >
          Tak, usuń ofertę
        </SubmitButton>
        <Button type="button" variant="ghost" disabled={submitting} onClick={cancel}>
          Anuluj
        </Button>
      </div>
    </form>
  );
}
