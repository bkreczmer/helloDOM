import { createServerClient, parseCookieHeader } from "@supabase/ssr";
import type { AstroCookies } from "astro";
import { SUPABASE_URL, SUPABASE_KEY } from "astro:env/server";
import type { Database } from "@/db/database.types";

// Cache headers that @supabase/ssr hands over with auth cookies, keyed by the request's cookie jar
// (middleware and the page share one AstroCookies per request). The middleware puts them on the response.
const authCacheHeaders = new WeakMap<AstroCookies, Record<string, string>>();

export function createClient(requestHeaders: Headers, cookies: AstroCookies) {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return null;
  }
  return createServerClient<Database>(SUPABASE_URL, SUPABASE_KEY, {
    cookies: {
      getAll() {
        return parseCookieHeader(requestHeaders.get("Cookie") ?? "");
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value, options }) => {
          cookies.set(name, value, options);
        });
        if (Object.keys(headers).length > 0) {
          authCacheHeaders.set(cookies, { ...authCacheHeaders.get(cookies), ...headers });
        }
      },
    },
  });
}

// A response that sets auth cookies must not be cached by Cloudflare or any other proxy.
export function applyAuthCacheHeaders(cookies: AstroCookies, response: Response): Response {
  const headers = authCacheHeaders.get(cookies);
  if (headers) {
    for (const [name, value] of Object.entries(headers)) {
      response.headers.set(name, value);
    }
  }
  return response;
}
