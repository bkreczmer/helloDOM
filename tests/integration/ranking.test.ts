// Risk #1 from context/foundation/test-plan.md: the owner sees the wrong top 3 for an offer.
// Expected results are worked out by hand from the PRD (Business Logic) and written down as constants;
// the test never recomputes the score with the same formula as rank_agents_for_offer.
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  assertCitiesEmpty,
  createOffer,
  deleteUsers,
  rank,
  setAgentProfile,
  signUpAs,
  type AgentProfile,
  type OfferFields,
  type TestUser,
} from "./helpers";

type AgentLabel = "A1" | "A2" | "A3" | "A4" | "A5" | "A6" | "A7" | "A8";

// Registration order matters: ties on score and experience go to the earlier profile (A3 before A4).
const AGENT_POOL: [AgentLabel, AgentProfile][] = [
  [
    "A1",
    { cities: ["opole"], property_types: ["apartment"], price_min: 300_000, price_max: 500_000, experience_years: 10 },
  ],
  [
    "A2",
    { cities: ["opole"], property_types: ["apartment"], price_min: 300_000, price_max: 500_000, experience_years: 15 },
  ],
  ["A3", { cities: ["opole"], property_types: ["house"], price_min: 300_000, price_max: 500_000, experience_years: 5 }],
  [
    "A4",
    { cities: ["opole"], property_types: ["apartment"], price_min: 600_000, price_max: 800_000, experience_years: 5 },
  ],
  ["A5", { cities: ["opole"], property_types: ["plot"], price_min: 1, price_max: 100, experience_years: 0 }],
  [
    "A6",
    {
      cities: ["krakow"],
      property_types: ["apartment", "house", "plot"],
      price_min: 0,
      price_max: 2_000_000,
      experience_years: 20,
    },
  ],
  // Incomplete profiles: no price range, no property type.
  ["A7", { cities: ["opole"], property_types: ["apartment"], price_min: null, price_max: null, experience_years: 10 }],
  ["A8", { cities: ["opole"], property_types: [], price_min: 300_000, price_max: 500_000, experience_years: 10 }],
];

const opoleApartment = (price: number): OfferFields => ({ city: "opole", property_type: "apartment", price });
const R1_OFFER = opoleApartment(400_000);
const R1_TOP: [AgentLabel, number][] = [
  ["A2", 100],
  ["A1", 100],
  ["A3", 50],
];

const CASES: { id: string; title: string; offer: OfferFields; top: [AgentLabel, number][] }[] = [
  {
    id: "R1",
    title: "remis wyniku rozstrzyga staż, potem rejestracja; najwyżej 3; bez wyniku 0, innego miasta i niepełnych",
    offer: R1_OFFER,
    top: R1_TOP,
  },
  { id: "R2", title: "cena równa price_min daje 35 pkt", offer: opoleApartment(300_000), top: R1_TOP },
  { id: "R3", title: "cena równa price_max daje 35 pkt", offer: opoleApartment(500_000), top: R1_TOP },
  {
    id: "R4",
    title: "cena o 1 poniżej price_min daje 0 za cenę",
    offer: opoleApartment(299_999),
    top: [
      ["A2", 65],
      ["A1", 65],
      ["A4", 50],
    ],
  },
  {
    id: "R5",
    title: "cena o 1 powyżej price_max daje 0 za cenę",
    offer: opoleApartment(500_001),
    top: [
      ["A2", 65],
      ["A1", 65],
      ["A4", 50],
    ],
  },
  {
    id: "R6",
    title: "staż 0 daje 0 pkt, staż 10 i więcej daje 30 pkt",
    offer: { city: "opole", property_type: "plot", price: 50 },
    top: [
      ["A5", 70],
      ["A2", 30],
      ["A1", 30],
    ],
  },
  {
    id: "R7",
    title: "tylko agenci z miasta oferty, mniej niż 3 wyniki",
    offer: { city: "krakow", property_type: "apartment", price: 400_000 },
    top: [["A6", 100]],
  },
];

describe("ranking agentów dla oferty (rank_agents_for_offer)", () => {
  const users: TestUser[] = [];
  const agents = new Map<AgentLabel, TestUser>();
  let owner: TestUser;

  const expected = (top: [AgentLabel, number][]) =>
    top.map(([label, score]) => {
      const agent = agents.get(label);
      if (!agent) throw new Error(`Brak agenta ${label} w puli.`);
      return { agentId: agent.id, score };
    });

  beforeAll(async () => {
    owner = await signUpAs("owner", "rank-owner");
    users.push(owner);
    await assertCitiesEmpty(owner, ["opole", "krakow"]);
    // One by one, never Promise.all: the registration order decides ties.
    for (const [label, profile] of AGENT_POOL) {
      const agent = await signUpAs("agent", `rank-${label.toLowerCase()}`);
      users.push(agent);
      agents.set(label, agent);
      await setAgentProfile(agent, profile);
    }
  });

  afterAll(async () => {
    await deleteUsers(users);
  });

  it.for(CASES)("$id: $title", async ({ offer, top }) => {
    const offerId = await createOffer(owner, offer);
    expect(await rank(owner, offerId)).toEqual(expected(top));
  });

  it("R8: agent, który odrzucił zaproszenie, wypada z rankingu tej oferty, ale nie innej", async () => {
    const offerId = await createOffer(owner, R1_OFFER);
    const otherOfferId = await createOffer(owner, R1_OFFER);
    const a2 = agents.get("A2");
    if (!a2) throw new Error("Brak agenta A2 w puli.");

    const invite = await owner.client.rpc("invite_agent", { p_offer_id: offerId, p_agent_id: a2.id });
    expect(invite.error).toBeNull();
    expect(invite.data).toBe("ok");
    const reject = await a2.client.rpc("respond_to_invitation", { p_offer_id: offerId, p_response: "reject" });
    expect(reject.error).toBeNull();
    expect(reject.data).toBe("ok");

    expect(await rank(owner, offerId)).toEqual(
      expected([
        ["A1", 100],
        ["A3", 50],
        ["A4", 50],
      ]),
    );
    expect(await rank(owner, otherOfferId)).toEqual(expected(R1_TOP));
  });
});
