import type { Database } from "@/db/database.types";

export const ROLES = ["owner", "agent"] as const;

export type Role = (typeof ROLES)[number];

type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"];

// The generated type has `role: string`; the check constraint guarantees it is a Role.
export type Profile = Omit<ProfileRow, "role"> & { role: Role };
