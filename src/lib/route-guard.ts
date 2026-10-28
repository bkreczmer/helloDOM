import type { Role } from "@/types";

/** Each role's panel lives under its own prefix; a page in the app shell must sit under one of them. */
export const ROLE_PREFIXES: Record<Role, string> = { owner: "/owner", agent: "/agent" };

/** Paths that require a session and a profile. `/dashboard` only routes to the role's panel. */
export const GATED_PATHS = ["/dashboard", ...Object.values(ROLE_PREFIXES)];

/** True for the prefix itself and anything below it, but not for `/ownerx`. */
export function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function requiredRole(pathname: string): Role | null {
  const match = (Object.entries(ROLE_PREFIXES) as [Role, string][]).find(([, prefix]) =>
    matchesPrefix(pathname, prefix),
  );
  return match ? match[0] : null;
}

export function isGated(pathname: string): boolean {
  return GATED_PATHS.some((prefix) => matchesPrefix(pathname, prefix));
}

export function homeFor(role: Role): string {
  return ROLE_PREFIXES[role];
}
