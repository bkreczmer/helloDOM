import type { Database } from "@/db/database.types";
import type { CITIES, PROPERTY_TYPES } from "@/lib/dictionaries";

export const ROLES = ["owner", "agent"] as const;

export type Role = (typeof ROLES)[number];

export type City = (typeof CITIES)[number];

export type PropertyType = (typeof PROPERTY_TYPES)[number];

type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"];

// The generated type has `role: string`; the check constraint guarantees it is a Role.
export type Profile = Omit<ProfileRow, "role"> & { role: Role };

// Agent profile DTO for the profile page and endpoint. The check constraints guarantee
// that the stored text[] values are dictionary slugs; mapping from ProfileRow lives in the service.
export interface AgentProfile {
  cities: City[];
  propertyTypes: PropertyType[];
  priceMin: number | null;
  priceMax: number | null;
  experienceYears: number | null;
  complete: boolean;
}
