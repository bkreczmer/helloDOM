import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { reportError } from "@/lib/report-error";
import { parseAgentProfileForm, type ProfileErrorCode } from "@/lib/services/agent-profile";

export const POST: APIRoute = async (context) => {
  const fail = (code: ProfileErrorCode) => context.redirect(`/agent/profile?error=${code}`);

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    reportError("error", "agent.profile.save.config", undefined, context);
    return fail("unavailable");
  }
  // /api/* is not gated by the middleware: check the session and the role here.
  const { user } = context.locals;
  if (!user) {
    return context.redirect("/auth/signin");
  }

  try {
    const { data: profile, error: roleError } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();
    if (roleError) {
      reportError("error", "agent.profile.save.role", roleError, context);
      return fail("unavailable");
    }
    if (profile?.role !== "agent") {
      return new Response("Forbidden", { status: 403 });
    }

    let parsed: ReturnType<typeof parseAgentProfileForm>;
    try {
      // formData() throws for non-form bodies (e.g. JSON); that is bad input, not an unknown failure.
      parsed = parseAgentProfileForm(await context.request.formData());
    } catch {
      return fail("invalid_input");
    }
    if (!parsed.success) {
      return fail("invalid_input");
    }
    const { cities, propertyTypes, priceMin, priceMax, experienceYears } = parsed.data;

    // Every save replaces all five columns: an empty or omitted field clears its value.
    const { data: updated, error } = await supabase
      .from("profiles")
      .update({
        cities,
        property_types: propertyTypes,
        price_min: priceMin,
        price_max: priceMax,
        experience_years: experienceYears,
      })
      .eq("id", user.id)
      .select("id");
    if (error || updated.length === 0) {
      // Includes 23514 (check violation): the schema should have caught it, so it is not user input.
      // Zero rows means RLS filtered the update out; do not report it as saved.
      reportError("error", "agent.profile.save", error ?? undefined, context, { updatedRows: updated?.length ?? 0 });
      return fail("unknown");
    }
  } catch (e) {
    reportError("error", "agent.profile.save", e, context);
    return fail("unknown");
  }

  return context.redirect("/agent/profile?saved=1");
};
