import { z } from "astro/zod";
import type { Database } from "@/db/database.types";
import { CITIES, PROPERTY_TYPES } from "@/lib/dictionaries";
import type { AgentProfile, City, PropertyType } from "@/types";

// Upper bound of a Postgres integer column (price_min, price_max).
export const MAX_PRICE = 2_147_483_647;
// Keep in sync with profiles_experience_years_range in the agent profile migration.
export const MAX_EXPERIENCE_YEARS = 60;

const dedupe = <T>(values: T[]): T[] => [...new Set(values)];

// A missing key (`get` returns null) or a blank string means "not set"; anything else must be
// a non-negative whole number written in digits only (no sign, decimals or exponent).
function optionalInteger(max: number) {
  return z
    .string()
    .nullable()
    .transform((value) => {
      const trimmed = value?.trim() ?? "";
      return trimmed === "" ? null : trimmed;
    })
    .pipe(z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(0).max(max)).nullable());
}

export const agentProfileSchema = z
  .object({
    cities: z.array(z.enum(CITIES)).transform(dedupe),
    propertyTypes: z.array(z.enum(PROPERTY_TYPES)).transform(dedupe),
    priceMin: optionalInteger(MAX_PRICE),
    priceMax: optionalInteger(MAX_PRICE),
    experienceYears: optionalInteger(MAX_EXPERIENCE_YEARS),
  })
  .refine((data) => data.priceMin === null || data.priceMax === null || data.priceMin <= data.priceMax, {
    path: ["priceMax"],
  });

export type AgentProfileInput = z.output<typeof agentProfileSchema>;

/** Reads the profile form: checkbox groups via getAll (Object.fromEntries would keep only the last value). */
export function parseAgentProfileForm(formData: FormData) {
  return agentProfileSchema.safeParse({
    cities: formData.getAll("cities"),
    propertyTypes: formData.getAll("propertyTypes"),
    priceMin: formData.get("priceMin"),
    priceMax: formData.get("priceMax"),
    experienceYears: formData.get("experienceYears"),
  });
}

type AgentProfileRow = Pick<
  Database["public"]["Tables"]["profiles"]["Row"],
  "cities" | "property_types" | "price_min" | "price_max" | "experience_years" | "profile_complete"
>;

const isCity = (value: string): value is City => (CITIES as readonly string[]).includes(value);
const isPropertyType = (value: string): value is PropertyType => (PROPERTY_TYPES as readonly string[]).includes(value);

/** Maps a profiles row to the DTO. The check constraints keep text[] within the dictionary; the filter narrows the type. */
export function toAgentProfile(row: AgentProfileRow): AgentProfile {
  return {
    cities: row.cities.filter(isCity),
    propertyTypes: row.property_types.filter(isPropertyType),
    priceMin: row.price_min,
    priceMax: row.price_max,
    experienceYears: row.experience_years,
    // Generated columns are typed nullable by Supabase, but profile_complete is never null.
    complete: row.profile_complete ?? false,
  };
}

export type MissingProfileField = "cities" | "propertyTypes" | "price" | "experience";

/**
 * What keeps the profile out of the ranking, for the UI. Same definition as the generated
 * profiles.profile_complete column; the ranking itself relies on the column, not on this function.
 */
export function missingForRanking(profile: AgentProfile): MissingProfileField[] {
  const missing: MissingProfileField[] = [];
  if (profile.cities.length === 0) missing.push("cities");
  if (profile.propertyTypes.length === 0) missing.push("propertyTypes");
  if (profile.priceMin === null || profile.priceMax === null) missing.push("price");
  if (profile.experienceYears === null) missing.push("experience");
  return missing;
}

export const PROFILE_ERROR_CODES = ["invalid_input", "unavailable", "unknown"] as const;

export type ProfileErrorCode = (typeof PROFILE_ERROR_CODES)[number];

const PROFILE_ERROR_MESSAGES: Record<ProfileErrorCode, string> = {
  invalid_input: "Sprawdź poprawność danych w formularzu",
  unavailable: "Zapis profilu jest chwilowo niedostępny. Spróbuj ponownie za chwilę.",
  unknown: "Nie udało się zapisać profilu. Spróbuj ponownie.",
};

function isProfileErrorCode(value: string): value is ProfileErrorCode {
  return (PROFILE_ERROR_CODES as readonly string[]).includes(value);
}

/** Page side: maps a `?error=` value to a Polish message. Arbitrary URL text never reaches the UI. */
export function profileErrorMessage(code: string | null): string | null {
  if (code === null) return null;
  return isProfileErrorCode(code) ? PROFILE_ERROR_MESSAGES[code] : PROFILE_ERROR_MESSAGES.unknown;
}
