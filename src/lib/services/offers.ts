import { z } from "astro/zod";
import type { Database } from "@/db/database.types";
import { CITIES, PROPERTY_TYPES, TRANSACTIONS } from "@/lib/dictionaries";
import { MAX_PRICE } from "@/lib/services/agent-profile";
import { OFFER_STATUSES, type City, type Offer, type RankedAgent } from "@/types";

// Limits mirror the checks in supabase/migrations/20261028140000_create_offers.sql.
// price is a Postgres integer > 0: upper bound MAX_PRICE, shared with the agent's price range.
// area_m2 is numeric(7, 2): at most 5 digits before the decimal point and 2 after it.
export const AREA_M2_PATTERN = /^\d{1,5}([.,]\d{1,2})?$/;
export const MIN_ROOMS = 1;
export const MAX_ROOMS = 50;
export const MAX_DESCRIPTION_LENGTH = 2000;

// A missing key (`get` returns null) or a blank string means "not set".
const blankToNull = z
  .string()
  .nullable()
  .transform((value) => {
    const trimmed = value?.trim() ?? "";
    return trimmed === "" ? null : trimmed;
  });

export const offerSchema = z.object({
  city: z.enum(CITIES),
  propertyType: z.enum(PROPERTY_TYPES),
  transaction: z.enum(TRANSACTIONS),
  // Required whole number in digits only (no sign, decimals or exponent), 1…MAX_PRICE.
  price: z.string().trim().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(1).max(MAX_PRICE)),
  // Optional; a decimal comma is accepted and stored as a dot.
  areaM2: blankToNull.pipe(
    z
      .string()
      .regex(AREA_M2_PATTERN)
      .transform((value) => Number(value.replace(",", ".")))
      .pipe(z.number().positive())
      .nullable(),
  ),
  rooms: blankToNull.pipe(
    z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(MIN_ROOMS).max(MAX_ROOMS)).nullable(),
  ),
  // Optional free text, trimmed; blank becomes null. Browsers submit textarea line breaks as CRLF,
  // so they are normalised to LF to match the client counter. Length counted like char_length (code points).
  description: blankToNull.pipe(
    z
      .string()
      .transform((value) => value.replace(/\r\n?/g, "\n"))
      .refine((value) => Array.from(value).length <= MAX_DESCRIPTION_LENGTH)
      .nullable(),
  ),
});

export type OfferInput = z.output<typeof offerSchema>;

export function parseOfferForm(formData: FormData) {
  return offerSchema.safeParse({
    city: formData.get("city"),
    propertyType: formData.get("propertyType"),
    transaction: formData.get("transaction"),
    price: formData.get("price"),
    areaM2: formData.get("areaM2"),
    rooms: formData.get("rooms"),
    description: formData.get("description"),
  });
}

type OfferRow = Pick<
  Database["public"]["Tables"]["offers"]["Row"],
  | "id"
  | "city"
  | "property_type"
  | "transaction"
  | "price"
  | "area_m2"
  | "rooms"
  | "description"
  | "status"
  | "created_at"
>;

type RankedAgentRow = Database["public"]["Functions"]["rank_agents_for_offer"]["Returns"][number];

const isCity = (value: string): value is City => (CITIES as readonly string[]).includes(value);

/** Narrows a text column to its dictionary; the check constraints make a miss a schema drift, not user input. */
function oneOf<T extends string>(values: readonly T[], value: string, column: string): T {
  if ((values as readonly string[]).includes(value)) return value as T;
  throw new Error(`offers.${column} outside the dictionary: ${value}`);
}

/** Maps an offers row to the DTO. */
export function toOffer(row: OfferRow): Offer {
  return {
    id: row.id,
    city: oneOf(CITIES, row.city, "city"),
    propertyType: oneOf(PROPERTY_TYPES, row.property_type, "property_type"),
    transaction: oneOf(TRANSACTIONS, row.transaction, "transaction"),
    price: row.price,
    areaM2: row.area_m2,
    rooms: row.rooms,
    description: row.description,
    status: oneOf(OFFER_STATUSES, row.status, "status"),
    createdAt: row.created_at,
  };
}

/** Maps a rank_agents_for_offer row to the DTO. The profiles check keeps cities within the dictionary; the filter narrows the type. */
export function toRankedAgent(row: RankedAgentRow): RankedAgent {
  return {
    agentId: row.agent_id,
    score: row.score,
    experienceYears: row.experience_years,
    cities: row.cities.filter(isCity),
  };
}

export const OFFER_ERROR_CODES = ["invalid_input", "unavailable", "unknown"] as const;

export type OfferErrorCode = (typeof OFFER_ERROR_CODES)[number];

const OFFER_ERROR_MESSAGES: Record<OfferErrorCode, string> = {
  invalid_input: "Sprawdź poprawność danych w formularzu",
  unavailable: "Zapis oferty jest chwilowo niedostępny. Spróbuj ponownie za chwilę.",
  unknown: "Nie udało się zapisać oferty. Spróbuj ponownie.",
};

function isOfferErrorCode(value: string): value is OfferErrorCode {
  return (OFFER_ERROR_CODES as readonly string[]).includes(value);
}

/** Page side: maps a `?error=` value to a Polish message. Arbitrary URL text never reaches the UI. */
export function offerErrorMessage(code: string | null): string | null {
  if (code === null) return null;
  return isOfferErrorCode(code) ? OFFER_ERROR_MESSAGES[code] : OFFER_ERROR_MESSAGES.unknown;
}
