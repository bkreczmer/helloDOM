import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { reportError } from "@/lib/report-error";
import { isInviteResult, parseInviteForm, type InvitationErrorCode } from "@/lib/services/invitations";
import { parseOfferId } from "@/lib/services/offers";

export const POST: APIRoute = async (context) => {
  // formData() throws for non-form bodies (e.g. JSON); that is bad input with no offer to return to.
  let formData: FormData | null;
  try {
    formData = await context.request.formData();
  } catch {
    formData = null;
  }
  const rawOfferId = formData?.get("offerId");
  // Errors return to the offer page when the form names a well-formed offer id, otherwise to the panel.
  const offerPath = typeof rawOfferId === "string" ? offerPathFor(parseOfferId(rawOfferId)) : null;
  const fail = (code: InvitationErrorCode) => context.redirect(offerPath ? `${offerPath}?error=${code}` : "/owner");

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    reportError("error", "owner.invite.config", undefined, context);
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
      reportError("error", "owner.invite.role", roleError, context);
      return fail("unavailable");
    }
    if (profile?.role !== "owner") {
      return new Response("Forbidden", { status: 403 });
    }

    const parsed = formData ? parseInviteForm(formData) : null;
    if (!parsed?.success) {
      return fail("invalid_input");
    }
    const { offerId, agentId } = parsed.data;

    // invite_agent checks the owner, the offer status and the current top 3 in one transaction.
    const { data, error } = await supabase.rpc("invite_agent", { p_offer_id: offerId, p_agent_id: agentId });
    if (error || !isInviteResult(data)) {
      reportError("error", "owner.invite", error ?? data, context, { offerId, agentId, rpc: "invite_agent" });
      return fail("unknown");
    }
    switch (data) {
      case "ok":
        return context.redirect(`/owner/offers/${offerId}?invited=1`);
      case "not_found":
        // Someone else's or a missing offer: the same 404 as the offer page, nothing to redirect to.
        reportError("warn", "owner.invite.not_found", data, context, { offerId, agentId, rpc: "invite_agent" });
        return new Response("Not Found", { status: 404 });
      case "offer_locked":
      case "agent_not_ranked":
        return fail(data);
    }
  } catch (e) {
    reportError("error", "owner.invite", e, context, { rpc: "invite_agent" });
    return fail("unknown");
  }
};

function offerPathFor(offerId: string | null): string | null {
  return offerId ? `/owner/offers/${offerId}` : null;
}
