// Smoke test: proves the built app, the Cloudflare adapter and the Supabase auth flow still work together.
// Zero dependencies on purpose. Run against a live server: BASE_URL=http://localhost:4321 node scripts/smoke.mjs

import { randomUUID } from "node:crypto";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:4321";
const email = `smoke-${Date.now()}@example.com`;
const password = "Smoke-Test-Passw0rd!";
const agentEmail = `smoke-agent-${Date.now()}@example.com`;
const otherOwnerEmail = `smoke-other-${Date.now()}@example.com`;
// Second agent, created at the end: once the first agent deletes their account, the accepted offer
// is back in the ranking and must offer an invitation form even on a fresh database.
const secondAgentEmail = `smoke-agent2-${Date.now()}@example.com`;

// Written out on purpose (the smoke does not import TS): a second, independent copy of the
// dictionary, so a drift between src/lib/dictionaries.ts and the SQL check fails here.
const ALL_CITIES = [
  "bialystok",
  "bydgoszcz",
  "gdansk",
  "gorzow-wielkopolski",
  "katowice",
  "kielce",
  "krakow",
  "lublin",
  "lodz",
  "olsztyn",
  "opole",
  "poznan",
  "rzeszow",
  "szczecin",
  "torun",
  "warszawa",
  "wroclaw",
  "zielona-gora",
];
const ALL_PROPERTY_TYPES = ["apartment", "house", "plot"];

// Profile form as [name, value] pairs, so checkbox groups can repeat a name.
function profileForm({ cities = ["warszawa"], propertyTypes = ["apartment"], priceMin, priceMax, experienceYears }) {
  return [
    ...cities.map((city) => ["cities", city]),
    ...propertyTypes.map((type) => ["propertyTypes", type]),
    ["priceMin", priceMin],
    ["priceMax", priceMax],
    ["experienceYears", experienceYears],
  ];
}
const validProfile = profileForm({ priceMin: "100000", priceMax: "900000", experienceYears: "5" });
// The run deletes its accounts at the end, but a failed run leaves them behind (and older local databases
// still hold smoke agents from before), and ranking ties go to the oldest profile. A price unique to this
// run plus 60 years of experience gives this run's agent 100/100 on the ranked offer and wins ties,
// so it is "Agent 1" even with leftover smoke agents in the local database.
const rankedPrice = String(500000 + (Date.now() % 100000));
const rankedProfile = profileForm({ priceMin: rankedPrice, priceMax: rankedPrice, experienceYears: "60" });
const secondAgentProfile = profileForm({ priceMin: rankedPrice, priceMax: rankedPrice, experienceYears: "10" });

// Offer form with every field set; override single fields per step.
function offerForm(overrides = {}) {
  return {
    city: "warszawa",
    propertyType: "apartment",
    transaction: "sale",
    price: "500000",
    areaM2: "54,5",
    rooms: "3",
    description: "Smoke test offer",
    ...overrides,
  };
}
const OFFER_CREATED = /^\/owner\/offers\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\?created=1$/;
// Id of the offer saved by the owner, taken from the Location header.
let offerId = null;
// Id of the offer saved after the smoke agent's profile is complete (for the ranking page steps).
let rankedOfferId = null;
// The smoke agent's id, taken from the hidden agentId of the first "Zaproś" form on the offer page.
let smokeAgentId = null;
const AGENT_ID_FIELD = /name="agentId" value="([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"/;
const inviteForm = (agentId) => ({ offerId: rankedOfferId, ...(agentId ? { agentId } : {}) });
// Offer A is rankedOfferId (rejected by the smoke agent); offer B is saved after that and accepted.
let acceptedOfferId = null;
// Agent id from the "Zaproś" form on offer B.
let acceptedAgentId = null;
const respondForm = (offerId, response) => ({ offerId, response });

// One cookie jar per user, so owner and agent sessions never leak into each other.
function session() {
  const jar = new Map();

  function cookieHeader() {
    return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  function storeCookies(response) {
    for (const raw of response.headers.getSetCookie()) {
      const [pair, ...attrs] = raw.split(";");
      const [name, ...rest] = pair.split("=");
      const expired = attrs.some((a) => /max-age=0/i.test(a.trim()));
      if (expired) jar.delete(name.trim());
      else jar.set(name.trim(), rest.join("="));
    }
  }

  return async function request(path, { method = "GET", form } = {}) {
    const response = await fetch(BASE_URL + path, {
      method,
      redirect: "manual",
      headers: {
        Cookie: cookieHeader(),
        Origin: BASE_URL,
        ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
      },
      body: form ? new URLSearchParams(form).toString() : undefined,
    });
    storeCookies(response);
    return { status: response.status, location: response.headers.get("location") ?? "", body: await response.text() };
  };
}

const request = session();
const agent = session();
const otherOwner = session();
const secondAgent = session();
const anonymous = session();

const steps = [
  ["home renders", () => request("/"), { status: 200 }],
  ["dashboard redirects anonymous user", () => request("/dashboard"), { status: 302, location: "/auth/signin" }],
  [
    "signup creates account",
    () => request("/api/auth/signup", { method: "POST", form: { email, password, role: "owner" } }),
    { status: 302, location: "/dashboard" },
  ],
  ["signup session routes dashboard to owner panel", () => request("/dashboard"), { status: 302, location: "/owner" }],
  ["signup session reaches owner panel", () => request("/owner"), { status: 200 }],
  ["owner is redirected from agent panel", () => request("/agent"), { status: 302, location: "/owner" }],
  ["owner is redirected from agent profile", () => request("/agent/profile"), { status: 302, location: "/owner" }],
  ["signout after signup", () => request("/api/auth/signout", { method: "POST" }), { status: 302, location: "/" }],
  [
    "signup without role is rejected",
    () => request("/api/auth/signup", { method: "POST", form: { email: `norole-${email}`, password } }),
    { status: 302, location: "/auth/signup?error=invalid_input" },
  ],
  [
    "signup with unknown role is rejected",
    () => request("/api/auth/signup", { method: "POST", form: { email: `admin-${email}`, password, role: "admin" } }),
    { status: 302, location: "/auth/signup?error=invalid_input" },
  ],
  [
    "signin rejects wrong password",
    () => request("/api/auth/signin", { method: "POST", form: { email, password: "wrong" } }),
    { status: 302, location: "/auth/signin?error=invalid_credentials" },
  ],
  [
    "signin accepts correct password",
    () => request("/api/auth/signin", { method: "POST", form: { email, password } }),
    { status: 302, location: "/dashboard" },
  ],
  ["dashboard routes signed-in owner to owner panel", () => request("/dashboard"), { status: 302, location: "/owner" }],
  ["owner panel renders for signed-in owner", () => request("/owner"), { status: 200 }],
  ["new offer page renders for owner", () => request("/owner/offers/new"), { status: 200 }],
  [
    "owner saves a valid offer",
    async () => {
      const response = await request("/api/owner/offers", { method: "POST", form: offerForm() });
      offerId = OFFER_CREATED.exec(response.location)?.[1] ?? null;
      return response;
    },
    { status: 302, locationMatch: OFFER_CREATED },
  ],
  ...ALL_CITIES.map((city) => [
    `owner saves an offer in ${city}`,
    () =>
      request("/api/owner/offers", {
        method: "POST",
        form: offerForm({ city, areaM2: "", rooms: "", description: "" }),
      }),
    { status: 302, locationMatch: OFFER_CREATED },
  ]),
  [
    "offer rejects unknown city",
    () => request("/api/owner/offers", { method: "POST", form: offerForm({ city: "atlantis" }) }),
    { status: 302, location: "/owner/offers/new?error=invalid_input" },
  ],
  [
    "offer rejects missing price",
    () => request("/api/owner/offers", { method: "POST", form: offerForm({ price: "" }) }),
    { status: 302, location: "/owner/offers/new?error=invalid_input" },
  ],
  [
    "offer rejects price 0",
    () => request("/api/owner/offers", { method: "POST", form: offerForm({ price: "0" }) }),
    { status: 302, location: "/owner/offers/new?error=invalid_input" },
  ],
  [
    "offer rejects non-numeric area",
    () => request("/api/owner/offers", { method: "POST", form: offerForm({ areaM2: "abc" }) }),
    { status: 302, location: "/owner/offers/new?error=invalid_input" },
  ],
  [
    "owner cannot save an agent profile",
    () => request("/api/agent/profile", { method: "POST", form: validProfile }),
    { status: 403 },
  ],
  ["signout clears session", () => request("/api/auth/signout", { method: "POST" }), { status: 302, location: "/" }],
  ["dashboard redirects after signout", () => request("/dashboard"), { status: 302, location: "/auth/signin" }],
  [
    "agent signup creates account",
    () => agent("/api/auth/signup", { method: "POST", form: { email: agentEmail, password, role: "agent" } }),
    { status: 302, location: "/dashboard" },
  ],
  ["dashboard routes agent to agent panel", () => agent("/dashboard"), { status: 302, location: "/agent" }],
  ["agent panel renders for agent", () => agent("/agent"), { status: 200 }],
  ["agent is redirected from owner panel", () => agent("/owner"), { status: 302, location: "/agent" }],
  ["agent is redirected from new offer page", () => agent("/owner/offers/new"), { status: 302, location: "/agent" }],
  [
    "agent cannot save an offer",
    () => agent("/api/owner/offers", { method: "POST", form: offerForm() }),
    { status: 403 },
  ],
  ["agent profile page renders for agent", () => agent("/agent/profile"), { status: 200 }],
  [
    "agent saves profile with the full dictionary",
    () =>
      agent("/api/agent/profile", {
        method: "POST",
        form: profileForm({
          cities: ALL_CITIES,
          propertyTypes: ALL_PROPERTY_TYPES,
          priceMin: "0",
          priceMax: "2000000",
          experienceYears: "0",
        }),
      }),
    { status: 302, location: "/agent/profile?saved=1" },
  ],
  [
    "agent saves an incomplete profile",
    () =>
      agent("/api/agent/profile", {
        method: "POST",
        form: profileForm({ cities: ["krakow"], propertyTypes: [], priceMin: "", priceMax: "", experienceYears: "" }),
      }),
    { status: 302, location: "/agent/profile?saved=1" },
  ],
  [
    "agent profile rejects unknown city",
    () =>
      agent("/api/agent/profile", {
        method: "POST",
        form: profileForm({ cities: ["atlantis"], priceMin: "100000", priceMax: "900000", experienceYears: "5" }),
      }),
    { status: 302, location: "/agent/profile?error=invalid_input" },
  ],
  [
    "agent profile rejects price min above max",
    () =>
      agent("/api/agent/profile", {
        method: "POST",
        form: profileForm({ priceMin: "900000", priceMax: "100000", experienceYears: "5" }),
      }),
    { status: 302, location: "/agent/profile?error=invalid_input" },
  ],
  [
    "agent profile rejects experience above 60 years",
    () =>
      agent("/api/agent/profile", {
        method: "POST",
        form: profileForm({ priceMin: "100000", priceMax: "900000", experienceYears: "61" }),
      }),
    { status: 302, location: "/agent/profile?error=invalid_input" },
  ],
  [
    "agent saves a full profile for the ranking",
    () => agent("/api/agent/profile", { method: "POST", form: rankedProfile }),
    { status: 302, location: "/agent/profile?saved=1" },
  ],
  [
    "owner signs in again",
    () => request("/api/auth/signin", { method: "POST", form: { email, password } }),
    { status: 302, location: "/dashboard" },
  ],
  [
    "owner saves an offer matching the smoke agent",
    async () => {
      const response = await request("/api/owner/offers", {
        method: "POST",
        form: offerForm({ city: "warszawa", propertyType: "apartment", price: rankedPrice }),
      });
      rankedOfferId = OFFER_CREATED.exec(response.location)?.[1] ?? null;
      return response;
    },
    { status: 302, locationMatch: OFFER_CREATED },
  ],
  [
    "offer page shows the ranking with invite buttons and without agent e-mail",
    async () => {
      const response = await request(`/owner/offers/${rankedOfferId}?created=1`);
      smokeAgentId = AGENT_ID_FIELD.exec(response.body)?.[1] ?? null;
      return response;
    },
    {
      status: 200,
      bodyIncludes: ["Agent 1", "100/100", "Zapisano ofertę", "Zaproś", "Szuka agenta"],
      bodyExcludes: [agentEmail],
    },
  ],
  [
    "owner panel lists the offer",
    () => request("/owner"),
    { status: 200, bodyIncludes: ["Dodaj ofertę", () => `/owner/offers/${rankedOfferId}`] },
  ],
  ["offer page rejects a malformed id", () => request("/owner/offers/not-a-uuid"), { status: 404 }],
  [
    "second owner signup creates account",
    () =>
      otherOwner("/api/auth/signup", {
        method: "POST",
        form: { email: otherOwnerEmail, password, role: "owner" },
      }),
    { status: 302, location: "/dashboard" },
  ],
  [
    "second owner gets 404 for someone else's offer",
    () => otherOwner(`/owner/offers/${rankedOfferId}`),
    { status: 404, bodyIncludes: ["Nie znaleziono oferty"], bodyExcludes: ["Agent 1"] },
  ],
  [
    "agent is redirected from offer page",
    () => agent(`/owner/offers/${rankedOfferId}`),
    { status: 302, location: "/agent" },
  ],
  [
    "anonymous user is redirected from offer page",
    () => anonymous(`/owner/offers/${rankedOfferId}`),
    { status: 302, location: "/auth/signin" },
  ],
  [
    "agent cannot send an invitation",
    () => agent("/api/owner/invitations", { method: "POST", form: inviteForm(smokeAgentId) }),
    { status: 403 },
  ],
  [
    "anonymous invitation redirects to signin",
    () => anonymous("/api/owner/invitations", { method: "POST", form: inviteForm(smokeAgentId) }),
    { status: 302, location: "/auth/signin" },
  ],
  [
    "second owner gets 404 when inviting to someone else's offer",
    () => otherOwner("/api/owner/invitations", { method: "POST", form: inviteForm(smokeAgentId) }),
    { status: 404 },
  ],
  [
    "invitation without an agent is rejected",
    () => request("/api/owner/invitations", { method: "POST", form: inviteForm(null) }),
    { status: 302, location: () => `/owner/offers/${rankedOfferId}?error=invalid_input` },
  ],
  [
    "invitation of an agent outside the top 3 is rejected",
    () => request("/api/owner/invitations", { method: "POST", form: inviteForm(randomUUID()) }),
    { status: 302, location: () => `/owner/offers/${rankedOfferId}?error=agent_not_ranked` },
  ],
  [
    "owner invites the smoke agent",
    () => request("/api/owner/invitations", { method: "POST", form: inviteForm(smokeAgentId) }),
    { status: 302, location: () => `/owner/offers/${rankedOfferId}?invited=1` },
  ],
  [
    "offer page shows the invitation status instead of the ranking",
    () => request(`/owner/offers/${rankedOfferId}?invited=1`),
    {
      status: 200,
      bodyIncludes: ["Wysłano zaproszenie", "Zaproszenie wysłane"],
      bodyExcludes: ["Zaproś", agentEmail],
    },
  ],
  [
    "second invitation to the same offer is rejected",
    () => request("/api/owner/invitations", { method: "POST", form: inviteForm(smokeAgentId) }),
    { status: 302, location: () => `/owner/offers/${rankedOfferId}?error=offer_locked` },
  ],
  [
    "agent panel lists the invitation",
    () => agent("/agent"),
    { status: 200, bodyIncludes: ["Warszawa", "Zobacz ofertę", () => `/agent/offers/${rankedOfferId}`] },
  ],
  [
    "agent sees the invited offer without owner data",
    () => agent(`/agent/offers/${rankedOfferId}`),
    { status: 200, bodyIncludes: ["Podsumowanie oferty", "Zaproszono Cię do tej oferty"], bodyExcludes: [email] },
  ],
  [
    "agent gets 404 for an offer without an invitation",
    () => agent(`/agent/offers/${offerId}`),
    { status: 404, bodyIncludes: ["Nie znaleziono oferty"], bodyExcludes: ["Podsumowanie oferty"] },
  ],
  ["agent offer page rejects a malformed id", () => agent("/agent/offers/not-a-uuid"), { status: 404 }],
  [
    "owner is redirected from agent offer page",
    () => request(`/agent/offers/${rankedOfferId}`),
    { status: 302, location: "/owner" },
  ],
  [
    "anonymous user is redirected from agent offer page",
    () => anonymous(`/agent/offers/${rankedOfferId}`),
    { status: 302, location: "/auth/signin" },
  ],
  [
    "owner cannot respond to an invitation",
    () => request("/api/agent/invitations", { method: "POST", form: respondForm(rankedOfferId, "reject") }),
    { status: 403 },
  ],
  [
    "agent gets 404 when responding to an offer without an invitation",
    () => agent("/api/agent/invitations", { method: "POST", form: respondForm(randomUUID(), "reject") }),
    { status: 404 },
  ],
  [
    "agent rejects the invitation",
    () => agent("/api/agent/invitations", { method: "POST", form: respondForm(rankedOfferId, "reject") }),
    { status: 302, location: "/agent?rejected=1" },
  ],
  [
    "agent gets 404 for the rejected offer",
    () => agent(`/agent/offers/${rankedOfferId}`),
    { status: 404, bodyIncludes: ["Nie znaleziono oferty"], bodyExcludes: ["Podsumowanie oferty"] },
  ],
  [
    "agent panel confirms the rejection",
    () => agent("/agent?rejected=1"),
    { status: 200, bodyIncludes: ["Odrzucono zaproszenie", "Odrzucone"] },
  ],
  [
    "second response to the same invitation is rejected",
    () => agent("/api/agent/invitations", { method: "POST", form: respondForm(rankedOfferId, "reject") }),
    { status: 302, location: "/agent?error=already_responded" },
  ],
  [
    "agent panel shows the already-responded message",
    () => agent("/agent?error=already_responded"),
    { status: 200, bodyIncludes: ["Na to zaproszenie już odpowiedziano."] },
  ],
  [
    "owner saves a second offer matching the smoke agent",
    async () => {
      const response = await request("/api/owner/offers", {
        method: "POST",
        form: offerForm({ city: "warszawa", propertyType: "apartment", price: rankedPrice }),
      });
      acceptedOfferId = OFFER_CREATED.exec(response.location)?.[1] ?? null;
      return response;
    },
    { status: 302, locationMatch: OFFER_CREATED },
  ],
  [
    "second offer page shows the ranking with the smoke agent",
    async () => {
      const response = await request(`/owner/offers/${acceptedOfferId}`);
      acceptedAgentId = AGENT_ID_FIELD.exec(response.body)?.[1] ?? null;
      return response;
    },
    { status: 200, bodyIncludes: ["Agent 1", "100/100", "Zaproś"] },
  ],
  [
    "owner invites the smoke agent to the second offer",
    () =>
      request("/api/owner/invitations", {
        method: "POST",
        form: { offerId: acceptedOfferId, agentId: acceptedAgentId },
      }),
    { status: 302, location: () => `/owner/offers/${acceptedOfferId}?invited=1` },
  ],
  [
    "agent accepts the invitation",
    () => agent("/api/agent/invitations", { method: "POST", form: respondForm(acceptedOfferId, "accept") }),
    { status: 302, location: () => `/agent/offers/${acceptedOfferId}?accepted=1` },
  ],
  [
    "agent offer page confirms the acceptance without response actions",
    () => agent(`/agent/offers/${acceptedOfferId}?accepted=1`),
    {
      status: 200,
      bodyIncludes: ["Przyjęto zaproszenie", "Oferta jest w obsłudze"],
      bodyExcludes: ['name="response"'],
    },
  ],
  [
    "owner offer page shows the rejection above the ranking",
    () => request(`/owner/offers/${rankedOfferId}`),
    { status: 200, bodyIncludes: ["Agent odrzucił zaproszenie"], bodyExcludes: [() => smokeAgentId] },
  ],
  [
    "owner cannot re-invite the agent who rejected the offer",
    () => request("/api/owner/invitations", { method: "POST", form: inviteForm(smokeAgentId) }),
    { status: 302, location: () => `/owner/offers/${rankedOfferId}?error=agent_not_ranked` },
  ],
  [
    "owner offer page shows the accepted invitation",
    () => request(`/owner/offers/${acceptedOfferId}`),
    { status: 200, bodyIncludes: ["W obsłudze", "Agent przyjął zaproszenie"], bodyExcludes: ["Zaproś"] },
  ],
  ["second owner signout", () => otherOwner("/api/auth/signout", { method: "POST" }), { status: 302, location: "/" }],
  [
    "owner signout after ranking checks",
    () => request("/api/auth/signout", { method: "POST" }),
    { status: 302, location: "/" },
  ],
  [
    "agent signout clears session",
    () => agent("/api/auth/signout", { method: "POST" }),
    { status: 302, location: "/" },
  ],
  ["agent panel redirects after signout", () => agent("/agent"), { status: 302, location: "/auth/signin" }],
  [
    "agent profile page redirects anonymous user",
    () => agent("/agent/profile"),
    { status: 302, location: "/auth/signin" },
  ],
  [
    "anonymous profile save redirects to signin",
    () => agent("/api/agent/profile", { method: "POST", form: validProfile }),
    { status: 302, location: "/auth/signin" },
  ],
  [
    "anonymous offer save redirects to signin",
    () => agent("/api/owner/offers", { method: "POST", form: offerForm() }),
    { status: 302, location: "/auth/signin" },
  ],
  [
    "expired confirmation link lands on signin",
    () => request("/auth/callback?error=access_denied&error_code=otp_expired"),
    { status: 302, location: "/auth/signin?error=link_expired" },
  ],
  [
    "invalid confirmation code lands on signin",
    () => request("/auth/callback?code=not-a-real-code"),
    { status: 302, location: "/auth/signin?error=link_expired" },
  ],
  // Account deletion: every account the run created is deleted, which also cleans up after the smoke.
  [
    "second agent signup creates account",
    () =>
      secondAgent("/api/auth/signup", {
        method: "POST",
        form: { email: secondAgentEmail, password, role: "agent" },
      }),
    { status: 302, location: "/dashboard" },
  ],
  [
    "second agent saves a profile matching the accepted offer",
    () => secondAgent("/api/agent/profile", { method: "POST", form: secondAgentProfile }),
    { status: 302, location: "/agent/profile?saved=1" },
  ],
  [
    "agent signs in again",
    () => agent("/api/auth/signin", { method: "POST", form: { email: agentEmail, password } }),
    { status: 302, location: "/dashboard" },
  ],
  [
    "agent with an accepted invitation deletes the account",
    () => agent("/api/account/delete", { method: "POST" }),
    { status: 302, location: "/?deleted=1" },
  ],
  ["deleted agent has no session", () => agent("/agent"), { status: 302, location: "/auth/signin" }],
  [
    "owner signs in to check the accepted offer",
    () => request("/api/auth/signin", { method: "POST", form: { email, password } }),
    { status: 302, location: "/dashboard" },
  ],
  [
    "accepted offer is seeking an agent again after the agent deletion",
    () => request(`/owner/offers/${acceptedOfferId}`),
    {
      status: 200,
      bodyIncludes: ["Szuka agenta", "Najlepiej dopasowani agenci", 'action="/api/owner/invitations"', "Zaproś"],
      bodyExcludes: ["W obsłudze", agentEmail, () => acceptedAgentId],
    },
  ],
  [
    "second agent deletes the account",
    () => secondAgent("/api/account/delete", { method: "POST" }),
    { status: 302, location: "/?deleted=1" },
  ],
  [
    "second owner signs in again",
    () => otherOwner("/api/auth/signin", { method: "POST", form: { email: otherOwnerEmail, password } }),
    { status: 302, location: "/dashboard" },
  ],
  [
    "second owner deletes the account",
    () => otherOwner("/api/account/delete", { method: "POST" }),
    { status: 302, location: "/?deleted=1" },
  ],
  [
    "owner deletes the account",
    () => request("/api/account/delete", { method: "POST" }),
    { status: 302, location: "/?deleted=1" },
  ],
  ["deleted owner has no session", () => request("/owner"), { status: 302, location: "/auth/signin" }],
  [
    "signin of the deleted owner fails",
    () => anonymous("/api/auth/signin", { method: "POST", form: { email, password } }),
    { status: 302, location: "/auth/signin?error=invalid_credentials" },
  ],
  [
    "signin of the deleted agent fails",
    () => anonymous("/api/auth/signin", { method: "POST", form: { email: agentEmail, password } }),
    { status: 302, location: "/auth/signin?error=invalid_credentials" },
  ],
  [
    "home confirms the account deletion",
    () => anonymous("/?deleted=1"),
    { status: 200, bodyIncludes: ["Konto zostało usunięte razem z Twoimi danymi."] },
  ],
];

// Body and location expectations may be functions, resolved when the step runs (ids captured by earlier steps).
const resolveOne = (value) => (typeof value === "function" ? value() : value);
const resolve = (texts = []) => texts.map(resolveOne);

let failed = 0;
for (const [name, run, expected] of steps) {
  const actual = await run();
  const missing = resolve(expected.bodyIncludes).filter((text) => !actual.body.includes(text));
  const leaked = resolve(expected.bodyExcludes).filter((text) => actual.body.includes(text));
  const location = resolveOne(expected.location);
  const ok =
    actual.status === expected.status &&
    (location === undefined || actual.location === location) &&
    (expected.locationMatch === undefined || expected.locationMatch.test(actual.location)) &&
    missing.length === 0 &&
    leaked.length === 0;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  -> ${actual.status} ${actual.location}`);
  if (!ok) {
    failed++;
    console.log(`      expected ${expected.status} ${location ?? expected.locationMatch ?? ""}`);
    if (missing.length) console.log(`      body is missing: ${missing.join(" | ")}`);
    if (leaked.length) console.log(`      body must not contain: ${leaked.join(" | ")}`);
  }
}

if (offerId === null || rankedOfferId === null) {
  failed++;
  console.log("FAIL  offer id was not captured from the Location header");
}

if (acceptedOfferId === null) {
  failed++;
  console.log("FAIL  second offer id was not captured from the Location header");
}

if (smokeAgentId === null || acceptedAgentId === null) {
  failed++;
  console.log("FAIL  agent id was not captured from the invitation form");
}

console.log(failed ? `\n${failed} step(s) failed` : "\nAll smoke steps passed");
process.exit(failed ? 1 : 0);
