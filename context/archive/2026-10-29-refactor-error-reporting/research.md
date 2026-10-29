---
date: 2026-10-29T17:33:59+01:00
researcher: Claude (Opus 5.5) for bkreczmer
git_commit: 08f82195a62e29cc9c32920a14223cf4a4ce2f16
branch: refactor/error-reporting
repository: bkreczmer/helloDOM
topic: "Wspólna obsługa i raportowanie błędów: stan obecny, API platformy, wpływ na testy, testowanie helpera"
tags: [research, error-handling, observability, middleware, account-deletion, astro, supabase]
status: complete
last_updated: 2026-10-29
last_updated_by: Claude (Opus 5.5)
---

# Research: wspólna obsługa i raportowanie błędów (refaktor M4)

**Date**: 2026-10-29T17:33:59+01:00
**Researcher**: Claude (Opus 5.5) for bkreczmer
**Git Commit**: 08f82195a62e29cc9c32920a14223cf4a4ce2f16
**Branch**: refactor/error-reporting
**Repository**: bkreczmer/helloDOM

## Research Question

1. Jak dziś każdy endpoint, strona i middleware obsługują błędy (pełna lista `fail()` / `catch` / `{ error }`)?
2. Jakie API dają Astro 7 + `@astrojs/cloudflare` do logowania i kontekstu żądania (cf-ray, locals)?
3. Jak bezpiecznie zmienić semantykę D1 (usunięcie konta) i middleware bez łamania testów (smoke, integration, e2e)?
4. Jak przetestować `reportError` w Vitest bez Supabase?

Źródła zadania: `context/map/repo-map.md` (strefy ryzyka access, auth) i `context/audits/observability/2026-10-29_auth-offer-ranking-invitation-account-deletion.md` (ustalenia A1–A10, O1–O11, D1–D6, P1–P4).

## Summary

- **Stan obecny (kod przy `08f8219`, sprawdzone pliki w `src/`):**
  - 0 wywołań `console.*` w `src/`;
  - po stronie serwera 30 `catch {}` bez bindingu (20 w `src/pages/api/**` + `src/pages/auth/callback.ts`, 10 w stronach `.astro`) i 0 `catch (e)`; 2 kolejne `catch {}` są po stronie klienta (localStorage), stąd 32 w audycie;
  - 29 gałęzi `if (error)` po wynikach Supabase (19 w middleware/callback/API, 10 w stronach), żadna nie loguje błędu; dodatkowo błąd `getUser()` w ogóle nie jest odczytywany (`src/middleware.ts:11-13`);
  - 3 sprawdzenia kontraktu RPC (`src/pages/api/account/delete.ts:41`, `src/pages/api/agent/invitations.ts:54`, `src/pages/api/owner/invitations.ts:50`);
  - 18 gałęzi „brak klienta” po `createClient` zwracającym `null` (`src/lib/supabase.ts:7-9`);
  - 3 zignorowane wyniki `signOut()` (`src/middleware.ts:40`, `src/pages/api/auth/signout.ts:7`, `src/pages/api/account/delete.ts:51`).
  - Każdy z 10 endpointów API i `callback.ts` ma lokalne domknięcie `fail` (zwykle `(code) => Response`; bez argumentów w `owner/offers/delete.ts:16` i `auth/callback.ts:7`), które przyjmuje tylko kod, nigdy obiekt błędu.
- **Platforma:**
  - `console.error` / `console.warn` / `console.info` trafiają do Workers Logs jako poziomy error / warn / info. Czy pola stringa JSON są indeksowane, nie da się ustalić z repo; obiekt przekazany do `console.error` to ścieżka udokumentowana przez Cloudflare (niezweryfikowane tutaj).
  - Kontekst żądania: `context.routePattern` (np. `/owner/offers/[id]`, `node_modules/astro/dist/types/public/context.d.ts:583`), `context.locals.user` (`src/env.d.ts`), nagłówek `cf-ray` (ustawiany przez krawędź Cloudflare, lokalnie `null`).
  - `locals.runtime` w tej wersji adaptera rzuca wyjątek (`node_modules/@astrojs/cloudflare/dist/utils/cf-helpers.js:27-51`), więc nie wolno go używać.
- **Klasyfikacja błędów Supabase:**
  - „Brak sesji” to `AuthSessionMissingError` (status 400), strażnik `isAuthSessionMissingError`.
  - Awaria to `AuthRetryableFetchError` (status 0 albo 500–504 / 520–530), strażnik `isAuthRetryableFetchError`.
  - Pozostałe `AuthApiError` 4xx (np. JWT usuniętego użytkownika, wygasły refresh) to sesja nieważna, a nie awaria.
  - Oba strażniki są dostępne z `@supabase/supabase-js` (`dist/index.d.mts:7` reeksportuje `@supabase/auth-js`).
  - `PostgrestError` z pustym `code` oznacza brak połączenia z bazą; kod typu `PGRST116` / `42501` oznacza odrzucenie przez bazę.
- **Testy:**
  - (b) D1 nie łamie żadnego testu: każde konto jest usuwane raz, w smoke `scripts/smoke.mjs:738,758,768,773` i w E2E `tests/e2e/helpers.ts:162-180`.
  - (c) middleware łamie smoke, jeśli `AuthSessionMissingError` albo 4xx zostaną potraktowane jako awaria. 11 kroków oczekuje dokładnie `302 /auth/signin` (m.in. `scripts/smoke.mjs:135,213,740,775`, porównanie dokładne `:802-805`).
  - (d) 503 w stanach błędu nie łamie testów: żaden test nie sprawdza stanu błędu stron.
- **Testowanie helpera:** Vitest nie ładuje konfiguracji Astro (`vitest.config.ts`), więc moduły importujące `astro:*` (`src/lib/supabase.ts:3`, `src/lib/config-status.ts:1`) i alias `@/` nie działają w testach. Helper i klasyfikator błędów muszą być czystymi modułami (bez `astro:*`, importy względne), testowanymi w nowym `tests/unit/**` z `vi.spyOn(console, "error")`.
- **Decyzje z przeszłości, które zmiana odwraca** (plan musi je jawnie uzasadnić):
  - D1: `not_found` celowo liczone jako sukces (`context/archive/2026-10-28-account-deletion/plan.md:140`, `:49`; komentarz `src/pages/api/account/delete.ts:46-48`).
  - `signOut` przy braku profilu wprowadzono, by uniknąć pętli przekierowań (`context/archive/2026-10-27-role-based-signup/plan.md:67`).

## Detailed Findings

### 1. Obsługa błędów dziś

**Middleware** (`src/middleware.ts`, bez żadnego `try`; wyjątek staje się 500 Astro):

| Linia  | Rodzaj                          | Dziś                                                                              |
| ------ | ------------------------------- | --------------------------------------------------------------------------------- |
| 11-13  | `getUser()` bez odczytu `error` | `locals.user = null` → ścieżki bramkowane: 302 `/auth/signin` bez kodu (`:25-26`) |
| 10, 15 | brak klienta                    | jak wyżej                                                                         |
| 35-37  | błąd odczytu `profiles`         | 302 `/auth/signin?error=unavailable`, błąd porzucony, celowo bez signOut          |
| 39-41  | brak wiersza profilu            | `await signOut()` (wynik ignorowany) → 302 `?error=no_profile`                    |

**Endpointy API** — wspólny kształt: `createClient` → null-check → `locals.user` → odczyt roli (`if (roleError) fail("unavailable")`, brak/zła rola → 403) → parsowanie formularza → operacja Supabase (`if (error) fail("unknown")`) → `catch {}` → `fail("unknown")`. Identyfikatory w zasięgu w punktach błędu: `user.id` (wszędzie poza signin/signup/callback, gdzie `locals.user` jest null), `offerId` (`owner/offers/update.ts`, `owner/offers/delete.ts`, `owner/invitations.ts`, `agent/invitations.ts`), `agentId` (`owner/invitations.ts`), nazwa operacji RPC (`invite_agent`, `respond_to_invitation`, `delete_own_account`). W `signin.ts` / `signup.ts` w zasięgu jest e-mail — dana osobowa, nie logować.

| Plik                         | `fail` (linia)                          | Gałęzie błędów (linie)                                                                                                                                                                                    |
| ---------------------------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `api/account/delete.ts`      | `unavailable` `:14`, `fail(code)` `:36` | brak klienta `:17`; błąd roli lub brak profilu `:28`; `catch` `:33`; błąd RPC lub kontraktu `:41`; `catch` `:44`; signOut `:51-53`                                                                        |
| `api/agent/invitations.ts`   | `:17`                                   | `catch` formData `:11`; brak klienta `:21`; błąd roli `:36`; 403 `:39`; RPC/kontrakt `:54`; `not_found` → 404 `:61`; `already_responded` `:65`; `invalid_response` → unknown `:67`; `catch` `:70`         |
| `api/agent/profile.ts`       | `:6`                                    | brak klienta `:9`; błąd roli `:24`; 403 `:27`; `catch` formData `:35`; błąd lub 0 wierszy `:55`; `catch` `:60`                                                                                            |
| `api/auth/signin.ts`         | `:7`                                    | `catch` formData `:13`; brak klienta `:22`; błąd → `toAuthErrorCode` `:26`; `catch` `:29`                                                                                                                 |
| `api/auth/signup.ts`         | `:8`                                    | `catch` formData `:15`; brak klienta `:25`; błąd → `toAuthErrorCode` `:36`; `catch` `:40`                                                                                                                 |
| `api/auth/signout.ts`        | —                                       | brak klienta pominięty po cichu `:6`; wynik `signOut()` ignorowany, bez try `:7`                                                                                                                          |
| `api/owner/invitations.ts`   | `:17`                                   | `catch` formData `:12`; brak klienta `:20`; błąd roli `:35`; 403 `:38`; RPC/kontrakt `:50`; `not_found` → 404 `:56`; `offer_locked`/`agent_not_ranked` `:59-61`; `catch` `:63`                            |
| `api/owner/offers.ts`        | `:6`                                    | brak klienta `:9`; błąd roli `:25`; 403 `:28`; `catch` formData `:36`; błąd insertu `:58`; `catch` `:63`                                                                                                  |
| `api/owner/offers/delete.ts` | `fail()` `:16`, `notFound` `:17`        | `catch` formData `:10`; brak klienta `:20`; błąd roli `:35`; 403 `:38`; zły id → 404 `:43`; błąd delete `:50`; 0 wierszy → 404 `:53`; `catch` `:57`                                                       |
| `api/owner/offers/update.ts` | `:16`                                   | `catch` formData `:10`; brak klienta `:21`; błąd roli `:36`; 403 `:39`; 404 `:44`; błąd update `:69`; 0 wierszy → ponowny odczyt `:73`; błąd odczytu `:84`; 404 `:87`; `edit_locked` `:90`; `catch` `:92` |
| `auth/callback.ts`           | `fail()` `:7`                           | brak klienta `:16`; błąd `exchangeCodeForSession` `:20`; `catch` `:23`                                                                                                                                    |
| `dashboard.ts`               | —                                       | celowy `throw` przy braku profilu `:9-10` (→ 500 Astro, zalogowany jako tekst)                                                                                                                            |

**Strony `.astro`** (wszystkie bramkowane; `Astro.locals.user` i `profile` dostępne): błąd, brak klienta i `catch {}` ustawiają `state = "error"` albo `null` i renderują 200. Status 404 ustawiany jest tylko dla „missing”: `src/pages/owner/offers/[id].astro:96-98`, `src/pages/agent/offers/[id].astro:61-63`, `src/pages/owner/offers/[id]/edit.astro:57-59`. Strony list i profilu (`owner/index.astro:23-33`, `agent/index.astro:21-31`, `agent/profile.astro:21-31`) nie ustawiają statusu. W `owner/offers/[id].astro` błąd RPC rankingu ustawia `agents = null` (`:58-59`), a błędy odczytu dat zaproszeń gubią tylko datę (`:72-73`, `:85-87`). Mapowania `to*` mogą rzucić z `oneOf` (`src/lib/services/offers.ts:101-104`) i są połykane przez te same `catch {}`.

**Twierdzenia audytu — weryfikacja:**

- D1 potwierdzone: `delete.ts:41` sprawdza tylko kontrakt; `ok` i `not_found` przechodzą do signOut i `/?deleted=1` (komentarz `:46-48`).
- A1 potwierdzone: `middleware.ts:11-13` odczytuje wyłącznie `data.user`.
- A2 potwierdzone: `middleware.ts:39-41`.
- O2 potwierdzone: brak statusu w stanie „error” (jw.).
- A8 potwierdzone: `supabase.ts:7-9`; braki konfiguracji widać tylko w banerze UI (`src/lib/config-status.ts:21`, `src/layouts/Layout.astro:31`).

### 2. API platformy

- **Wersje (z `node_modules/*/package.json`):** astro 7.4.2, @astrojs/cloudflare 14.3.1, wrangler 4.152.0, @supabase/supabase-js 2.116.0, @supabase/ssr 0.12.7, @supabase/auth-js i postgrest-js 2.116.0.
- **Logger Astro:** destynacja konsolowa kieruje poziom `error` do `console.error`, niższe do `console.info` (`node_modules/astro/dist/core/logger/impls/console.js:5-9`). Nieprzechwycony wyjątek ze strony, endpointu albo middleware jest logowany jako `err.stack` (`node_modules/astro/dist/core/routing/handler.js:189`, `node_modules/astro/dist/core/middleware/astro-middleware.js:106`). Helper doda linię strukturalną obok, a nie zamiast.
- **Kontekst żądania:**
  - `context.routePattern: string` (`context.d.ts:583`) ma niską kardynalność, więc nadaje się do logów (`url.pathname` zawiera id, a `url.search` może zawierać `code`/`token_hash` w callbacku).
  - `locals` typuje `App.Locals extends Runtime` z `cfContext: ExecutionContext` (`node_modules/@astrojs/cloudflare/types.d.ts:4`, `dist/utils/cf-helpers.d.ts:1-3`).
  - `locals.runtime.*` rzuca wyjątek „removed in Astro v6” (`cf-helpers.js:27-51`).
  - Nagłówek `cf-ray` nie jest dotykany przez Astro ani adapter; lokalnie i w preview smoke będzie `null`. Fallback: `crypto.randomUUID()`.
- **Strona 500:** dla nieprzechwyconego wyjątku Astro renderuje `500.astro` z `Astro.props.error` (`node_modules/astro/dist/core/errors/default-handler.js:76`). Działa to także dla endpointów, o ile strona nie jest prerenderowana (`:30-57`). Middleware uruchamia się ponownie przy renderze 500 (`:80`). Przekierowywalne są tylko statusy `[404, 500]` (`node_modules/astro/dist/core/constants.js:29`), więc `new Response(null, { status: 503 })` z middleware trafia do klienta jako puste 503. Stronę błędu daje `context.rewrite(...)` albo własne body.
- **Kształty błędów Supabase:**
  - `PostgrestError` { `message`, `details`, `hint`, `code` }. Przy błędzie sieci `code === ""` (`node_modules/@supabase/postgrest-js/dist/index.mjs:416-448`).
  - `AuthError` { `name`, `message`, `status`, `code` } (`node_modules/@supabase/auth-js/dist/module/lib/errors.d.ts:13-32`).
  - `isAuthSessionMissingError` (`errors.d.ts:94`): `getUser()` zwraca ten błąd bez tokenu.
  - `isAuthRetryableFetchError` (`errors.d.ts:214`): status 0 (sieć) albo 5xx.
- **Prywatność (nie logować):** body żądania i pola formularza, ciasteczka `sb-*`, nagłówek Authorization, obiekty sesji, e-mail i `user_metadata`, adres IP (`cf-connecting-ip`), `PostgrestError.details` (np. `Key (email)=(…) already exists`), `AuthError.message` (może zawierać echo danych). Bezpiecznie: `user.id`, `offerId`, `agentId`, `routePattern`, `op`, `code`, `status`, `name` i skrócony `message` dla Postgrest.

### 3. Wpływ na testy

- **(b) D1** (`not_found` przy zalogowanym użytkowniku → błąd):
  - smoke usuwa każde konto raz i oczekuje `302 /?deleted=1` (`scripts/smoke.mjs:738,758,768,773`, banner `:788-789`);
  - E2E `deleteAccounts` raz na konto (`tests/e2e/helpers.ts:162-180`, `tests/e2e/critical-path.spec.ts:127-129`);
  - integracja usuwa konta przez RPC bezpośrednio i już traktuje wszystko poza `"ok"` jako błąd (`tests/integration/helpers.ts:139-153`);
  - `supabase/tests/account-deletion.sql:192-215` testuje funkcję SQL, a ta się nie zmienia.
  - Endpoint już przy braku profilu zwraca `unavailable` przed RPC (`delete.ts:28-29`), więc `not_found` z RPC przy żywym profilu oznacza anomalię (wyścig albo JWT, który nie dotarł do PostgREST).
- **(c) middleware:**
  - smoke porównuje `location` dokładnie (`scripts/smoke.mjs:802-805`) i 11 kroków oczekuje `302 /auth/signin` bez parametru (`:135,213,343,353,413,638,689-703,740,775`), w tym anonimowe wejście i „usunięte konto nie ma sesji” (`:740`, `:775`);
  - strona główna anonimowo musi dawać 200 (`:134`);
  - wniosek: tylko `isAuthRetryableFetchError` (albo `status >= 500`) jest awarią; `AuthSessionMissingError` i pozostałe 4xx to „brak sesji”.
- **`no_profile`:** brak testu (`context/archive/2026-10-27-role-based-signup/reviews/impl-review.md:60` odnotował lukę). Powód signOut: uniknięcie pętli, „jeśli kiedyś dodamy auto-redirect zalogowanych” (`context/archive/2026-10-27-role-based-signup/plan.md:67`). Taki auto-redirect dziś nie istnieje w `src/middleware.ts` (sprawdzona ścieżka: brak gałęzi dla `/auth/*` przy zalogowanym użytkowniku). Kanał lądowania dla kont sprzed ról: `plan.md:513`.
- **(d) 503:** żaden test nie sprawdza stanu błędu stron. Smoke i E2E sprawdzają 200 na ścieżkach szczęśliwych i 404 na brakujących (`tests/e2e/critical-path.spec.ts:74,247`).

### 4. Testowanie helpera

- `vitest.config.ts` używa `defineConfig` bez `getViteConfig` i bez aliasów (komentarz: Astro config nie jest ładowany), `include` = `tests/integration/**` + `tests/hooks/**`.
- `astro:*` importują tylko `src/lib/supabase.ts:3` (`astro:env/server`), `src/lib/config-status.ts:1` i `src/middleware.ts:1` (`astro:middleware`).
- Rekomendacja:
  - `src/lib/report-error.ts` jako czysty moduł (bez `astro:*`, typy z `astro` tylko `import type`);
  - logika klasyfikacji (np. `classifyAuthError`) też czysta;
  - testy w `tests/unit/**/*.test.ts` dopisane do `include`, z `vi.spyOn(console, "error").mockImplementation(() => {})`.
  - Gałęzie middleware i endpointów pokrywa smoke (importu `astro:middleware` w Vitest nie ma).
- `eslint.config.js:25`: `"no-console": "warn"` (wyłączone dla `scripts/**`, `:73-78`). Ani `package.json`, ani CI nie używają `--max-warnings`, więc ostrzeżenie nie blokuje, ale helper powinien być jedynym miejscem z `console.*` (wyłączenie reguły tylko tam).

## Code References

- `src/middleware.ts:11-13` — `getUser()` bez odczytu `error`
- `src/middleware.ts:35-41` — błąd profilu → `unavailable` bez signOut; brak profilu → signOut + `no_profile`
- `src/pages/api/account/delete.ts:41-55` — `not_found` traktowane jak sukces
- `src/lib/supabase.ts:7-9` — `null` przy braku env
- `src/lib/services/auth-errors.ts:34-44` — mapowanie kodów Supabase na kody UI (`toAuthErrorCode`)
- `src/lib/services/offers.ts:101-104` — `oneOf` rzuca przy dryfie słownika
- `src/pages/owner/offers/[id].astro:43-61,96-98` — stany błędu bez statusu, ranking `agents = null`
- `scripts/smoke.mjs:802-805` — dokładne porównanie `location` w smoke
- `node_modules/@supabase/auth-js/dist/module/lib/errors.d.ts:94,214` — `isAuthSessionMissingError`, `isAuthRetryableFetchError`
- `node_modules/astro/dist/core/routing/handler.js:189` — logowanie nieprzechwyconych wyjątków przez Astro
- `node_modules/astro/dist/core/constants.js:29` — `REROUTABLE_STATUS_CODES = [404, 500]`
- `vitest.config.ts` — bez konfiguracji Astro; `include` do rozszerzenia o `tests/unit/**`

## Architecture Insights

- Konwencja „logika w `src/lib/services/`, wywołania Supabase w stronach i endpointach” jest przestrzegana: serwisy są czyste (schematy zod, mapowania `to*`, strażniki `is*Result`, mapy kodów błędów), a 26 wywołań `.from`/`.rpc` siedzi w `src/pages/**` (`context/map/evidence/3-structure.md`). Helper z efektem ubocznym (`console.error`) pasuje do `src/lib/` obok `supabase.ts`, nie do `services/`.
- Mapy kodów błędów mają jeden wzorzec: `X_ERROR_CODES as const` + `XErrorCode` + prywatne `X_ERROR_MESSAGES` + `isXErrorCode` + `xErrorMessage(code)` z fallbackiem `unknown` (`auth-errors.ts:1-50`, `account.ts:11-28`, `agent-profile.ts:87-105`, `offers.ts:192-231`, `invitations.ts:34-60,87-106`). Nowe kody (jeśli potrzebne) dopisuje się do tych list; w `?error=` idzie tylko kod (`context/archive/2026-10-27-role-based-signup/plan.md:32,228-233`).
- Zachowanie użytkownika i zapis w logach to dwie osobne osie. Zmiana może dodać logowanie bez zmiany przekierowań w większości miejsc. Semantykę zmieniają tylko D1, klasyfikacja w middleware, `no_profile` i statusy stron.

## Historical Context (from prior changes)

- `context/archive/2026-10-28-account-deletion/plan.md:140` — `'ok'` i `'not_found'` (konta już nie ma) → signOut + `/?deleted=1`. **Status: odwracane** — przy obecnym `locals.user` i profilu (sprawdzonym w `delete.ts:28`) `not_found` nie znaczy już „konta nie ma”.
- `context/archive/2026-10-28-account-deletion/plan.md:49` — błąd signOut nie zmienia wyniku. **Status: nadal ważne** (po udanym `ok`).
- `context/archive/2026-10-28-account-deletion/plan.md:284` — błąd odczytu profilu w delete → `/auth/signin?error=unavailable` (po impl-review F2). **Status: nadal ważne.**
- `context/archive/2026-10-27-role-based-signup/plan.md:67` — signOut przy braku profilu, by uniknąć pętli z przyszłym auto-redirectem zalogowanych. **Status: przesłanka nie zachodzi dziś** (brak auto-redirectu), ale decyzja o zmianie należy do planu.
- `context/archive/2026-10-27-role-based-signup/reviews/plan-review.md:25-32` (F1) — przejściowy błąd bazy nie może wylogowywać. **Status: nadal ważne; zmiana to zachowuje.**
- `context/foundation/lessons.md` — brak wpisów o kodach błędów, signOut ani idempotencji (jedyny trop `:21` dotyczy linków e-mail).

## Related Research

- `context/audits/observability/2026-10-29_auth-offer-ranking-invitation-account-deletion.md` — audyt, z którego pochodzi zakres.
- `context/map/repo-map.md` — strefy ryzyka access i auth.

## Open Questions

- Czy middleware przy awarii Supabase Auth ma przekierować na `/auth/signin?error=unavailable` (spójnie z błędem profilu), czy zwrócić 503 przez `context.rewrite`? Wybór dla planu; oba przechodzą smoke, jeśli „brak sesji” pozostaje 302 bez parametru.
- `no_profile`: zachować signOut (zgodnie z `plan.md:67`) i tylko dodać log, czy usunąć? Zachowanie z logiem nie odwraca żadnej decyzji i nie łamie testów.
- Czy Workers Logs indeksują pola z obiektu przekazanego do `console.error` — do potwierdzenia jednym sprawdzeniem na produkcji po wdrożeniu (repo tego nie rozstrzyga).
