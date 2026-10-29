import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { reportError } from "@/lib/report-error";
import { parseOfferForm, type OfferErrorCode } from "@/lib/services/offers";

export const POST: APIRoute = async (context) => {
  const fail = (code: OfferErrorCode) => context.redirect(`/owner/offers/new?error=${code}`);

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    reportError("error", "owner.offers.create.config", undefined, context);
    return fail("unavailable");
  }
  // /api/* is not gated by the middleware: check the session and the role here.
  const { user } = context.locals;
  if (!user) {
    return context.redirect("/auth/signin");
  }

  let offerId: string;
  try {
    const { data: profile, error: roleError } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();
    if (roleError) {
      reportError("error", "owner.offers.create.role", roleError, context);
      return fail("unavailable");
    }
    if (profile?.role !== "owner") {
      return new Response("Forbidden", { status: 403 });
    }

    let parsed: ReturnType<typeof parseOfferForm>;
    try {
      // formData() throws for non-form bodies (e.g. JSON); that is bad input, not an unknown failure.
      parsed = parseOfferForm(await context.request.formData());
    } catch {
      return fail("invalid_input");
    }
    if (!parsed.success) {
      return fail("invalid_input");
    }
    const { city, propertyType, transaction, price, areaM2, rooms, description } = parsed.data;

    // Only the granted columns: owner_id, status, id and created_at take their defaults.
    const { data, error } = await supabase
      .from("offers")
      .insert({
        city,
        property_type: propertyType,
        transaction,
        price,
        area_m2: areaM2,
        rooms,
        description,
      })
      .select("id")
      .single();
    if (error) {
      // Includes 23514 (check violation): the schema should have caught it, so it is not user input.
      reportError("error", "owner.offers.create", error, context);
      return fail("unknown");
    }
    offerId = data.id;
  } catch (e) {
    reportError("error", "owner.offers.create", e, context);
    return fail("unknown");
  }

  return context.redirect(`/owner/offers/${offerId}?created=1`);
};
