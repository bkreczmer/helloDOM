import { z } from "astro/zod";
import type { Database } from "@/db/database.types";
import { CITIES, PROPERTY_TYPES, TRANSACTIONS } from "@/lib/dictionaries";
import { oneOf } from "@/lib/services/offers";
import { INVITATION_STATUSES, type AgentInvitationItem } from "@/types";

// The agent panel shows the newest invitations only.
export const AGENT_INVITATIONS_LIMIT = 50;

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

type InvitationRow = Database["public"]["Tables"]["invitations"]["Row"];
type OfferRow = Database["public"]["Tables"]["offers"]["Row"];

// Row of `invitations.select("id, status, created_at, offers(id, city, property_type, transaction, price)")`.
type AgentInvitationRow = Pick<InvitationRow, "id" | "status" | "created_at"> & {
  offers: Pick<OfferRow, "id" | "city" | "property_type" | "transaction" | "price"> | null;
};

/** Maps a row of the agent's invitation list to the DTO; a null embed means RLS hides the offer. */
export function toAgentInvitationItem(row: AgentInvitationRow): AgentInvitationItem {
  const offer = row.offers;
  return {
    id: row.id,
    status: oneOf(INVITATION_STATUSES, row.status, "invitations.status"),
    createdAt: row.created_at,
    offer: offer && {
      id: offer.id,
      city: oneOf(CITIES, offer.city, "offers.city"),
      propertyType: oneOf(PROPERTY_TYPES, offer.property_type, "offers.property_type"),
      transaction: oneOf(TRANSACTIONS, offer.transaction, "offers.transaction"),
      price: offer.price,
    },
  };
}
