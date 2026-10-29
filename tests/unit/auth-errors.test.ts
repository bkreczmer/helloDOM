// Proof for authErrorLogLevel (src/lib/services/auth-errors.ts): outages and unknown codes are logged
// as errors, the rate limit as a warning, and ordinary user errors are not logged at all.
import { describe, expect, it } from "vitest";

import { authErrorLogLevel } from "../../src/lib/services/auth-errors";

describe("authErrorLogLevel", () => {
  it.each([
    ["unknown", undefined, "error"],
    ["unavailable", 503, "error"],
    ["invalid_credentials", 500, "error"],
    ["rate_limited", 429, "warn"],
    ["invalid_credentials", 400, null],
    ["user_already_exists", 422, null],
  ] as const)("%s with status %s → %s", (code, status, expected) => {
    expect(authErrorLogLevel(code, status)).toBe(expected);
  });
});
