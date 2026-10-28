import { useEffect, useId, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/auth/SubmitButton";
import { useNativeSubmitting } from "@/components/hooks/useNativeSubmitting";
import { cn } from "@/lib/utils";
import type { Role } from "@/types";

interface DeleteAccountProps {
  role: Role;
}

const CONFIRM_TEXT: Record<Role, string> = {
  owner: "Usuniemy Twoje konto, wszystkie oferty i zaproszenia. Tego nie da się cofnąć.",
  agent:
    "Usuniemy Twoje konto, profil i zaproszenia. Oferty, które obsługujesz, wrócą do statusu „Szuka agenta”. Tego nie da się cofnąć.",
};

const textClass = "text-[13px] leading-[1.6] text-rs-fg-2";
const actionsClass = "flex flex-wrap gap-2";

/** "Usuń konto" with an inline confirmation: the deletion is final. Submits natively to the API route. */
export function DeleteAccount({ role }: DeleteAccountProps) {
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
        <p className={textClass}>Usunięcie konta kasuje wszystkie Twoje dane w helloDOM.</p>
        <div className={actionsClass}>
          <Button ref={deleteRef} type="button" variant="destructive" onClick={open}>
            <Trash2 aria-hidden="true" />
            Usuń konto
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form
      method="POST"
      action="/api/account/delete"
      className="flex flex-col gap-2.5"
      onSubmit={() => {
        setSubmitting(true);
      }}
    >
      <p id={confirmTextId} className={cn(textClass, "text-rs-fg font-semibold")}>
        {CONFIRM_TEXT[role]}
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
          Tak, usuń konto
        </SubmitButton>
        <Button type="button" variant="ghost" disabled={submitting} onClick={cancel}>
          Anuluj
        </Button>
      </div>
    </form>
  );
}
