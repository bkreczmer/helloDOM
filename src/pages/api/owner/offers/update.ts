import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { parseOfferForm, parseOfferId, type OfferErrorCode } from "@/lib/services/offers";

export const POST: APIRoute = async (context) => {
  // formData() throws for non-form bodies (e.g. JSON); without a form there is no offer id, so it ends as a 404.
  let formData: FormData | null;
  try {
    formData = await context.request.formData();
  } catch {
    formData = null;
  }
  const rawOfferId = formData?.get("offerId");
  const offerId = typeof rawOfferId === "string" ? parseOfferId(rawOfferId) : null;
  // Errors return to the edit page when the form names a well-formed offer id, otherwise to the panel.
  const fail = (code: OfferErrorCode) =>
    context.redirect(offerId ? `/owner/offers/${offerId}/edit?error=${code}` : "/owner");
  const notFound = () => new Response("Not Found", { status: 404 });

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
    if (profile?.role !== "owner") {
      return new Response("Forbidden", { status: 403 });
    }

    // Checked after the role, so an anonymous or agent request never learns whether the id is valid.
    if (!offerId || !formData) {
      return notFound();
    }

    const parsed = parseOfferForm(formData);
    if (!parsed.success) {
      return fail("invalid_input");
    }
    const { city, propertyType, transaction, price, areaM2, rooms, description } = parsed.data;

    // Only the granted columns. RLS (offers_update_own_editable) limits the update to the owner's own
    // offer while it is draft/seeking_agent; anything else changes 0 rows without an error.
    const { data, error } = await supabase
      .from("offers")
      .update({
        city,
        property_type: propertyType,
        transaction,
        price,
        area_m2: areaM2,
        rooms,
        description,
      })
      .eq("id", offerId)
      .select("id");
    if (error) {
      // Includes 23514 (check violation): the schema should have caught it, so it is not user input.
      return fail("unknown");
    }
    if (data.length > 0) {
      return context.redirect(`/owner/offers/${offerId}?updated=1`);
    }

    // 0 rows: tell "not the owner's / no such offer" (404) from "locked by an invitation", also after
    // a race with invite_agent. The caller is an owner, so RLS shows only their own offers here.
    const { data: existing, error: readError } = await supabase
      .from("offers")
      .select("id")
      .eq("id", offerId)
      .maybeSingle();
    if (readError) {
      return fail("unavailable");
    }
    if (!existing) {
      return notFound();
    }
    return context.redirect(`/owner/offers/${offerId}?error=edit_locked`);
  } catch {
    return fail("unknown");
  }
};
