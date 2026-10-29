import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { homeFor } from "@/lib/route-guard";
import { isDeleteAccountResult, type AccountErrorCode } from "@/lib/services/account";
import type { Role } from "@/types";

export const POST: APIRoute = async (context) => {
  // /api/* is not gated by the middleware: check the session and the role here.
  const { user } = context.locals;
  if (!user) {
    return context.redirect("/auth/signin");
  }
  // Without a role the account page is unknown; same target as the middleware on a profile read error.
  const unavailable = () => context.redirect("/auth/signin?error=unavailable");

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return unavailable();
  }

  let role: Role;
  try {
    const { data: profile, error: roleError } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();
    if (roleError || profile === null) {
      return unavailable();
    }
    // The check constraint on profiles.role guarantees a Role.
    role = profile.role as Role;
  } catch {
    return unavailable();
  }
  const fail = (code: AccountErrorCode) => context.redirect(`${homeFor(role)}/account?error=${code}`);

  try {
    // delete_own_account removes auth.users for auth.uid(); cascades and the invitations trigger do the rest.
    const { data, error } = await supabase.rpc("delete_own_account");
    if (error || !isDeleteAccountResult(data)) {
      return fail("unknown");
    }
  } catch {
    return fail("unknown");
  }

  // "ok" and "not_found" both mean the account is gone. Scope "local" only clears the session cookies
  // (no /logout call for a user that no longer exists); its failure must not change the result.
  try {
    await supabase.auth.signOut({ scope: "local" });
  } catch {
    // The account is already deleted; the redirect below still applies.
  }
  return context.redirect("/?deleted=1");
};
