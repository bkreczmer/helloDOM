// Single source of slugs and Polish labels for cities, property types and transactions,
// shared by the agent profile (S-02) and the offer and ranking (S-03).
// Keep CITIES and PROPERTY_TYPES in sync with the check constraints in
// supabase/migrations/20261028100000_add_agent_profile.sql, and CITIES, PROPERTY_TYPES and
// TRANSACTIONS with the checks in supabase/migrations/20261028140000_create_offers.sql.

import type { City, PropertyType, Transaction } from "@/types";

// Sorted by Polish name.
export const CITIES = [
  "bialystok",
  "bydgoszcz",
  "gdansk",
  "gorzow-wielkopolski",
  "katowice",
  "kielce",
  "krakow",
  "lublin",
  "lodz",
  "olsztyn",
  "opole",
  "poznan",
  "rzeszow",
  "szczecin",
  "torun",
  "warszawa",
  "wroclaw",
  "zielona-gora",
] as const;

export const CITY_LABELS: Record<City, string> = {
  bialystok: "Białystok",
  bydgoszcz: "Bydgoszcz",
  gdansk: "Gdańsk",
  "gorzow-wielkopolski": "Gorzów Wielkopolski",
  katowice: "Katowice",
  kielce: "Kielce",
  krakow: "Kraków",
  lublin: "Lublin",
  lodz: "Łódź",
  olsztyn: "Olsztyn",
  opole: "Opole",
  poznan: "Poznań",
  rzeszow: "Rzeszów",
  szczecin: "Szczecin",
  torun: "Toruń",
  warszawa: "Warszawa",
  wroclaw: "Wrocław",
  "zielona-gora": "Zielona Góra",
};

export const PROPERTY_TYPES = ["apartment", "house", "plot"] as const;

export const PROPERTY_TYPE_LABELS: Record<PropertyType, string> = {
  apartment: "Mieszkanie",
  house: "Dom",
  plot: "Działka",
};

export const TRANSACTIONS = ["sale", "rent"] as const;

export const TRANSACTION_LABELS: Record<Transaction, string> = {
  sale: "Sprzedaż",
  rent: "Wynajem",
};
