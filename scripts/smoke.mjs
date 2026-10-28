// Smoke test: proves the built app, the Cloudflare adapter and the Supabase auth flow still work together.
// Zero dependencies on purpose. Run against a live server: BASE_URL=http://localhost:4321 node scripts/smoke.mjs

const BASE_URL = process.env.BASE_URL ?? "http://localhost:4321";
const email = `smoke-${Date.now()}@example.com`;
const password = "Smoke-Test-Passw0rd!";
const agentEmail = `smoke-agent-${Date.now()}@example.com`;

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
    { status: 302, location: "/auth/signin?error=" },
  ],
  [
    "signin accepts correct password",
    () => request("/api/auth/signin", { method: "POST", form: { email, password } }),
    { status: 302, location: "/dashboard" },
  ],
  ["dashboard routes signed-in owner to owner panel", () => request("/dashboard"), { status: 302, location: "/owner" }],
  ["owner panel renders for signed-in owner", () => request("/owner"), { status: 200 }],
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
    "agent signout clears session",
    () => agent("/api/auth/signout", { method: "POST" }),
    { status: 302, location: "/" },
  ],
  ["agent panel redirects after signout", () => agent("/agent"), { status: 302, location: "/auth/signin" }],
];

let failed = 0;
for (const [name, run, expected] of steps) {
  const actual = await run();
  const ok =
    actual.status === expected.status &&
    (expected.location === undefined || actual.location.startsWith(expected.location));
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  -> ${actual.status} ${actual.location}`);
  if (!ok) {
    failed++;
    console.log(`      expected ${expected.status} ${expected.location ?? ""}`);
  }
}

console.log(failed ? `\n${failed} step(s) failed` : "\nAll smoke steps passed");
process.exit(failed ? 1 : 0);
