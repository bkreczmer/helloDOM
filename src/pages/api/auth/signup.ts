import type { APIRoute } from "astro";
import { SITE_URL } from "astro:env/server";
import { createClient } from "@/lib/supabase";
import { reportError } from "@/lib/report-error";
import { toAuthErrorCode, type AuthErrorCode } from "@/lib/services/auth-errors";
import { signUpSchema } from "@/lib/services/auth-schemas";

export const POST: APIRoute = async (context) => {
  const fail = (code: AuthErrorCode) => context.redirect(`/auth/signup?error=${code}`);

  let parsed: ReturnType<typeof signUpSchema.safeParse>;
  try {
    // formData() throws for non-form bodies (e.g. JSON); that is bad input, not an unknown failure.
    parsed = signUpSchema.safeParse(Object.fromEntries(await context.request.formData()));
  } catch {
    return fail("invalid_input");
  }
  if (!parsed.success) {
    return fail("invalid_input");
  }
  const { email, password, role } = parsed.data;

  let hasSession: boolean;
  try {
    const supabase = createClient(context.request.headers, context.cookies);
    if (!supabase) {
      reportError("error", "auth.signup.config", undefined, context);
      return fail("unavailable");
    }
    // The confirmation link must come back to this deployment, not to the Site URL configured in Supabase.
    // SITE_URL pins it in production; without it the request origin is used (local dev).
    const emailRedirectTo = new URL("/auth/callback", SITE_URL ?? context.url.origin).href;
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { role }, emailRedirectTo },
    });
    if (error) {
      const code = toAuthErrorCode(error);
      // Ordinary user errors (wrong password, existing account) stay out of the log.
      if (code === "unknown" || code === "unavailable" || (error.status ?? 0) >= 500) {
        reportError("error", "auth.signup", error, context);
      } else if (code === "rate_limited") {
        reportError("warn", "auth.signup", error, context);
      }
      return fail(code);
    }
    hasSession = data.session !== null;
  } catch (e) {
    reportError("error", "auth.signup", e, context);
    return fail("unknown");
  }

  // With email confirmation off Supabase returns a session right away; otherwise the user must confirm first.
  return context.redirect(hasSession ? "/dashboard" : "/auth/confirm-email");
};
