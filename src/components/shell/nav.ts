import { LayoutDashboard, type LucideIcon } from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

/** Single source of navigation for Sidebar, MobileNav and Dock. */
export const navConfig: NavItem[] = [{ href: "/dashboard", label: "Panel", icon: LayoutDashboard }];

/** The dock fits at most this many items (design-system.md, Layout). */
export const DOCK_MAX_ITEMS = 5;

export function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
