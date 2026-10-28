import { z } from "astro/zod";

// Hidden fields of the "Zaproś" form on a ranking card (src/components/owner/RankingList.astro).
export const inviteSchema = z.object({
  offerId: z.uuid(),
  agentId: z.uuid(),
});

export type InviteInput = z.output<typeof inviteSchema>;

export function parseInviteForm(formData: FormData) {
  return inviteSchema.safeParse({
    offerId: formData.get("offerId"),
    agentId: formData.get("agentId"),
  });
}

// Return values of public.invite_agent in supabase/migrations/20261028180000_create_invitations.sql.
export const INVITE_RESULTS = ["ok", "not_found", "offer_locked", "agent_not_ranked"] as const;

export type InviteResult = (typeof INVITE_RESULTS)[number];

export function isInviteResult(value: unknown): value is InviteResult {
  return typeof value === "string" && (INVITE_RESULTS as readonly string[]).includes(value);
}

export const INVITATION_ERROR_CODES = [
  "invalid_input",
  "unavailable",
  "unknown",
  "offer_locked",
  "agent_not_ranked",
] as const;

export type InvitationErrorCode = (typeof INVITATION_ERROR_CODES)[number];

const INVITATION_ERROR_MESSAGES: Record<InvitationErrorCode, string> = {
  invalid_input: "Nie udało się odczytać zaproszenia. Wybierz agenta z listy i spróbuj ponownie.",
  unavailable: "Wysyłanie zaproszeń jest chwilowo niedostępne. Spróbuj ponownie za chwilę.",
  unknown: "Nie udało się wysłać zaproszenia. Spróbuj ponownie.",
  offer_locked: "Do tej oferty wysłano już zaproszenie.",
  agent_not_ranked: "Ranking agentów się zmienił. Wybierz agenta z aktualnej listy.",
};

function isInvitationErrorCode(value: string): value is InvitationErrorCode {
  return (INVITATION_ERROR_CODES as readonly string[]).includes(value);
}

/** Page side: maps a `?error=` value to a Polish message. Arbitrary URL text never reaches the UI. */
export function invitationErrorMessage(code: string | null): string | null {
  if (code === null) return null;
  return isInvitationErrorCode(code) ? INVITATION_ERROR_MESSAGES[code] : INVITATION_ERROR_MESSAGES.unknown;
}
