import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { parseAgentProfileForm, type ProfileErrorCode } from "@/lib/services/agent-profile";

export const POST: APIRoute = async (context) => {
  const fail = (code: ProfileErrorCode) => context.redirect(`/agent/profile?error=${code}`);

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
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
    const { error } = await supabase
      .from("profiles")
      .update({
        cities,
        property_types: propertyTypes,
        price_min: priceMin,
        price_max: priceMax,
        experience_years: experienceYears,
      })
      .eq("id", user.id);
    if (error) {
      // Includes 23514 (check violation): the schema should have caught it, so it is not user input.
      return fail("unknown");
    }
  } catch {
    return fail("unknown");
  }

  return context.redirect("/agent/profile?saved=1");
};
