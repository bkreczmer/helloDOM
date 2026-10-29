// Proof for src/lib/report-error.ts: the log line never carries personal data, error shapes are
// recognised, and only an unreachable Supabase Auth counts as an outage (not a missing session).
import { AuthApiError, AuthRetryableFetchError, AuthSessionMissingError, PostgrestError } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

import {
  describeError,
  isAuthOutage,
  reportError,
  requestContext,
  type ReportContext,
} from "../../src/lib/report-error";

const EMAIL = "jan.kowalski@example.com";
const USER_ID = "11111111-2222-3333-4444-555555555555";

function ctx(options: { cfRay?: string; userId?: string | null } = {}): ReportContext {
  const headers = new Headers(options.cfRay ? { "cf-ray": options.cfRay } : {});
  return {
    request: new Request("https://example.com/owner/offers/42?code=secret", { headers }),
    routePattern: "/owner/offers/[id]",
    locals: { user: options.userId ? { id: options.userId } : null },
  };
}

let errorSpy: MockInstance<typeof console.error>;
let warnSpy: MockInstance<typeof console.warn>;

beforeEach(() => {
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// The single argument passed to console.error, as the log line Workers Logs would store.
function loggedLine(spy: MockInstance<typeof console.error>): Record<string, unknown> {
  expect(spy).toHaveBeenCalledTimes(1);
  return spy.mock.calls[0]?.[0] as Record<string, unknown>;
}

describe("describeError", () => {
  it("PostgrestError (plain object from a query): keeps code and message, drops details and hint", () => {
    // The shape PostgREST returns for a unique violation; details echo the offending row.
    const err = {
      code: "23505",
      message: "duplicate key value violates unique constraint",
      details: `Key (email)=(${EMAIL}) already exists.`,
      hint: `Use another address than ${EMAIL}`,
    };
    reportError("error", "offers.insert", err, ctx({ userId: USER_ID }));

    const line = loggedLine(errorSpy);
    expect(line.error).toEqual({ kind: "postgrest", code: "23505", message: err.message });
    expect(JSON.stringify(line)).not.toContain(EMAIL);
    expect(JSON.stringify(line)).not.toContain("details");
    expect(JSON.stringify(line)).not.toContain("hint");
  });

  it("PostgrestError instance (throwOnError) is recognised the same way", () => {
    const err = new PostgrestError({ message: "boom", details: EMAIL, hint: EMAIL, code: "PGRST301" });
    expect(describeError(err)).toEqual({ kind: "postgrest", code: "PGRST301", message: "boom" });
  });

  it("PostgrestError message is truncated to 200 characters", () => {
    const described = describeError({ code: "", message: "x".repeat(500), details: "", hint: "" });
    expect(described.kind).toBe("postgrest");
    if (described.kind === "postgrest") expect(described.message.length).toBeLessThanOrEqual(201);
  });

  it("AuthError: logs name, status and code, never the message (it can echo the input)", () => {
    const err = new AuthApiError(`User ${EMAIL} already registered`, 422, "user_already_exists");
    reportError("error", "auth.signup", err, ctx());

    const line = loggedLine(errorSpy);
    expect(line.error).toEqual({ kind: "auth", name: "AuthApiError", status: 422, code: "user_already_exists" });
    expect(JSON.stringify(line)).not.toContain(EMAIL);
    expect(line.error).not.toHaveProperty("message");
  });

  it("plain Error: name, message and a stack cut to 5 lines", () => {
    const err = new Error("render failed");
    err.stack = [
      "Error: render failed",
      ...Array.from({ length: 10 }, (_, i) => `    at frame${i} (file.ts:${i})`),
    ].join("\n");
    const described = describeError(err);

    expect(described).toMatchObject({ kind: "exception", name: "Error", message: "render failed" });
    if (described.kind === "exception") expect(described.stack?.split("\n")).toHaveLength(5);
  });

  it("a value that broke an RPC contract is logged as a result", () => {
    expect(describeError("weird")).toEqual({ kind: "result", value: "weird" });
    expect(describeError(null)).toEqual({ kind: "result", value: null });
  });

  it("undefined means there is no error object at all", () => {
    expect(describeError(undefined)).toEqual({ kind: "none" });
  });
});

describe("requestContext", () => {
  it("uses cf-ray as the request id when Cloudflare sets it", () => {
    expect(requestContext(ctx({ cfRay: "8f1a2b3c4d5e6f70-WAW" })).requestId).toBe("8f1a2b3c4d5e6f70-WAW");
  });

  it("falls back to a random UUID without cf-ray (local dev, preview)", () => {
    expect(requestContext(ctx()).requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it("takes userId from locals.user and null without a user", () => {
    expect(requestContext(ctx({ userId: USER_ID })).userId).toBe(USER_ID);
    expect(requestContext(ctx()).userId).toBeNull();
  });

  it("logs the route pattern, not the URL (ids and tokens stay out)", () => {
    reportError("error", "offers.load", new Error("x"), ctx());
    const line = loggedLine(errorSpy);
    expect(line.route).toBe("/owner/offers/[id]");
    expect(JSON.stringify(line)).not.toContain("secret");
  });
});

describe("reportError", () => {
  it("writes one object with level, op, context and extra fields", () => {
    reportError("error", "invitations.create", "weird", ctx({ cfRay: "ray-1", userId: USER_ID }), {
      offerId: "o-1",
      attempt: 2,
    });

    expect(loggedLine(errorSpy)).toEqual({
      level: "error",
      op: "invitations.create",
      route: "/owner/offers/[id]",
      requestId: "ray-1",
      userId: USER_ID,
      offerId: "o-1",
      attempt: 2,
      error: { kind: "result", value: "weird" },
    });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('level "warn" goes to console.warn, not console.error', () => {
    reportError("warn", "account.delete", "not_found", ctx());

    expect(loggedLine(warnSpy)).toMatchObject({ level: "warn", op: "account.delete" });
    expect(errorSpy).not.toHaveBeenCalled();
  });
});

describe("isAuthOutage", () => {
  it("is true when Supabase Auth cannot be reached (network or 5xx)", () => {
    expect(isAuthOutage(new AuthRetryableFetchError("fetch failed", 0))).toBe(true);
    expect(isAuthOutage(new AuthRetryableFetchError("Service Unavailable", 503))).toBe(true);
  });

  it("is false for a missing or rejected session and for no error", () => {
    expect(isAuthOutage(new AuthSessionMissingError())).toBe(false);
    expect(isAuthOutage(new AuthApiError("forbidden", 403, "bad_jwt"))).toBe(false);
    expect(isAuthOutage(null)).toBe(false);
  });
});
