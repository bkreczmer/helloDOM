import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
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
      return fail("unavailable");
    }
    // The confirmation link must come back to this deployment, not to the Site URL configured in Supabase.
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { role }, emailRedirectTo: `${context.url.origin}/auth/callback` },
    });
    if (error) {
      return fail(toAuthErrorCode(error));
    }
    hasSession = data.session !== null;
  } catch {
    return fail("unknown");
  }

  // With email confirmation off Supabase returns a session right away; otherwise the user must confirm first.
  return context.redirect(hasSession ? "/dashboard" : "/auth/confirm-email");
};
