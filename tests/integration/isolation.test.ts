// Risk #2 from context/foundation/test-plan.md: a user without access reads or changes someone
// else's offers, invitations or profiles. Every request goes to PostgREST with a real session JWT
// (or none, for anon), so RLS, grants and the auth.uid() gates in the RPCs are what is tested.
// An empty answer counts as proof only next to a positive control: the same data is visible to
// the user who should see it, in the same run.
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  anonClient,
  assertCitiesEmpty,
  createOffer,
  deleteUsers,
  rank,
  setAgentProfile,
  signUpAs,
  type AgentProfile,
  type TestUser,
} from "./helpers";

const G_PROFILE: AgentProfile = {
  cities: ["torun"],
  property_types: ["apartment"],
  price_min: 300_000,
  price_max: 500_000,
  experience_years: 10,
};
// Complete, but in another city, so H is never ranked for X and never invited.
const H_PROFILE: AgentProfile = {
  cities: ["kielce"],
  property_types: ["apartment"],
  price_min: 300_000,
  price_max: 500_000,
  experience_years: 10,
};

// Cases I1–I16 (plan of change testing-ranking-and-isolation, phase 2).
// Accepted disclosures, which this test does not treat as a leak:
// - the invited agent sees the offer's owner_id (agent-invitation F4): G reads the whole row of X;
// - the owner gets agent data (id, score, experience_years, cities) from rank_agents_for_offer for
//   their own offer (offer-top3-ranking F3): A sees G's data in I2.
describe("izolacja danych między użytkownikami (RLS i RPC)", () => {
  const users: TestUser[] = [];
  let ownerA: TestUser;
  let ownerB: TestUser;
  let agentG: TestUser;
  let agentH: TestUser;
  let offerX: string;

  // Positive controls reused after B's and H's attempts: A still sees X exactly as created.
  async function readXAsA() {
    const { data, error } = await ownerA.client
      .from("offers")
      .select("id, owner_id, status, description")
      .eq("id", offerX);
    expect(error).toBeNull();
    return data;
  }

  async function invitationsOfXAsA() {
    const { data, error } = await ownerA.client.from("invitations").select("agent_id, status").eq("offer_id", offerX);
    expect(error).toBeNull();
    return data;
  }

  async function readProfile(user: TestUser, id: string) {
    const { data, error } = await user.client
      .from("profiles")
      .select("id, cities, property_types, price_min, price_max, experience_years")
      .eq("id", id);
    expect(error).toBeNull();
    return data;
  }

  beforeAll(async () => {
    // One by one: the auth rate limit, and the city guard must run before any agent of this test exists.
    ownerA = await signUpAs("owner", "iso-a");
    users.push(ownerA);
    await assertCitiesEmpty(ownerA, ["torun"]);
    ownerB = await signUpAs("owner", "iso-b");
    users.push(ownerB);
    agentG = await signUpAs("agent", "iso-g");
    users.push(agentG);
    await setAgentProfile(agentG, G_PROFILE);
    agentH = await signUpAs("agent", "iso-h");
    users.push(agentH);
    await setAgentProfile(agentH, H_PROFILE);

    offerX = await createOffer(ownerA, { city: "torun", property_type: "apartment", price: 400_000 });
    const invite = await ownerA.client.rpc("invite_agent", { p_offer_id: offerX, p_agent_id: agentG.id });
    if (invite.error || invite.data !== "ok") {
      throw new Error(`Zaproszenie G do oferty X nie powiodło się: ${invite.error?.message ?? invite.data}`);
    }
  });

  afterAll(async () => {
    await deleteUsers(users);
  });

  it("I1: właściciel A widzi swoją ofertę X", async () => {
    expect(await readXAsA()).toEqual([{ id: offerX, owner_id: ownerA.id, status: "invited", description: null }]);
  });

  it("I2: właściciel A dostaje ranking X z agentem G", async () => {
    expect((await rank(ownerA, offerX)).map((r) => r.agentId)).toEqual([agentG.id]);
  });

  it("I3: właściciel A widzi zaproszenie G do X", async () => {
    expect(await invitationsOfXAsA()).toEqual([{ agent_id: agentG.id, status: "pending" }]);
  });

  it("I4: zaproszony agent G widzi ofertę X", async () => {
    const { data, error } = await agentG.client.from("offers").select("id").eq("id", offerX);
    expect(error).toBeNull();
    expect(data).toEqual([{ id: offerX }]);
  });

  it("I5: właściciel B nie widzi oferty X", async () => {
    const { data, error } = await ownerB.client.from("offers").select("id").eq("id", offerX);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("I6: właściciel B nie zmienia oferty X; A czyta X bez zmian", async () => {
    const { data, error } = await ownerB.client
      .from("offers")
      .update({ description: "Przejęte przez B" })
      .eq("id", offerX)
      .select("id");
    expect(error).toBeNull();
    expect(data).toEqual([]);
    expect(await readXAsA()).toEqual([{ id: offerX, owner_id: ownerA.id, status: "invited", description: null }]);
  });

  it("I7: właściciel B nie usuwa oferty X; A nadal ją widzi", async () => {
    const { data, error } = await ownerB.client.from("offers").delete().eq("id", offerX).select("id");
    expect(error).toBeNull();
    expect(data).toEqual([]);
    expect(await readXAsA()).toHaveLength(1);
  });

  it("I8: właściciel B nie dodaje oferty na konto A; A ma tylko ofertę X", async () => {
    const { data, error } = await ownerB.client
      .from("offers")
      .insert({ city: "torun", property_type: "apartment", transaction: "sale", price: 1, owner_id: ownerA.id })
      .select("id");
    expect(data).toBeNull();
    // No insert grant on owner_id: permission denied for the column.
    expect(error?.code).toBe("42501");

    const { data: offersOfA, error: readError } = await ownerA.client
      .from("offers")
      .select("id")
      .eq("owner_id", ownerA.id);
    expect(readError).toBeNull();
    expect(offersOfA).toEqual([{ id: offerX }]);
  });

  it("I9: właściciel B dostaje pusty ranking cudzej oferty X", async () => {
    expect(await rank(ownerB, offerX)).toEqual([]);
  });

  it("I10: właściciel B nie zaprasza agenta do oferty X; A widzi tylko zaproszenie G", async () => {
    const { data, error } = await ownerB.client.rpc("invite_agent", { p_offer_id: offerX, p_agent_id: agentH.id });
    expect(error).toBeNull();
    expect(data).toBe("not_found");
    expect(await invitationsOfXAsA()).toEqual([{ agent_id: agentG.id, status: "pending" }]);
  });

  it("I11: właściciel B nie widzi zaproszeń do oferty X", async () => {
    const { data, error } = await ownerB.client.from("invitations").select("id").eq("offer_id", offerX);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("I12: właściciel B widzi tylko własny profil, profil A nie", async () => {
    const { data, error } = await ownerB.client.from("profiles").select("id");
    expect(error).toBeNull();
    expect(data).toEqual([{ id: ownerB.id }]);
    expect(await readProfile(ownerB, ownerA.id)).toEqual([]);
  });

  it("I13: niezaproszony agent H nie widzi oferty X ani zaproszeń do niej", async () => {
    const offers = await agentH.client.from("offers").select("id").eq("id", offerX);
    expect(offers.error).toBeNull();
    expect(offers.data).toEqual([]);
    const invitations = await agentH.client.from("invitations").select("id").eq("offer_id", offerX);
    expect(invitations.error).toBeNull();
    expect(invitations.data).toEqual([]);
  });

  it("I14: niezaproszony agent H nie przyjmuje zaproszenia do X; stan X i zaproszenia G bez zmian", async () => {
    const { data, error } = await agentH.client.rpc("respond_to_invitation", {
      p_offer_id: offerX,
      p_response: "accept",
    });
    expect(error).toBeNull();
    expect(data).toBe("not_found");
    expect((await readXAsA())?.map((offer) => offer.status)).toEqual(["invited"]);
    expect(await invitationsOfXAsA()).toEqual([{ agent_id: agentG.id, status: "pending" }]);
  });

  it("I15: zaproszony agent G nie czyta profili A i H, nie dostaje rankingu X i nie zmienia profilu H", async () => {
    expect(await readProfile(agentG, ownerA.id)).toEqual([]);
    expect(await readProfile(agentG, agentH.id)).toEqual([]);
    expect(await rank(agentG, offerX)).toEqual([]);

    const { data, error } = await agentG.client
      .from("profiles")
      .update({ cities: ["torun"], experience_years: 0 })
      .eq("id", agentH.id)
      .select("id");
    expect(error).toBeNull();
    expect(data).toEqual([]);
    expect(await readProfile(agentH, agentH.id)).toEqual([{ id: agentH.id, ...H_PROFILE }]);
  });

  it("I16: anonim nie czyta ofert ani profili", async () => {
    const anon = anonClient();
    for (const table of ["offers", "profiles"] as const) {
      const { data, error } = await anon.from(table).select("id");
      // anon has no grant on either table (revoke all ... from anon), so the request is denied outright;
      // an empty answer would mean someone granted select to anon and only RLS stands in the way.
      expect(error?.code).toBe("42501");
      expect(data).toBeNull();
    }
  });
});
