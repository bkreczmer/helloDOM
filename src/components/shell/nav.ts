import { FilePlus2, LayoutDashboard, UserCog, UserRound, type LucideIcon } from "lucide-react";
import { ROLE_PREFIXES, homeFor, matchesPrefix } from "@/lib/route-guard";
import type { Role } from "@/types";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

/** Single source of navigation for Sidebar, MobileNav and Dock. */
export function navFor(role: Role): NavItem[] {
  const home: NavItem = { href: homeFor(role), label: "Panel", icon: LayoutDashboard };
  const account: NavItem = { href: `${homeFor(role)}/account`, label: "Konto", icon: UserCog };
  if (role === "agent") {
    return [home, { href: "/agent/profile", label: "Profil", icon: UserRound }, account];
  }
  return [home, { href: "/owner/offers/new", label: "Nowa oferta", icon: FilePlus2 }, account];
}

/** The dock fits at most this many items (design-system.md, Layout). */
export const DOCK_MAX_ITEMS = 5;

const HOME_PATHS: readonly string[] = Object.values(ROLE_PREFIXES);

/** A role's home ("Panel") is active only on itself; any other item also on its subpages. */
export function isActive(pathname: string, href: string): boolean {
  return HOME_PATHS.includes(href) ? pathname === href : matchesPrefix(pathname, href);
}
