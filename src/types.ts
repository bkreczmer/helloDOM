import type { Database } from "@/db/database.types";
import type { CITIES, PROPERTY_TYPES, TRANSACTIONS } from "@/lib/dictionaries";

export const ROLES = ["owner", "agent"] as const;

export type Role = (typeof ROLES)[number];

export type City = (typeof CITIES)[number];

export type PropertyType = (typeof PROPERTY_TYPES)[number];

export type Transaction = (typeof TRANSACTIONS)[number];

// Keep in sync with offers_status_valid in supabase/migrations/20261028140000_create_offers.sql.
export const OFFER_STATUSES = ["draft", "seeking_agent", "invited", "in_progress"] as const;

export type OfferStatus = (typeof OFFER_STATUSES)[number];

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

// Offer DTO. The check constraints in the create_offers migration guarantee that city,
// property_type, transaction and status are dictionary values; mapping lives in the offers service.
export interface Offer {
  id: string;
  city: City;
  propertyType: PropertyType;
  transaction: Transaction;
  price: number;
  areaM2: number | null;
  rooms: number | null;
  description: string | null;
  status: OfferStatus;
  createdAt: string;
}

// One row of rank_agents_for_offer: anonymous on purpose (no e-mail or name), position comes from the order.
export interface RankedAgent {
  agentId: string;
  score: number;
  experienceYears: number;
  cities: City[];
}
