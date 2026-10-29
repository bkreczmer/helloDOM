import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { parseOfferId } from "@/lib/services/offers";

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
  // Errors return to the offer page when the form names a well-formed offer id, otherwise to the panel.
  const fail = () => context.redirect(offerId ? `/owner/offers/${offerId}?error=delete_failed` : "/owner");
  const notFound = () => new Response("Not Found", { status: 404 });

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return fail();
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
      return fail();
    }
    if (profile?.role !== "owner") {
      return new Response("Forbidden", { status: 403 });
    }

    // Checked after the role, so an anonymous or agent request never learns whether the id is valid.
    if (!offerId) {
      return notFound();
    }

    // RLS (offers_delete_own) limits the delete to the owner's own offer, in any status; someone else's
    // or a missing offer deletes 0 rows without an error. Invitations go with it (on delete cascade).
    const { data, error } = await supabase.from("offers").delete().eq("id", offerId).select("id");
    if (error) {
      return fail();
    }
    if (data.length === 0) {
      return notFound();
    }
    return context.redirect("/owner?deleted=1");
  } catch {
    return fail();
  }
};
