import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { reportError } from "@/lib/report-error";
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
    reportError("error", "account.delete.config", undefined, context);
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
      reportError("error", "account.delete.role", roleError ?? undefined, context, { profileFound: profile !== null });
      return unavailable();
    }
    // The check constraint on profiles.role guarantees a Role.
    role = profile.role as Role;
  } catch (e) {
    reportError("error", "account.delete.role", e, context);
    return unavailable();
  }
  const fail = (code: AccountErrorCode) => context.redirect(`${homeFor(role)}/account?error=${code}`);

  try {
    // delete_own_account removes auth.users for auth.uid(); cascades and the invitations trigger do the rest.
    const { data, error } = await supabase.rpc("delete_own_account");
    if (error || !isDeleteAccountResult(data)) {
      reportError("error", "account.delete", error ?? data, context, { rpc: "delete_own_account" });
      return fail("unknown");
    }
    // "not_found" for a signed-in user with a profile means nothing was deleted, so it must not be
    // confirmed as a deletion (D1 in context/archive/2026-10-29-refactor-error-reporting/plan.md, user decision of
    // 2026-10-29; reverses context/archive/2026-10-28-account-deletion/plan.md:140).
    // No signOut: the account still exists.
    if (data === "not_found") {
      reportError("error", "account.delete", data, context, { rpc: "delete_own_account" });
      return fail("unknown");
    }
  } catch (e) {
    reportError("error", "account.delete", e, context, { rpc: "delete_own_account" });
    return fail("unknown");
  }

  // Only "ok" reaches this point. Scope "local" only clears the session cookies
  // (no /logout call for a user that no longer exists); its failure must not change the result.
  try {
    const { error: signOutError } = await supabase.auth.signOut({ scope: "local" });
    if (signOutError) {
      reportError("warn", "account.delete.signOut", signOutError, context);
    }
  } catch (e) {
    // The account is already deleted; the redirect below still applies.
    reportError("warn", "account.delete.signOut", e, context);
  }
  return context.redirect("/?deleted=1");
};
