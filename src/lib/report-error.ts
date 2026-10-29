// The one place that turns an error into a log line (Workers Logs), and the one rule for "outage vs no session".
// Pure module: no astro:* and no @/ alias, so Vitest can import it without the Astro config.
import { isAuthError, isAuthRetryableFetchError, PostgrestError } from "@supabase/supabase-js";

/** Structural subset of the Astro APIContext the helper needs (pages, endpoints and middleware all fit). */
export interface ReportContext {
  request: Request;
  routePattern: string;
  locals: { user?: { id: string } | null };
}

export interface RequestContext {
  /** Route pattern (e.g. `/owner/offers/[id]`), never the URL: the path holds ids and the query may hold tokens. */
  route: string;
  requestId: string;
  userId: string | null;
}

export type ErrorDescription =
  | { kind: "postgrest"; code: string; message: string }
  | { kind: "auth"; name: string; status: number | null; code: string | null }
  | { kind: "exception"; name: string; message: string; stack: string | null }
  | { kind: "result"; value: string | number | boolean | null }
  | { kind: "none" };

export type ReportExtra = Record<string, string | number | boolean | null>;

const MAX_MESSAGE = 200;
const MAX_STACK_LINES = 5;

function truncate(text: string): string {
  return text.length > MAX_MESSAGE ? `${text.slice(0, MAX_MESSAGE)}…` : text;
}

/**
 * PostgREST returns its errors as plain objects ({ message, details, hint, code }), and only throws
 * PostgrestError instances with throwOnError, so the check is structural with the class as a shortcut.
 */
function isPostgrestError(err: unknown): err is { message: string; code?: unknown } {
  if (err instanceof PostgrestError) return true;
  if (typeof err !== "object" || err === null) return false;
  if (err instanceof Error) return err.name === "PostgrestError";
  return typeof (err as { message?: unknown }).message === "string";
}

export function requestContext(ctx: ReportContext): RequestContext {
  return {
    route: ctx.routePattern,
    requestId: ctx.request.headers.get("cf-ray") ?? crypto.randomUUID(),
    userId: ctx.locals.user?.id ?? null,
  };
}

/**
 * Privacy: never `details`/`hint` of PostgREST (they echo row values such as e-mails) and never
 * `message` of auth errors (it can echo the input). Only names, codes, statuses and short messages.
 */
export function describeError(err: unknown): ErrorDescription {
  if (err === undefined) return { kind: "none" };
  if (isAuthError(err)) {
    return { kind: "auth", name: err.name, status: err.status ?? null, code: err.code ?? null };
  }
  if (isPostgrestError(err)) {
    const code = typeof err.code === "string" ? err.code : "";
    return { kind: "postgrest", code, message: truncate(err.message) };
  }
  if (err instanceof Error) {
    const stack = err.stack ? err.stack.split("\n").slice(0, MAX_STACK_LINES).join("\n") : null;
    return { kind: "exception", name: err.name, message: truncate(err.message), stack };
  }
  // A value that broke an RPC contract (e.g. an unexpected status string, or null).
  if (typeof err === "string") return { kind: "result", value: truncate(err) };
  if (err === null || typeof err === "number" || typeof err === "boolean") return { kind: "result", value: err };
  // Any other object could carry personal data, so only its type is logged.
  return { kind: "result", value: typeof err };
}

/** Writes one structured log line; `warn` for expected-but-notable states, `error` for failures. */
export function reportError(
  level: "error" | "warn",
  op: string,
  err: unknown,
  ctx: ReportContext,
  extra?: ReportExtra,
): void {
  const line = { level, op, ...requestContext(ctx), ...extra, error: describeError(err) };
  if (level === "error") {
    // eslint-disable-next-line no-console
    console.error(line);
  } else {
    // eslint-disable-next-line no-console
    console.warn(line);
  }
}

/** True only when Supabase Auth could not be reached (network or 5xx); a missing or rejected session is not an outage. */
export function isAuthOutage(error: unknown): boolean {
  return isAuthRetryableFetchError(error);
}
