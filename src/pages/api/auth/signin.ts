import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { toAuthErrorCode, type AuthErrorCode } from "@/lib/services/auth-errors";
import { signInSchema } from "@/lib/services/auth-schemas";

export const POST: APIRoute = async (context) => {
  const fail = (code: AuthErrorCode) => context.redirect(`/auth/signin?error=${code}`);

  let parsed: ReturnType<typeof signInSchema.safeParse>;
  try {
    // formData() throws for non-form bodies (e.g. JSON); that is bad input, not an unknown failure.
    parsed = signInSchema.safeParse(Object.fromEntries(await context.request.formData()));
  } catch {
    return fail("invalid_input");
  }
  if (!parsed.success) {
    return fail("invalid_input");
  }

  try {
    const supabase = createClient(context.request.headers, context.cookies);
    if (!supabase) {
      return fail("unavailable");
    }
    const { error } = await supabase.auth.signInWithPassword(parsed.data);
    if (error) {
      return fail(toAuthErrorCode(error));
    }
  } catch {
    return fail("unknown");
  }

  return context.redirect("/dashboard");
};
