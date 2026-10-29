import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { reportError } from "@/lib/report-error";
import { isRespondResult, parseRespondForm, type ResponseErrorCode } from "@/lib/services/invitations";
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
  const fail = (code: ResponseErrorCode) =>
    context.redirect(offerPath ? `${offerPath}?error=${code}` : `/agent?error=${code}`);

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    reportError("error", "agent.respond.config", undefined, context);
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
      reportError("error", "agent.respond.role", roleError, context);
      return fail("unavailable");
    }
    if (profile?.role !== "agent") {
      return new Response("Forbidden", { status: 403 });
    }

    const parsed = formData ? parseRespondForm(formData) : null;
    if (!parsed?.success) {
      return fail("invalid_input");
    }
    const { offerId, response } = parsed.data;

    // respond_to_invitation locks the offer and the invitation, then updates both in one transaction.
    const { data, error } = await supabase.rpc("respond_to_invitation", {
      p_offer_id: offerId,
      p_response: response,
    });
    if (error || !isRespondResult(data)) {
      reportError("error", "agent.respond", error ?? data, context, { offerId, rpc: "respond_to_invitation" });
      return fail("unknown");
    }
    switch (data) {
      case "ok":
        // After a rejection RLS hides the offer, so the confirmation goes to the panel.
        return context.redirect(response === "accept" ? `/agent/offers/${offerId}?accepted=1` : "/agent?rejected=1");
      case "not_found":
        // No invitation of this agent to the offer: the same 404 as the offer page, nothing to redirect to.
        reportError("warn", "agent.respond.not_found", data, context, { offerId, rpc: "respond_to_invitation" });
        return new Response("Not Found", { status: 404 });
      case "already_responded":
        // A rejected offer's page is a 404, so the message is shown on the panel.
        return context.redirect("/agent?error=already_responded");
      case "invalid_response":
        // The form schema only allows accept/reject, so the RPC rejecting it is a broken contract.
        reportError("error", "agent.respond", data, context, { offerId, rpc: "respond_to_invitation" });
        return fail("unknown");
    }
  } catch (e) {
    reportError("error", "agent.respond", e, context, { rpc: "respond_to_invitation" });
    return fail("unknown");
  }
};

function offerPathFor(offerId: string | null): string | null {
  return offerId ? `/agent/offers/${offerId}` : null;
}
