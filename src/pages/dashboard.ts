import type { APIRoute } from "astro";
import { homeFor } from "@/lib/route-guard";

// No content of its own: routes the signed-in user to their role's panel.
// An endpoint rather than dashboard.astro: a top-level `return Astro.redirect()` in frontmatter crashes
// @typescript-eslint/no-misused-promises under astro-eslint-parser.
export const GET: APIRoute = ({ locals, redirect }) => {
  // Middleware guarantees a profile on gated paths; this narrows the type and fails loudly if that ever breaks.
  if (!locals.profile) {
    throw new Error("/dashboard requires a profile: it must stay in GATED_PATHS in src/lib/route-guard.ts");
  }
  return redirect(homeFor(locals.profile.role));
};
