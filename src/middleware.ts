import { defineMiddleware } from "astro:middleware";
import { createClient } from "@/lib/supabase";
import { homeFor, isGated, requiredRole } from "@/lib/route-guard";
import type { Profile } from "@/types";

export const onRequest = defineMiddleware(async (context, next) => {
  const supabase = createClient(context.request.headers, context.cookies);
  const { pathname } = context.url;

  if (supabase) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    context.locals.user = user ?? null;
  } else {
    context.locals.user = null;
  }
  context.locals.profile = null;

  if (!isGated(pathname)) {
    return next();
  }

  const { user } = context.locals;
  if (!supabase || !user) {
    return context.redirect("/auth/signin");
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("id, role, created_at")
    .eq("id", user.id)
    .maybeSingle();

  if (error) {
    // A transient database error must not wipe the session, so no signOut() here.
    return context.redirect("/auth/signin?error=unavailable");
  }
  if (data === null) {
    await supabase.auth.signOut();
    return context.redirect("/auth/signin?error=no_profile");
  }

  // The check constraint on profiles.role guarantees a Role.
  const profile = data as Profile;
  context.locals.profile = profile;

  const role = requiredRole(pathname);
  if (role !== null && role !== profile.role) {
    return context.redirect(homeFor(profile.role));
  }

  return next();
});
