import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { reportError } from "@/lib/report-error";

// Landing point of the e-mail confirmation link. Supabase appends `?code=` on success; an expired or reused
// link arrives with `?error=...` instead (or with no code at all), and either way the user gets the same message.
export const GET: APIRoute = async (context) => {
  const fail = () => context.redirect("/auth/signin?error=link_expired");

  const code = context.url.searchParams.get("code");
  // Only the Supabase error code is logged: error_description is free text and `code` is a one-time secret.
  const errorCode = context.url.searchParams.get("error_code");
  if (errorCode !== null) {
    reportError("warn", "auth.callback", undefined, context, { errorCode: errorCode.slice(0, 64) });
  }
  if (!code) {
    return fail();
  }

  try {
    const supabase = createClient(context.request.headers, context.cookies);
    if (!supabase) {
      reportError("error", "auth.callback.config", undefined, context);
      return context.redirect("/auth/signin?error=unavailable");
    }
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      reportError("warn", "auth.callback", error, context);
      return fail();
    }
  } catch (e) {
    reportError("error", "auth.callback", e, context);
    return fail();
  }

  return context.redirect("/dashboard");
};
