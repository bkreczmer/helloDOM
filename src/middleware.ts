import { defineMiddleware } from "astro:middleware";
import type { MiddlewareHandler } from "astro";
import { applyAuthCacheHeaders, createClient } from "@/lib/supabase";
import { homeFor, isGated, requiredRole } from "@/lib/route-guard";
import { isAuthOutage, reportError } from "@/lib/report-error";
import type { Profile } from "@/types";

export const onRequest = defineMiddleware(async (context, next) => {
  return applyAuthCacheHeaders(context.cookies, await guard(context, next));
});

const guard: MiddlewareHandler = async (context, next) => {
  const supabase = createClient(context.request.headers, context.cookies);
  const { pathname } = context.url;

  let authOutage = false;
  if (supabase) {
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();
    context.locals.user = user ?? null;
    // Only an unreachable Auth is an outage; a missing or rejected session (any 4xx) just means anonymous.
    if (error && isAuthOutage(error)) {
      authOutage = true;
      context.locals.user = null;
      reportError("error", "middleware.getUser", error, context);
    }
  } else {
    context.locals.user = null;
  }
  context.locals.profile = null;

  if (!isGated(pathname)) {
    return next();
  }

  if (authOutage) {
    return context.redirect("/auth/signin?error=unavailable");
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
    reportError("error", "middleware.profile", error, context);
    return context.redirect("/auth/signin?error=unavailable");
  }
  if (data === null) {
    reportError("error", "middleware.no_profile", undefined, context);
    const { error: signOutError } = await supabase.auth.signOut();
    if (signOutError) {
      reportError("warn", "middleware.signOut", signOutError, context);
    }
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
};
