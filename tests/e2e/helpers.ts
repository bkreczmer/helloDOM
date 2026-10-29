import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";

import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "../../src/db/database.types";
import { supabaseEnv, type TestUser } from "../integration/helpers";

/** An account created by the run, with the browser context that holds its session. */
export interface Account {
  context: BrowserContext;
  email: string;
}

export interface E2EUser extends Account {
  page: Page;
  password: string;
  /** auth.users id, read through the user's own session. */
  id: string;
  /** Session of the same user for reading the database (anon key + JWT, so RLS applies). */
  db: SupabaseClient<Database>;
}

export interface AgentProfileForm {
  cities: string[];
  propertyTypes: string[];
  priceMin: number;
  priceMax: number;
  /** null leaves the profile incomplete, so the agent never enters a ranking. */
  experienceYears: number | null;
}

export interface OfferState {
  status: string;
  price: number;
  description: string | null;
  invitations: { agentId: string; status: string }[];
}

const PASSWORD = "E2E-Test-Passw0rd!";
// Shared by every account of one run, so leftovers of a failed run are easy to spot (e2e-%@example.com).
export const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost"]);

/**
 * Accounts are created by the app server, not by this process: it reads Supabase from .dev.vars
 * (Cloudflare adapter), and the base URL may be any server reused on the port. supabaseEnv() only
 * checks .env, so refuse a non-local app or a non-local Supabase in .dev.vars as well.
 */
function assertLocalApp(baseURL: string): void {
  const appHost = new URL(baseURL).hostname;
  if (!LOCAL_HOSTS.has(appHost)) {
    throw new Error(`Testy E2E zakładają konta tylko w lokalnej aplikacji, a baseURL to ${baseURL}.`);
  }
  if (!existsSync(".dev.vars")) return;
  const devVarsUrl = parseEnv(readFileSync(".dev.vars", "utf8")).SUPABASE_URL ?? "";
  if (!LOCAL_HOSTS.has(URL.canParse(devVarsUrl) ? new URL(devVarsUrl).hostname : "")) {
    throw new Error("SUPABASE_URL w .dev.vars nie wskazuje lokalnego Supabase, a z niego korzysta serwer aplikacji.");
  }
}

// Astro marks an island with the ssr attribute until it has hydrated; a click before that is lost.
// Only client:load islands count: MobileNav (client:media, narrow screens) never hydrates on desktop.
export async function waitForHydration(page: Page): Promise<void> {
  await page.waitForFunction(() => !document.querySelector('astro-island[ssr][client="load"]'));
}

/**
 * A native form POST as the browser would send it: Astro's checkOrigin rejects a form post
 * without the app's own Origin. Redirects are not followed, so the caller sees the 302 target.
 */
export async function postForm(
  user: Account | BrowserContext,
  baseURL: string,
  path: string,
  fields: Record<string, string | number | string[]>,
): Promise<{ status: number; location: string }> {
  const context = "context" in user ? user.context : user;
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) {
    for (const item of Array.isArray(value) ? value : [value]) body.append(key, String(item));
  }
  const response = await context.request.post(path, {
    data: body.toString(),
    headers: { Origin: new URL(baseURL).origin, "Content-Type": "application/x-www-form-urlencoded" },
    maxRedirects: 0,
  });
  const headers: Partial<Record<string, string>> = response.headers();
  return { status: response.status(), location: headers.location ?? "" };
}

/**
 * Signs up through the app's endpoint in a fresh browser context, so the session cookies live there.
 * The account goes to `created` as soon as it exists, so the cleanup deletes it even if a later step throws.
 */
export async function signUp(
  browser: Browser,
  baseURL: string,
  role: "owner" | "agent",
  label: string,
  created: Account[],
): Promise<E2EUser> {
  supabaseEnv(); // refuses to create accounts anywhere but a local Supabase
  assertLocalApp(baseURL);
  const context = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
  const email = `e2e-${label}-${runId}@example.com`;
  const signup = await postForm(context, baseURL, "/api/auth/signup", { email, password: PASSWORD, role });
  // Any redirect without ?error= may have created the account (e.g. /auth/confirm-email when
  // confirmations are on); such an account has no session, so the cleanup reports it by e-mail.
  if (signup.status === 302 && !signup.location.includes("error=")) created.push({ context, email });
  expect(signup, `rejestracja ${email}`).toEqual({ status: 302, location: "/dashboard" });

  const { url, key } = supabaseEnv();
  const db = createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await db.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`Logowanie ${email} do odczytu bazy nie powiodło się: ${error.message}`);

  return { context, page: await context.newPage(), email, password: PASSWORD, id: data.user.id, db };
}

export async function setAgentProfile(agent: E2EUser, baseURL: string, profile: AgentProfileForm): Promise<void> {
  const result = await postForm(agent, baseURL, "/api/agent/profile", {
    cities: profile.cities,
    propertyTypes: profile.propertyTypes,
    priceMin: profile.priceMin,
    priceMax: profile.priceMax,
    experienceYears: profile.experienceYears ?? "",
  });
  expect(result, `profil ${agent.email}`).toEqual({ status: 302, location: "/agent/profile?saved=1" });
}

/** The shape assertCitiesEmpty from the integration helpers expects. */
export function asTestUser(user: E2EUser): TestUser {
  return { client: user.db, id: user.id, email: user.email };
}

/** Offer status and its invitations, read with the owner's session (never service_role). */
export async function readOffer(owner: E2EUser, offerId: string): Promise<OfferState> {
  const { data: offer, error } = await owner.db
    .from("offers")
    .select("status, price, description")
    .eq("id", offerId)
    .single();
  if (error) throw new Error(`Odczyt oferty ${offerId} nie powiódł się: ${error.message}`);
  const { data: invitations, error: invitationsError } = await owner.db
    .from("invitations")
    .select("agent_id, status")
    .eq("offer_id", offerId)
    .order("created_at");
  if (invitationsError) throw new Error(`Odczyt zaproszeń ${offerId} nie powiódł się: ${invitationsError.message}`);
  return {
    status: offer.status,
    price: offer.price,
    description: offer.description,
    invitations: invitations.map((row) => ({ agentId: row.agent_id, status: row.status })),
  };
}

// Deletes every account through the app, even after a failure; the errors are reported together.
export async function deleteAccounts(users: Account[], baseURL: string): Promise<void> {
  const errors: string[] = [];
  for (const user of users) {
    try {
      const result = await postForm(user, baseURL, "/api/account/delete", {});
      if (result.status !== 302 || result.location !== "/?deleted=1") {
        errors.push(`${user.email}: ${result.status} ${result.location}`);
      }
    } catch (error) {
      errors.push(`${user.email}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      await user.context.close();
    }
  }
  if (errors.length > 0) {
    throw new Error(`Sprzątanie kont E2E nie powiodło się:\n${errors.join("\n")}`);
  }
}
