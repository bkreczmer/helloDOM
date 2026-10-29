// risk: #1 #2 #3 — context/foundation/test-plan.md §3 Phase 2 (plan: context/changes/testing-critical-path-e2e/plan.md)
// Modelled on tests/e2e/seed.spec.ts. Every user gets an own browser context; accounts and agent
// profiles are seeded through the app's HTTP API, the owner's offer A1 is created in the UI.
//
// Oracle computed by hand from the PRD rule (prd.md, Business Logic), never read from the RPC:
// type 35 + price in range 35 + experience 3 pts/year up to 30; another city or an incomplete profile → out.
// Offer A1: Lublin, apartment, 500 000 PLN. Agents sign up in this order (the tie T1/T2 goes to the earlier one).
//   P  lublin, apartment, 400–600k, 10 y → 100      T1 lublin, apartment, 400–500k, 5 y → 85
//   T2 lublin, apartment, 500–700k, 5 y → 85        F  lublin, house, 400–600k, 15 y → 65
//   I  lublin, apartment, 400–600k, no experience → incomplete, never ranked
//   O  rzeszow, apartment, 400–600k, 10 y → another city, never ranked
// Offer A2: Zielona Góra, plot, 950 000 PLN.
//   Y  zielona-gora, plot, 900k–1M, 0 y → 70        Z  zielona-gora, house, 1–10 PLN, 0 y → 0, never shown
//
// The ranking is anonymous ("Agent N"); the agent's identity travels only in the hidden agentId
// field of the invitation form, so that field is the one deliberate non-role locator here.
import { test, expect, type Locator, type Page } from "@playwright/test";

import { assertCitiesEmpty } from "../integration/helpers";
import {
  asTestUser,
  deleteAccounts,
  type Account,
  postForm,
  readOffer,
  runId,
  setAgentProfile,
  signUp,
  waitForHydration,
  type E2EUser,
} from "./helpers";

test.use({ storageState: { cookies: [], origins: [] } });
// The whole file shares one set of accounts. Two copies of it must never run at once: their agents
// would land in the same cities and mix the rankings. CI runs with workers: 1; locally use
// --workers=1 together with --repeat-each.
test.describe.configure({ mode: "serial" });

const OFFER_A1 = { city: "lublin", propertyType: "apartment", price: 500_000 };
const A1_DESCRIPTION = `E2E oferta ścieżki krytycznej ${runId}`;
const A1_TITLE = "Lublin · Mieszkanie · Sprzedaż";
const A2_TITLE = "Zielona Góra · Działka · Sprzedaż";

let baseURL: string;
let ownerA: E2EUser;
let ownerB: E2EUser;
const agents: Record<"P" | "T1" | "T2" | "F" | "I" | "O" | "Y" | "Z", E2EUser> = {} as never;
let offerA2Id: string;
let offerA1Id: string;
// Every account the run created, filled by signUp; afterAll deletes them all.
const created: Account[] = [];

function rankingItems(page: Page): Locator {
  return page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: /^Agent \d+$/ }) });
}

function agentIdField(scope: Page | Locator, agentId?: string): Locator {
  return scope.locator(agentId ? `input[name="agentId"][value="${agentId}"]` : 'input[name="agentId"]');
}

async function expectRanking(page: Page, expected: [E2EUser, number][]): Promise<void> {
  const items = rankingItems(page);
  await expect(items).toHaveCount(expected.length);
  for (const [index, [agent, score]] of expected.entries()) {
    const item = items.nth(index);
    await expect(item.getByRole("heading", { name: `Agent ${index + 1}` })).toBeVisible();
    await expect(item).toContainText(`${score}/100`);
    await expect(agentIdField(item)).toHaveValue(agent.id);
  }
}

async function expectOfferNotFound(page: Page, path: string): Promise<void> {
  const response = await page.goto(path);
  expect(response?.status(), path).toBe(404);
  await expect(page.getByRole("heading", { name: "Nie znaleziono oferty", level: 1 })).toBeVisible();
  await expect(page.getByText(A1_DESCRIPTION)).toHaveCount(0);
}

test.beforeAll(async ({ browser }, testInfo) => {
  testInfo.setTimeout(180_000);
  baseURL = String(testInfo.project.use.baseURL);
  test.info().annotations.push({ type: "test-data", description: `e2e-*-${runId}@example.com` });

  ownerA = await signUp(browser, baseURL, "owner", "a", created);
  ownerB = await signUp(browser, baseURL, "owner", "b", created);
  // Leftover agents in these cities would take top 3 slots, so the run refuses to start on a dirty database.
  await assertCitiesEmpty(asTestUser(ownerA), ["lublin", "rzeszow", "zielona-gora"]);

  // Sequential on purpose: the sign-up order breaks the T1/T2 tie.
  const lublinApartment = { cities: ["lublin"], propertyTypes: ["apartment"] };
  const profiles = {
    P: { ...lublinApartment, priceMin: 400_000, priceMax: 600_000, experienceYears: 10 },
    T1: { ...lublinApartment, priceMin: 400_000, priceMax: 500_000, experienceYears: 5 },
    T2: { ...lublinApartment, priceMin: 500_000, priceMax: 700_000, experienceYears: 5 },
    F: { cities: ["lublin"], propertyTypes: ["house"], priceMin: 400_000, priceMax: 600_000, experienceYears: 15 },
    I: { ...lublinApartment, priceMin: 400_000, priceMax: 600_000, experienceYears: null },
    O: { cities: ["rzeszow"], propertyTypes: ["apartment"], priceMin: 400_000, priceMax: 600_000, experienceYears: 10 },
    Y: {
      cities: ["zielona-gora"],
      propertyTypes: ["plot"],
      priceMin: 900_000,
      priceMax: 1_000_000,
      experienceYears: 0,
    },
    Z: { cities: ["zielona-gora"], propertyTypes: ["house"], priceMin: 1, priceMax: 10, experienceYears: 0 },
  };
  for (const [label, profile] of Object.entries(profiles) as [keyof typeof agents, (typeof profiles)["P"]][]) {
    agents[label] = await signUp(browser, baseURL, "agent", label.toLowerCase(), created);
    await setAgentProfile(agents[label], baseURL, profile);
  }

  // A2 is created over HTTP, so the second test does not depend on the first one.
  const offerA2 = await postForm(ownerA, baseURL, "/api/owner/offers", {
    city: "zielona-gora",
    propertyType: "plot",
    transaction: "sale",
    price: 950_000,
    areaM2: "",
    rooms: "",
    description: "",
  });
  const match = /^\/owner\/offers\/([0-9a-f-]{36})\?created=1$/.exec(offerA2.location);
  expect(match, `oferta A2: ${offerA2.status} ${offerA2.location}`).not.toBeNull();
  offerA2Id = match?.[1] ?? "";
});

test.afterAll(async () => {
  await deleteAccounts(created, baseURL);
});

test("właściciel: top 3 z PRD → zaproszenie → odrzucenie → ponowne zaproszenie → przyjęcie; izolacja w UI", async () => {
  test.setTimeout(120_000);
  const { P, T1, T2, F, I, O } = agents;
  const a = ownerA.page;

  // 1. A creates offer A1 in the UI.
  await a.goto("/owner");
  await a.getByRole("main").getByRole("link", { name: "Dodaj ofertę" }).click();
  await a.waitForURL("/owner/offers/new");
  await waitForHydration(a); // the submit creates a record, so no retry: wait once, then fill
  await a.getByLabel("Miasto").selectOption(OFFER_A1.city);
  // The radios are visually hidden inside choice cards; a user clicks the card's label.
  for (const choice of ["Mieszkanie", "Sprzedaż"]) {
    await a.getByText(choice, { exact: true }).click();
    await expect(a.getByRole("radio", { name: choice })).toBeChecked();
  }
  await a.getByLabel("Cena (PLN)").fill(String(OFFER_A1.price));
  await a.getByLabel("Opis — opcjonalnie").fill(A1_DESCRIPTION);
  await a.getByRole("button", { name: "Zapisz i pokaż agentów" }).click();
  await a.waitForURL(/\/owner\/offers\/[0-9a-f-]{36}\?created=1$/);
  offerA1Id = new URL(a.url()).pathname.split("/").pop() ?? "";
  await expect(a.getByRole("status").filter({ hasText: "Zapisano ofertę" })).toBeVisible();

  // 2. Risk #1 — the top 3 is exactly the PRD oracle, in order; F, I and O are not in the HTML.
  await expect(a.getByRole("heading", { name: "Najlepiej dopasowani agenci" })).toBeVisible();
  await expectRanking(a, [
    [P, 100],
    [T1, 85],
    [T2, 85],
  ]);
  for (const outsider of [F, I, O]) await expect(agentIdField(a, outsider.id)).toHaveCount(0);
  await expect(a.getByText("Dopasowanych agentów jest mniej niż 3")).toHaveCount(0);

  // 4. A invites P (Agent 1).
  await a.getByRole("button", { name: "Zaproś agenta 1" }).click();
  await a.waitForURL(`/owner/offers/${offerA1Id}?invited=1`);
  await expect(a.getByRole("status").filter({ hasText: "Wysłano zaproszenie" })).toBeVisible();
  await expect(a.getByRole("heading", { name: "Zaproszenie wysłane" })).toBeVisible();
  await expect(rankingItems(a)).toHaveCount(0);
  await expect(a.getByText("Edycja jest zablokowana")).toBeVisible();
  expect(await readOffer(ownerA, offerA1Id)).toMatchObject({
    status: "invited",
    invitations: [{ agentId: P.id, status: "pending" }],
  });

  // 5. Risk #3 — no edit after the invitation: the page and the endpoint both refuse, the row is unchanged.
  await a.goto(`/owner/offers/${offerA1Id}/edit`);
  await a.waitForURL(`/owner/offers/${offerA1Id}?error=edit_locked`);
  await expect(a.getByText("Tej oferty nie można już edytować")).toBeVisible();
  const edit = await postForm(ownerA, baseURL, "/api/owner/offers/update", {
    offerId: offerA1Id,
    city: OFFER_A1.city,
    propertyType: OFFER_A1.propertyType,
    transaction: "sale",
    price: 450_000,
    areaM2: "",
    rooms: "",
    description: "zmieniony opis",
  });
  expect(edit).toEqual({ status: 302, location: `/owner/offers/${offerA1Id}?error=edit_locked` });
  expect(await readOffer(ownerA, offerA1Id)).toMatchObject({ price: OFFER_A1.price, description: A1_DESCRIPTION });

  // 6. Risk #2 — before the answer only the invited agent and the owner reach A1.
  // Positive control: P sees the invitation and the offer.
  await P.page.goto("/agent");
  const pInvitation = P.page.getByRole("listitem").filter({ has: P.page.getByRole("heading", { name: A1_TITLE }) });
  await expect(pInvitation).toContainText("Oczekuje na odpowiedź");
  await P.page.goto(`/agent/offers/${offerA1Id}`);
  await expect(P.page.getByText(A1_DESCRIPTION)).toBeVisible();
  // T2 was not invited; B is another owner.
  await expectOfferNotFound(T2.page, `/agent/offers/${offerA1Id}`);
  await expectOfferNotFound(ownerB.page, `/owner/offers/${offerA1Id}`);
  await expectOfferNotFound(ownerB.page, `/owner/offers/${offerA1Id}/edit`);
  await ownerB.page.goto("/owner");
  await expect(ownerB.page.getByRole("link", { name: /Lublin · Mieszkanie/ })).toHaveCount(0);
  // The owner is sent back from the agent's offer page by the role gate.
  await a.goto(`/agent/offers/${offerA1Id}`);
  await a.waitForURL("/owner");

  // 7. P rejects.
  await P.page.goto(`/agent/offers/${offerA1Id}`);
  await waitForHydration(P.page);
  await P.page.getByRole("button", { name: "Odrzuć" }).click();
  await P.page.getByRole("button", { name: "Tak, odrzuć" }).click();
  await P.page.waitForURL("/agent?rejected=1");
  await expect(P.page.getByRole("status").filter({ hasText: "Odrzucono zaproszenie" })).toBeVisible();
  expect(await readOffer(ownerA, offerA1Id)).toMatchObject({
    status: "seeking_agent",
    invitations: [{ agentId: P.id, status: "rejected" }],
  });
  await expectOfferNotFound(P.page, `/agent/offers/${offerA1Id}`);

  // 8. Risks #1 + #3 — back to seeking_agent: P is gone from the ranking and F moves up.
  await a.goto(`/owner/offers/${offerA1Id}`);
  await expect(a.getByText("Agent odrzucił zaproszenie")).toBeVisible();
  await expectRanking(a, [
    [T1, 85],
    [T2, 85],
    [F, 65],
  ]);
  await expect(agentIdField(a, P.id)).toHaveCount(0);

  // 9. A invites T1 (now Agent 1); T1 sees only A1, never A2; T1 accepts.
  await a.getByRole("button", { name: "Zaproś agenta 1" }).click();
  await a.waitForURL(`/owner/offers/${offerA1Id}?invited=1`);
  expect(await readOffer(ownerA, offerA1Id)).toMatchObject({
    status: "invited",
    invitations: [
      { agentId: P.id, status: "rejected" },
      { agentId: T1.id, status: "pending" },
    ],
  });
  await T1.page.goto("/agent");
  await expect(T1.page.getByRole("heading", { name: A1_TITLE })).toBeVisible();
  await expect(T1.page.getByRole("heading", { name: A2_TITLE })).toHaveCount(0);
  await expect(T1.page.getByRole("link", { name: "Zobacz ofertę" })).toHaveCount(1);
  expect((await T1.page.goto(`/agent/offers/${offerA2Id}`))?.status()).toBe(404);
  await T1.page.goto(`/agent/offers/${offerA1Id}`);
  await waitForHydration(T1.page);
  await T1.page.getByRole("button", { name: "Przyjmij" }).click();
  await T1.page.getByRole("button", { name: "Tak, przyjmij" }).click();
  await T1.page.waitForURL(`/agent/offers/${offerA1Id}?accepted=1`);
  await expect(T1.page.getByRole("status").filter({ hasText: "Przyjęto zaproszenie" })).toBeVisible();
  await expect(T1.page.getByText("Oferta jest w obsłudze")).toBeVisible();
  const accepted = {
    status: "in_progress",
    invitations: [
      { agentId: P.id, status: "rejected" },
      { agentId: T1.id, status: "accepted" },
    ],
  };
  expect(await readOffer(ownerA, offerA1Id)).toMatchObject(accepted);
  await T1.page.goto("/agent");
  await expect(
    T1.page.getByRole("listitem").filter({ has: T1.page.getByRole("heading", { name: A1_TITLE }) }),
  ).toContainText("Przyjęte");

  // 10. Risk #3 — a second accept changes nothing; T2 cannot answer an invitation that is not theirs.
  const again = await postForm(T1, baseURL, "/api/agent/invitations", { offerId: offerA1Id, response: "accept" });
  expect(again).toEqual({ status: 302, location: "/agent?error=already_responded" });
  await T1.page.goto(again.location);
  await expect(T1.page.getByText("Na to zaproszenie już odpowiedziano.")).toBeVisible();
  const foreign = await postForm(T2, baseURL, "/api/agent/invitations", { offerId: offerA1Id, response: "accept" });
  expect(foreign.status).toBe(404);
  expect(await readOffer(ownerA, offerA1Id)).toMatchObject(accepted);

  // 11. The owner sees the accepted status, no ranking and no edit; A's own list still has both offers.
  await a.goto(`/owner/offers/${offerA1Id}`);
  await expect(a.getByRole("heading", { name: "W obsłudze" })).toBeVisible();
  await expect(a.getByText("Agent przyjął zaproszenie")).toBeVisible();
  await expect(a.getByRole("heading", { name: "Najlepiej dopasowani agenci" })).toHaveCount(0);
  await expect(a.getByRole("link", { name: "Edytuj" })).toHaveCount(0);
  await a.goto("/owner");
  await expect(a.getByRole("link", { name: /Lublin · Mieszkanie/ })).toBeVisible();
  await expect(a.getByRole("link", { name: /Zielona Góra · Działka/ })).toBeVisible();
});

test("oferta z mniej niż 3 dopasowaniami: agent z wynikiem 0 nie jest pokazywany", async () => {
  const { Y, Z } = agents;
  const a = ownerA.page;

  await a.goto(`/owner/offers/${offerA2Id}`);
  await expectRanking(a, [[Y, 70]]);
  await expect(a.getByText("Dopasowanych agentów jest mniej niż 3")).toBeVisible();
  await expect(agentIdField(a, Z.id)).toHaveCount(0);
});
