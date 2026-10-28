import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";

// Landing point of the e-mail confirmation link. Supabase appends `?code=` on success; an expired or reused
// link arrives with `?error=...` instead (or with no code at all), and either way the user gets the same message.
export const GET: APIRoute = async (context) => {
  const fail = () => context.redirect("/auth/signin?error=link_expired");

  const code = context.url.searchParams.get("code");
  if (!code) {
    return fail();
  }

  try {
    const supabase = createClient(context.request.headers, context.cookies);
    if (!supabase) {
      return context.redirect("/auth/signin?error=unavailable");
    }
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      return fail();
    }
  } catch {
    return fail();
  }

  return context.redirect("/dashboard");
};
