import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { reportError } from "@/lib/report-error";

export const POST: APIRoute = async (context) => {
  const supabase = createClient(context.request.headers, context.cookies);
  if (supabase) {
    const { error } = await supabase.auth.signOut();
    if (error) {
      reportError("warn", "auth.signout", error, context);
    }
  } else {
    reportError("error", "auth.signout.config", undefined, context);
  }
  return context.redirect("/");
};
