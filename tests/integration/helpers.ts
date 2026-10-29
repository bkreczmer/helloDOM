import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "../../src/db/database.types";

type Tables = Database["public"]["Tables"];

export interface TestUser {
  client: SupabaseClient<Database>;
  id: string;
  email: string;
}

export interface AgentProfile {
  cities: string[];
  property_types: string[];
  price_min: number | null;
  price_max: number | null;
  experience_years: number | null;
}

export type OfferFields = Pick<Tables["offers"]["Insert"], "city" | "property_type" | "price"> &
  Partial<Pick<Tables["offers"]["Insert"], "transaction">>;

export interface RankedAgent {
  agentId: string;
  score: number;
}

const PASSWORD = "Integration-Test-Passw0rd!";
// Shared by every account of one run, so leftovers of a failed run are easy to spot and delete.
const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost"]);

// The tests create and delete accounts, so they refuse to run against anything but a local Supabase.
export function supabaseEnv(): { url: string; key: string } {
  const url = process.env.SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_KEY ?? "";
  if (!url || !key) {
    throw new Error("Brak SUPABASE_URL lub SUPABASE_KEY (w .env albo w zmiennych procesu).");
  }
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error(`SUPABASE_URL nie jest poprawnym adresem URL: ${url}`);
  }
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(
      `Testy integracyjne działają tylko na lokalnym Supabase (127.0.0.1 lub localhost), a host to ${host}.`,
    );
  }
  return { url, key };
}

function newClient(): SupabaseClient<Database> {
  const { url, key } = supabaseEnv();
  return createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export function anonClient(): SupabaseClient<Database> {
  return newClient();
}

export async function signUpAs(role: "owner" | "agent", label: string): Promise<TestUser> {
  const client = newClient();
  const email = `it-${label}-${runId}@example.com`;
  const { data, error } = await client.auth.signUp({ email, password: PASSWORD, options: { data: { role } } });
  if (error) {
    throw new Error(`Rejestracja ${email} nie powiodła się: ${error.message}`);
  }
  if (!data.session || !data.user) {
    throw new Error(`Rejestracja ${email} nie zwróciła sesji (czy potwierdzanie e-maila jest wyłączone?).`);
  }
  return { client, id: data.user.id, email };
}

export async function setAgentProfile(user: TestUser, profile: AgentProfile): Promise<void> {
  const { data, error } = await user.client.from("profiles").update(profile).eq("id", user.id).select();
  if (error) {
    throw new Error(`Zapis profilu ${user.email} nie powiódł się: ${error.message}`);
  }
  if (data.length !== 1) {
    throw new Error(`Zapis profilu ${user.email} zmienił ${data.length} wierszy zamiast 1.`);
  }
}

export async function createOffer(owner: TestUser, fields: OfferFields): Promise<string> {
  const { data, error } = await owner.client
    .from("offers")
    .insert({ transaction: "sale", ...fields })
    .select("id")
    .single();
  if (error) {
    throw new Error(`Dodanie oferty przez ${owner.email} nie powiodło się: ${error.message}`);
  }
  return data.id;
}

export async function rank(owner: TestUser, offerId: string): Promise<RankedAgent[]> {
  const { data, error } = await owner.client.rpc("rank_agents_for_offer", { p_offer_id: offerId });
  if (error) {
    throw new Error(`Ranking oferty ${offerId} nie powiódł się: ${error.message}`);
  }
  return data.map((row) => ({ agentId: row.agent_id, score: row.score }));
}

// A probe offer in each city must give an empty ranking, otherwise agents left in the local
// database would take top 3 slots and the expected results would not hold.
// The probe does not see an agent who scores 0 on it (0 years of experience, another type, price
// out of range). Such an agent can cause a false red in R6/R7, but never a false green.
export async function assertCitiesEmpty(owner: TestUser, cities: string[]): Promise<void> {
  for (const city of cities) {
    const probeId = await createOffer(owner, { city, property_type: "apartment", price: 1 });
    // The probe is deleted before any error is raised, and a ranking error wins over a delete error.
    const ranking = await rank(owner, probeId).then(
      (ranked) => ({ ranked, rankError: null }),
      (rankError: unknown) => ({
        ranked: [],
        rankError: rankError instanceof Error ? rankError : new Error(String(rankError)),
      }),
    );
    const { error: deleteError } = await owner.client.from("offers").delete().eq("id", probeId);
    if (ranking.rankError) {
      throw ranking.rankError;
    }
    if (deleteError) {
      throw new Error(`Usunięcie oferty-sondy ${probeId} nie powiodło się: ${deleteError.message}`);
    }
    if (ranking.ranked.length > 0) {
      throw new Error(
        `Lokalna baza ma kompletnych agentów w ${city} — testy wymagają pustego miasta. ` +
          `Pozostałości testów usuniesz: docker exec supabase_db_10x-astro-starter psql -U postgres -c ` +
          `"delete from auth.users where email like 'it-%@example.com' or email like 'smoke-%@example.com' ` +
          `or email like 'e2e-%-%@example.com'". ` +
          `Ostateczność: npx supabase db reset (kasuje wszystkie lokalne konta).`,
      );
    }
  }
}

// Deletes every account, even after a failure; the errors are reported together at the end.
export async function deleteUsers(users: TestUser[]): Promise<void> {
  const errors: string[] = [];
  for (const user of users) {
    const { data, error } = await user.client.rpc("delete_own_account");
    if (error) {
      errors.push(`${user.email}: ${error.message}`);
    } else if (data !== "ok") {
      errors.push(`${user.email}: ${data}`);
    }
  }
  if (errors.length > 0) {
    throw new Error(`Sprzątanie kont testowych nie powiodło się:\n${errors.join("\n")}`);
  }
}
