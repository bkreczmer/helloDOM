import { useEffect, useId, useRef, useState } from "react";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/auth/SubmitButton";
import { useNativeSubmitting } from "@/components/hooks/useNativeSubmitting";
import { cn } from "@/lib/utils";

interface InvitationResponseProps {
  offerId: string;
}

type Step = "idle" | "accept" | "reject";

const CONFIRM_TEXT: Record<Exclude<Step, "idle">, string> = {
  accept: "Przyjąć zaproszenie? Oferta przejdzie w obsługę i nie da się tego cofnąć.",
  reject: "Odrzucić zaproszenie? Oferta zniknie z Twojego panelu, a Ty z jej rankingu.",
};

const textClass = "text-[13px] leading-[1.6] text-rs-fg-2";
const actionsClass = "flex flex-wrap gap-2";

/** Accept / reject with an inline confirmation: both answers are final. Submits natively to the API route. */
export function InvitationResponse({ offerId }: InvitationResponseProps) {
  const [step, setStep] = useState<Step>("idle");
  const [submitting, setSubmitting] = useNativeSubmitting();
  const acceptRef = useRef<HTMLButtonElement>(null);
  const rejectRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const confirmTextId = useId();
  // Which button gets the focus after the step changes; null on the first render, so the page load moves nothing.
  const focusTarget = useRef<"confirm" | "accept" | "reject" | null>(null);

  useEffect(() => {
    const target = focusTarget.current;
    focusTarget.current = null;
    if (target === "confirm") confirmRef.current?.focus();
    else if (target === "accept") acceptRef.current?.focus();
    else if (target === "reject") rejectRef.current?.focus();
  }, [step]);

  const open = (next: Exclude<Step, "idle">) => {
    focusTarget.current = "confirm";
    setStep(next);
  };

  const cancel = () => {
    if (step !== "idle") focusTarget.current = step;
    setStep("idle");
  };

  if (step === "idle") {
    return (
      <div className="mt-2 flex flex-col gap-2.5">
        <p className={textClass}>Przyjmij zaproszenie, żeby zająć się ofertą, albo je odrzuć.</p>
        <div className={actionsClass}>
          <Button
            ref={acceptRef}
            type="button"
            variant="accent"
            onClick={() => {
              open("accept");
            }}
          >
            <Check aria-hidden="true" />
            Przyjmij
          </Button>
          <Button
            ref={rejectRef}
            type="button"
            variant="destructive"
            onClick={() => {
              open("reject");
            }}
          >
            <X aria-hidden="true" />
            Odrzuć
          </Button>
        </div>
      </div>
    );
  }

  const accepting = step === "accept";

  return (
    <form
      method="POST"
      action="/api/agent/invitations"
      className="mt-2 flex flex-col gap-2.5"
      onSubmit={() => {
        setSubmitting(true);
      }}
    >
      <input type="hidden" name="offerId" value={offerId} />
      <input type="hidden" name="response" value={step} />
      <p id={confirmTextId} className={cn(textClass, "text-rs-fg font-semibold")}>
        {CONFIRM_TEXT[step]}
      </p>
      <div className={actionsClass}>
        <SubmitButton
          ref={confirmRef}
          pending={submitting}
          pendingText="Zapisywanie…"
          icon={accepting ? <Check aria-hidden="true" /> : <X aria-hidden="true" />}
          variant={accepting ? "accent" : "destructive"}
          className="w-auto"
          describedBy={confirmTextId}
        >
          {accepting ? "Tak, przyjmij" : "Tak, odrzuć"}
        </SubmitButton>
        <Button type="button" variant="ghost" disabled={submitting} onClick={cancel}>
          Anuluj
        </Button>
      </div>
    </form>
  );
}
