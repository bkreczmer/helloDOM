import { LayoutDashboard, type LucideIcon } from "lucide-react";
import { homeFor, matchesPrefix } from "@/lib/route-guard";
import type { Role } from "@/types";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

/** Single source of navigation for Sidebar, MobileNav and Dock. */
export function navFor(role: Role): NavItem[] {
  return [{ href: homeFor(role), label: "Panel", icon: LayoutDashboard }];
}

/** The dock fits at most this many items (design-system.md, Layout). */
export const DOCK_MAX_ITEMS = 5;

export function isActive(pathname: string, href: string): boolean {
  return matchesPrefix(pathname, href);
}
