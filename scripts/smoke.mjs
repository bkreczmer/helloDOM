// Smoke test: proves the built app, the Cloudflare adapter and the Supabase auth flow still work together.
// Zero dependencies on purpose. Run against a live server: BASE_URL=http://localhost:4321 node scripts/smoke.mjs

const BASE_URL = process.env.BASE_URL ?? "http://localhost:4321";
const email = `smoke-${Date.now()}@example.com`;
const password = "Smoke-Test-Passw0rd!";
const agentEmail = `smoke-agent-${Date.now()}@example.com`;

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
    return { status: response.status, location: response.headers.get("location") ?? "" };
  };
}

const request = session();
const agent = session();

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
    "agent signout clears session",
    () => agent("/api/auth/signout", { method: "POST" }),
    { status: 302, location: "/" },
  ],
  ["agent panel redirects after signout", () => agent("/agent"), { status: 302, location: "/auth/signin" }],
  [
    "anonymous profile save redirects to signin",
    () => agent("/api/agent/profile", { method: "POST", form: validProfile }),
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
];

let failed = 0;
for (const [name, run, expected] of steps) {
  const actual = await run();
  const ok =
    actual.status === expected.status && (expected.location === undefined || actual.location === expected.location);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  -> ${actual.status} ${actual.location}`);
  if (!ok) {
    failed++;
    console.log(`      expected ${expected.status} ${expected.location ?? ""}`);
  }
}

console.log(failed ? `\n${failed} step(s) failed` : "\nAll smoke steps passed");
process.exit(failed ? 1 : 0);
