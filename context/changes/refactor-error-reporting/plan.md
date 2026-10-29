# Wspólna obsługa i raportowanie błędów (refaktor M4) — plan implementacji

## Overview

Wprowadzamy jeden czysty helper `reportError` i klasyfikator błędów Supabase Auth, a potem wpinamy je w każdą ścieżkę błędu po stronie serwera: middleware, 10 endpointów API, callback i 6 stron. Przy okazji zmieniamy trzy zachowania, które dziś ukrywają awarie:

- usunięcie konta z wynikiem `not_found` przestaje udawać sukces (D1);
- awaria Supabase Auth w middleware przestaje wyglądać jak wylogowanie (A1);
- strony w stanie błędu odpowiadają 503 zamiast 200 (O2).

Bez migracji i zmian w schemacie.

Źródła: `context/audits/observability/2026-10-29_auth-offer-ranking-invitation-account-deletion.md` (ustalenia A1–A10, O1–O7, D1–D6), `context/map/repo-map.md` (strefy ryzyka access i auth), `context/changes/refactor-error-reporting/research.md`.

## Current State Analysis

- W `src/` jest 0 wywołań `console.*` i 0 `catch (e)`.
- Po stronie serwera jest 30 `catch {}` bez bindingu: 20 w `src/pages/api/**` + `src/pages/auth/callback.ts`, 10 w stronach.
- Jest 29 gałęzi `if (error)` po wynikach Supabase; żadna nie loguje błędu (research §1).
- Każdy z 10 endpointów i callback ma lokalne domknięcie `fail(code)`, które przyjmuje tylko kod.
- Middleware (`src/middleware.ts:11-13`) nie odczytuje `error` z `getUser()`. Błąd profilu przekierowuje na `?error=unavailable` bez logu (`:35-37`), a brak profilu robi signOut i `?error=no_profile` bez logu (`:39-41`).
- `src/pages/api/account/delete.ts:41-55` traktuje `not_found` z RPC jak sukces, choć wcześniej (`:28`) już sprawdził, że profil istnieje.
- Strony w stanie `error` renderują 200 (`src/pages/owner/offers/[id].astro:96-98` ustawia tylko 404; listy i profil nie ustawiają statusu).

### Key Discoveries:

- `isAuthSessionMissingError` i `isAuthRetryableFetchError` są eksportowane z `@supabase/supabase-js` (`node_modules/@supabase/supabase-js/dist/index.d.mts:7` reeksportuje `@supabase/auth-js`; `errors.d.ts:94,214`). Awaria to `AuthRetryableFetchError` (status 0 albo 500–504 / 520–530).
- `AstroGlobal extends APIContext` (`node_modules/astro/dist/types/public/context.d.ts:14`), więc `routePattern`, `request` i `locals` są dostępne tak samo w endpointach, middleware i stronach (`:583`).
- `locals.runtime.*` rzuca wyjątek w tej wersji adaptera (`node_modules/@astrojs/cloudflare/dist/utils/cf-helpers.js:27-51`) — nie używać.
- Vitest nie ładuje konfiguracji Astro (`vitest.config.ts`). Moduł z importem `astro:*` albo aliasem `@/` nie zaimportuje się w teście.
- Smoke porównuje `location` dokładnie (`scripts/smoke.mjs:802-805`); 11 kroków oczekuje `302 /auth/signin` bez parametru (m.in. `:135,213,740,775`).
- `eslint.config.js:25` ustawia `"no-console": "warn"`.

## Desired End State

- Każda ścieżka błędu po stronie serwera wywołuje `reportError` przed przekierowaniem albo odpowiedzią. W Workers Logs pojawia się jedna linia na awarię z polami `level`, `op`, `route`, `requestId`, `userId` i bezpiecznym opisem błędu, bez e-maili, treści formularzy, ciasteczek i `details`.
- Oczekiwane błędy użytkownika (zła walidacja, złe hasło, istniejący e-mail) nie są logowane jako `error`.
- Middleware:
  - brak sesji i 4xx z `getUser()` → zachowanie bez zmian;
  - awaria (`AuthRetryableFetchError`) → log `error` i: strona bramkowana → `302 /auth/signin?error=unavailable`; strona publiczna → render jako anonimowa;
  - błąd odczytu profilu i `no_profile` → log `error`, przekierowania bez zmian.
- `POST /api/account/delete`: wynik `not_found` przy zalogowanym użytkowniku z profilem → log `error`, bez signOut, `302 /<rola>/account?error=unknown`. Wynik `ok` → bez zmian.
- Sześć stron w stanie błędu (w tym błąd RPC rankingu) odpowiada 503 i loguje błąd; wygląd się nie zmienia.
- Weryfikacja: `npm run test:unit` (nowe), `npm run lint`, `npx astro check`, smoke na lokalnym preview, `npm run test:e2e`, `npm run test:integration`; zielone CI.

## What We're NOT Doing

- Zewnętrznego trackera błędów (Sentry itp.) ani alertów — tylko logi w Workers Logs; konfiguracja alertów w panelu Cloudflare jest poza repo.
- Zmian w SQL i RPC (O4, O8: kontrakt rankingu, `inconsistent_state`) — to opcja B, odrzucona w decyzji M4.
- Zmiany semantyki `no_profile` (signOut zostaje, dochodzi log) i stron 503 z własnym widokiem dla awarii Auth (zostaje `?error=unavailable`).
- `src/pages/500.astro`, przeniesienia guardu `AppLayout.astro:17`, fail-loud konfiguracji (A8), beaconu błędów po stronie klienta (O10) — osobne, drobne zmiany na później.
- Logowania sukcesu usunięcia konta (D4) — poza zakresem; tylko błędy.
- Zmian w komunikatach i kodach `?error=` widocznych dla użytkownika (poza D1, który używa istniejącego kodu `unknown`).

## Implementation Approach

Najpierw czysty moduł z testami (faza 1), potem przepinanie wywołań od najbardziej krytycznej bramki (faza 2), przez endpointy (faza 3), do stron (faza 4). Każda faza to jeden commit z własną weryfikacją. Zachowanie użytkownika i zapis w logach to dwie osobne osie: większość zmian tylko dodaje log przed istniejącym `return`, a semantykę zmieniają jedynie D1, awaria w middleware i statusy stron.

## Critical Implementation Details

- **Czysty moduł:** `src/lib/report-error.ts` nie może importować `astro:*` ani używać aliasu `@/` w importach wartości (Vitest bez konfiguracji Astro). Typy z `astro` i `@supabase/supabase-js` są dozwolone, a guardy z `@supabase/supabase-js` jako import wartości działają w Node.
- **Klasyfikacja w middleware:** wyłącznie `isAuthRetryableFetchError(error)` oznacza awarię. `AuthSessionMissingError` i każde inne 4xx (np. JWT usuniętego użytkownika po nieudanym signOut) muszą zostać „brakiem sesji”, inaczej smoke (`:740`, `:775`) i strona główna anonimowo (`:134`) się wysypią albo powstanie pętla `unavailable`.
- **Prywatność:** helper serializuje błędy sam. Dla `PostgrestError` loguje `code` i `message` skrócony do 200 znaków, bez `details` i `hint`. Dla `AuthError` loguje `name`, `status` i `code`, bez `message`. Dla innych `Error` loguje `name`, skrócony `message` i pierwsze 5 linii stacku. Nigdy nie loguje e-maila, body, ciasteczek ani adresu IP; `route` to `routePattern`, a nie `url.pathname`.
- **Podwójny log przy 500:** Astro uruchamia middleware ponownie przy renderze strony 500 (`node_modules/astro/dist/core/errors/default-handler.js:80`), więc jedna awaria może dać dwie linie z tym samym `requestId`; to oczekiwane, nie dwa incydenty.
- **Korelacja:** `requestId` = nagłówek `cf-ray`, a gdy go nie ma (lokalnie, smoke) — `crypto.randomUUID()`.

## Phase 1: Helper i testy jednostkowe

### Overview

Czysty moduł raportowania i klasyfikacji błędów, przetestowany bez Supabase i bez Astro.

### Changes Required:

#### 1. Helper raportowania

**File**: `src/lib/report-error.ts` (nowy)

**Intent**: Jedno miejsce, które zamienia dowolny błąd w jedną bezpieczną linię logu, oraz jedno miejsce z regułą „awaria czy brak sesji”.

**Contract**:

- `requestContext(ctx)` przyjmuje strukturalnie `{ request: Request; routePattern: string; locals: { user?: { id: string } | null } }` i zwraca `{ route, requestId, userId }`, gdzie `requestId` pochodzi z `cf-ray` z fallbackiem `crypto.randomUUID()`.
- `reportError(level: "error" | "warn", op: string, err: unknown, ctx, extra?: Record<string, string | number | boolean | null>)` wywołuje `console.error` (dla `error`) albo `console.warn` (dla `warn`) z jednym obiektem `{ level, op, route, requestId, userId, ...extra, error: describeError(err) }`.
- `describeError(err)` zwraca:
  - `{ kind: "postgrest", code, message }` dla PostgrestError;
  - `{ kind: "auth", name, status, code }` dla AuthError;
  - `{ kind: "exception", name, message, stack }` dla innych `Error`;
  - `{ kind: "result", value }` dla wartości z niespełnionym kontraktem RPC (string/null);
  - `{ kind: "none" }` dla `undefined`.
- `isAuthOutage(error: unknown): boolean` zwraca true tylko dla `isAuthRetryableFetchError`.
- Moduł to jedyne miejsce w `src/` z `console.*`, z `// eslint-disable-next-line no-console` przy wywołaniach.

#### 2. Testy jednostkowe

**File**: `tests/unit/report-error.test.ts` (nowy), `vitest.config.ts`, `package.json`

**Intent**: Dowód, że helper nie przepuszcza danych osobowych, rozpoznaje kształty błędów i poprawnie klasyfikuje awarie.

**Contract**:

- `include` w Vitest obejmuje dodatkowo `tests/unit/**/*.test.ts`; nowy skrypt `test:unit` = `vitest run tests/unit`.
- Przypadki testowe:
  - PostgrestError z `details` zawierającym e-mail → w logu brak `details` i brak e-maila;
  - AuthError z `message` → w logu brak `message`, są `name`, `status`, `code`;
  - zwykły `Error` → skrócony stack;
  - wartość kontraktu (`"weird"`) → `kind: "result"`;
  - `cf-ray` obecny i nieobecny;
  - `userId` z `locals.user`, a przy braku użytkownika `null`;
  - `level: "warn"` → `console.warn`;
  - `isAuthOutage`: `AuthRetryableFetchError` (status 0 i 503) → true; `AuthSessionMissingError`, `AuthApiError` 403, `null` → false.
- Spy przez `vi.spyOn(console, "error").mockImplementation(() => {})`.

### Success Criteria:

#### Automated Verification:

- Testy jednostkowe przechodzą: `npm run test:unit`
- Lint i typy: `npm run lint && npx astro check`
- Celowe uszkodzenie: dodanie `details` do serializacji PostgrestError czerwieni test prywatności (potem cofnięte)

#### Manual Verification:

- Przegląd `src/lib/report-error.ts`: żadne pole nie może zawierać e-maila, treści formularza ani tokenu

**Implementation Note**: commit `refactor(refactor-error-reporting): report-error helper (p1)` razem z `plan.md`.

---

## Phase 2: Bramka i auth

### Overview

Middleware odróżnia awarię od braku sesji i loguje każdą gałąź błędu; endpointy auth i callback logują nieoczekiwane błędy.

### Changes Required:

#### 1. Middleware

**File**: `src/middleware.ts`

**Intent**: Awaria Supabase Auth i błędy profilu stają się widoczne; użytkownik przy awarii dostaje komunikat zamiast cichego „wylogowania”.

**Contract**:

- `getUser()` → odczyt `error`. Gdy `isAuthOutage(error)`: `reportError("error", "middleware.getUser", …)`; strona bramkowana → `302 /auth/signin?error=unavailable`, strona publiczna → `next()` z `locals.user = null`. Inne błędy → bez logu (sesja nieważna = anonim), zachowanie bez zmian.
- Błąd odczytu profilu (`:35`) → `reportError("error", "middleware.profile", …)` przed obecnym redirectem.
- Brak profilu (`:39`) → `reportError("error", "middleware.no_profile", …)` z `userId`; wynik `signOut()` sprawdzony i przy błędzie `reportError("warn", "middleware.signOut", …)`; redirect `?error=no_profile` bez zmian.

#### 2. Endpointy auth i callback

**File**: `src/pages/api/auth/signin.ts`, `src/pages/api/auth/signup.ts`, `src/pages/api/auth/signout.ts`, `src/pages/auth/callback.ts`

**Intent**: Nieoczekiwane błędy (awaria, nieznany kod, wyjątek) trafiają do logu; zwykłe błędy użytkownika nie zaśmiecają logów.

**Contract**:

- signin i signup:
  - `catch (e)` → `reportError("error", "auth.signin" | "auth.signup", e, …)`;
  - błąd Supabase → log `error`, gdy `toAuthErrorCode` daje `unknown` albo `unavailable`, albo gdy `status >= 500`; log `warn` dla `rate_limited` (A7); brak logu dla pozostałych kodów użytkownika.
  - Kody `?error=` bez zmian.
- signout: wynik `signOut()` przy błędzie → `reportError("warn", "auth.signout", …)`; redirect `/` bez zmian.
- callback:
  - błąd `exchangeCodeForSession` → `reportError("warn", "auth.callback", error, …)` (wygaśnięcie linku bywa normalne, więc warn);
  - parametry `error_code`/`error_description` z URL-a → log `warn` z samym `error_code`;
  - `catch (e)` → `error`;
  - redirect `link_expired` bez zmian.
- Brak klienta (`createClient` → null) w tych plikach → `reportError("error", "<op>.config", …)`.

### Success Criteria:

#### Automated Verification:

- Lint i typy: `npm run lint && npx astro check`
- Testy jednostkowe: `npm run test:unit`
- Smoke na lokalnym preview przechodzi bez zmian w oczekiwaniach: `npm run build && ASTRO_PREVIEW_BACKGROUND=1 npx astro preview --port 4323` w tle, potem `BASE_URL=http://localhost:4323 npm run smoke`; po teście zatrzymać preview i potwierdzić wolny port (`lsof -nP -iTCP:4323 -sTCP:LISTEN` nic nie wypisuje; osierocony demon: `npx astro preview stop`)
- E2E: `npm run test:e2e`

#### Manual Verification:

- Symulowana awaria Auth lokalnie (`npx supabase stop` przy działającym preview): wejście na `/owner` daje `302 /auth/signin?error=unavailable`, strona główna 200, a w konsoli preview jest linia JSON z `op: "middleware.getUser"` i bez e-maila; potem `npx supabase start`

**Implementation Note**: commit `refactor(refactor-error-reporting): middleware and auth (p2)` razem z `plan.md`.

---

## Phase 3: Endpointy biznesowe

### Overview

Wszystkie endpointy ofert, zaproszeń, profilu agenta i usunięcia konta logują każdą gałąź błędu; D1 przestaje udawać sukces.

### Changes Required:

#### 1. Logowanie w endpointach

**File**: `src/pages/api/owner/offers.ts`, `src/pages/api/owner/offers/update.ts`, `src/pages/api/owner/offers/delete.ts`, `src/pages/api/owner/invitations.ts`, `src/pages/api/agent/invitations.ts`, `src/pages/api/agent/profile.ts`, `src/pages/api/account/delete.ts`

**Intent**: Każda awaria zostawia linię logu z identyfikatorami encji; odpowiedzi dla użytkownika bez zmian (poza D1).

**Contract**:

- Każdy `catch {}` → `catch (e)` + `reportError("error", "<op>", e, …)` przed obecnym `fail`.
- `catch` przy `formData()` → bez logu (zły input klienta), zachowanie bez zmian.
- Każda gałąź `if (error)` i brak klienta → log `error`.
- Niespełniony kontrakt RPC (`!isInviteResult`, `!isRespondResult`, `!isDeleteAccountResult`) i niemożliwe `invalid_response` → log `error` z `describeError(data)`.
- `not_found` i 0 wierszy po tym, jak użytkownik przeszedł weryfikację roli (`owner/invitations.ts:56`, `agent/invitations.ts:61`, `owner/offers/delete.ts:53`, `owner/offers/update.ts:87`) → log `warn`.
- `extra` zawiera `offerId` / `agentId`, gdy są w zasięgu, i nazwę RPC.
- Nazwy `op`: `owner.offers.create`, `owner.offers.update`, `owner.offers.delete`, `owner.invite`, `agent.respond`, `agent.profile.save`, `account.delete`.

#### 2. D1: usunięcie konta

**File**: `src/pages/api/account/delete.ts`, `src/lib/services/account.ts` (bez zmian w kodach)

**Intent**: `not_found` przy zalogowanym użytkowniku z profilem oznacza, że niczego nie usunięto — użytkownik nie może dostać potwierdzenia usunięcia.

**Contract**:

- Wynik `"not_found"` → `reportError("error", "account.delete", data, …)` i `fail("unknown")` (redirect `/<rola>/account?error=unknown`), bez signOut.
- Wynik `"ok"` → bez zmian; wynik `signOut` po `ok` → przy błędzie log `warn` (`D6`).
- Komentarz przy `:46-48` zaktualizowany: odwołanie do tego planu i decyzji użytkownika z 2026-10-29.

### Success Criteria:

#### Automated Verification:

- Lint i typy: `npm run lint && npx astro check`
- Testy jednostkowe i integracyjne: `npm run test:unit && npm run test:integration`
- Smoke na lokalnym preview: `npm run build && ASTRO_PREVIEW_BACKGROUND=1 npx astro preview --port 4323` w tle, potem `BASE_URL=http://localhost:4323 npm run smoke`; po teście zatrzymać preview i potwierdzić wolny port (`lsof -nP -iTCP:4323 -sTCP:LISTEN` nic nie wypisuje; osierocony demon: `npx astro preview stop`)
- E2E: `npm run test:e2e`
- Brak `catch {}` bez bindingu w `src/pages/api/**` i `src/pages/auth/**` poza `formData()`: `grep -rn "catch {" src/pages/api src/pages/auth` zwraca tylko wiersze formData

#### Manual Verification:

- D1 sprawdzone lokalnie: zalogowany właściciel, tymczasowo podmieniona funkcja `delete_own_account` (psql, zwraca `'not_found'`, potem przywrócona z `pg_get_functiondef`) → `302 /owner/account?error=unknown`, konto nadal działa, w konsoli preview linia `op: "account.delete"`

**Implementation Note**: commit `refactor(refactor-error-reporting): business endpoints and D1 (p3)` razem z `plan.md`.

---

## Phase 4: Strony

### Overview

Strony w stanie błędu odpowiadają 503 i logują przyczynę, w tym błąd RPC rankingu i połknięte wyjątki `oneOf`.

### Changes Required:

#### 1. Statusy i logi stron

**File**: `src/pages/owner/offers/[id].astro`, `src/pages/agent/offers/[id].astro`, `src/pages/owner/offers/[id]/edit.astro`, `src/pages/owner/index.astro`, `src/pages/agent/index.astro`, `src/pages/agent/profile.astro`

**Intent**: Awaria bazy przestaje wyglądać w metrykach jak zdrowy ruch; widok dla użytkownika bez zmian.

**Contract**:

- Każdy `catch {}` → `catch (e)` + `reportError("error", "<page op>", e, Astro, { offerId })`.
- Każda gałąź `if (error)` → log `error`.
- Gdy strona kończy w stanie `error` / `null` z powodu błędu (nie „missing”), ustawia `Astro.response.status = 503`.
- Błąd RPC rankingu (`owner/offers/[id].astro:58-59`) → log `error` (`op: "owner.offer.rank"`) i 503.
- Błąd odczytu zaproszenia na stronie agenta (`agent/offers/[id].astro:50-53`) → log `error` i 503 (O3).
- Odczyty, które tylko gubią datę (`owner/offers/[id].astro:72-73,85-87`) → log `warn`, status bez zmian.
- Nazwy `op`: `owner.offer.read`, `owner.offer.rank`, `owner.offer.invitation`, `owner.offers.list`, `owner.offer.edit.read`, `agent.offer.read`, `agent.offer.invitation`, `agent.invitations.list`, `agent.profile.read`.

### Success Criteria:

#### Automated Verification:

- Lint i typy: `npm run lint && npx astro check`
- Testy: `npm run test:unit && npm run test:integration`
- Smoke na lokalnym preview: `npm run build && ASTRO_PREVIEW_BACKGROUND=1 npx astro preview --port 4323` w tle, potem `BASE_URL=http://localhost:4323 npm run smoke`; po teście zatrzymać preview i potwierdzić wolny port (`lsof -nP -iTCP:4323 -sTCP:LISTEN` nic nie wypisuje; osierocony demon: `npx astro preview stop`)
- E2E: `npm run test:e2e`
- Brak `catch {}` bez bindingu w `src/pages/**` poza `formData()`: `grep -rn "catch {" src/pages`
- CI na PR zielone (ci + smoke)

#### Manual Verification:

- Symulowana awaria bazy lokalnie (`docker pause supabase_db_10x-astro-starter` przy zalogowanym właścicielu): `/owner` i `/owner/offers/<id>` odpowiadają 503 z dotychczasowym komunikatem „chwilowo niedostępne”, w konsoli preview są linie JSON z `op`; potem `docker unpause`
- Po wdrożeniu: w Workers Logs na produkcji widać linię z polami `op`, `route`, `requestId` (sprawdzenie, że Cloudflare indeksuje pola obiektu)

**Implementation Note**: commit `refactor(refactor-error-reporting): pages 503 and logging (p4)` razem z `plan.md`.

---

## Testing Strategy

### Unit Tests:

- `tests/unit/report-error.test.ts`: serializacja trzech kształtów błędów, prywatność (brak `details`, brak `message` AuthError, brak e-maila), `requestId` z `cf-ray` i bez, poziomy, `isAuthOutage`.

### Integration Tests:

- Istniejące `tests/integration/**` bez zmian (nie dotykamy SQL); `tests/hooks/**` bez zmian.
- Smoke i E2E potwierdzają, że ścieżki szczęśliwe i przekierowania (11 kroków `302 /auth/signin`, `/?deleted=1`, 404 izolacji) się nie zmieniły.

### Manual Testing Steps:

1. Awaria Auth: `npx supabase stop` przy działającym preview → `/owner` daje `?error=unavailable`, `/` daje 200, linia logu `middleware.getUser`.
2. D1: podmieniona funkcja RPC zwraca `not_found` → powrót na `/owner/account?error=unknown`, konto działa, log `account.delete`.
3. Awaria bazy: `docker pause` → 503 na stronach właściciela, logi z `op`.
4. Produkcja: jedna linia w Workers Logs z indeksowanymi polami.

## Performance Considerations

Jedno `console.error` na awarię; ścieżki szczęśliwe bez zmian. `crypto.randomUUID()` tylko przy braku `cf-ray`.

## Migration Notes

Brak migracji i zmian w schemacie; wycofanie = revert commitów (Worker przez `wrangler rollback`).

## References

- Research: `context/changes/refactor-error-reporting/research.md`
- Audyt: `context/audits/observability/2026-10-29_auth-offer-ranking-invitation-account-deletion.md`
- Mapa: `context/map/repo-map.md`
- Decyzje odwracane: `context/archive/2026-10-28-account-deletion/plan.md:140` (D1), zachowane: `context/archive/2026-10-27-role-based-signup/plan.md:67` (signOut przy `no_profile`), `context/archive/2026-10-27-role-based-signup/reviews/plan-review.md:25-32` (błąd bazy bez signOut)
- Wzorzec map kodów błędów: `src/lib/services/auth-errors.ts:1-50`, `src/lib/services/account.ts:11-28`

## Addendum — odstępstwa z implementacji

- **Faza 3:** w `catch` endpointów zaproszeń (`api/owner/invitations.ts`, `api/agent/invitations.ts`) log nie ma `offerId`/`agentId`, bo są zadeklarowane wewnątrz `try`. Linia zawiera `rpc`, `route`, `requestId` i `userId`, co wystarcza do korelacji. W `update.ts` i `delete.ts` `offerId` jest w zasięgu wszędzie.
- **Faza 3:** pozostałe `catch {}` w API (8) obejmują wyłącznie `formData()`, także dwa, w których `formData()` jest wywoływane wewnątrz parsera (`api/owner/offers.ts:39`, `api/agent/profile.ts:38`).
- **Faza 4:** oba odczyty dat zaproszeń na stronie oferty właściciela logują `warn` pod wspólnym `op: owner.offer.invitation`, tak jak nazwał je plan.
- **Krok 2.5:** awarię Auth wywołano zatrzymaniem kontenera `supabase_kong_*` (a nie `npx supabase stop`). Szybsze i nie rusza bazy; kontener wystartowany z powrotem, Auth `health` 200.
- **Krok 3.6:** `delete_own_account` podmieniona przez psql na wersję zwracającą `not_found` (definicja z `pg_get_functiondef`), po teście przywrócona; `diff` z oryginałem pusty.
- **Nazwy `op`:** poza nazwami bazowymi z planu kod używa przyrostków gałęzi: `.config` (brak klienta Supabase), `.role` (odczyt roli), `.read`, `.not_found` (0 wierszy / `not_found` po weryfikacji roli), `.signOut`; konwencja opisana w `src/lib/report-error.ts`. `agent.profile.save` loguje 0 zaktualizowanych wierszy jako `error` (anomalia RLS, ta sama gałąź co błąd zapisu).
- **Impl-review (F1–F7):** poprawki w osobnym PR — stack bez linii 1, `authErrorLogLevel` w `services/auth-errors.ts`, `extra` przed polami kontekstu, testy (`tests/unit`: 24).
- **Krok 4.7:** zamiast `docker pause` bazy (zatrzymałby też Auth i odczyt profilu w middleware, więc żądanie kończyłoby się `?error=unavailable` przed renderem strony) tabela `offers` została chwilowo przemianowana z `notify pgrst, 'reload schema'`. Wynik: `/owner` i `/owner/offers/<id>` → 503 z niezmienionym widokiem, logi `owner.offers.list` i `owner.offer.read`; tabela przywrócona (`to_regclass`), strony znów 200.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Helper i testy jednostkowe

#### Automated

- [x] 1.1 Testy jednostkowe przechodzą — d273e5a
- [x] 1.2 Lint i typy — d273e5a
- [x] 1.3 Celowe uszkodzenie czerwieni test prywatności — d273e5a

#### Manual

- [x] 1.4 Przegląd report-error.ts pod kątem danych osobowych — d273e5a

### Phase 2: Bramka i auth

#### Automated

- [x] 2.1 Lint i typy — e51c113
- [x] 2.2 Testy jednostkowe — e51c113
- [x] 2.3 Smoke na lokalnym preview bez zmian w oczekiwaniach — e51c113
- [x] 2.4 E2E — e51c113

#### Manual

- [x] 2.5 Symulowana awaria Auth daje ?error=unavailable i log — e51c113

### Phase 3: Endpointy biznesowe

#### Automated

- [x] 3.1 Lint i typy — 1af986e
- [x] 3.2 Testy jednostkowe i integracyjne — 1af986e
- [x] 3.3 Smoke na lokalnym preview — 1af986e
- [x] 3.4 E2E — 1af986e
- [x] 3.5 Brak catch {} bez bindingu w API i auth poza formData — 1af986e

#### Manual

- [x] 3.6 D1 sprawdzone lokalnie z podmienioną funkcją RPC — 1af986e

### Phase 4: Strony

#### Automated

- [x] 4.1 Lint i typy — 0fdd733
- [x] 4.2 Testy — 0fdd733
- [x] 4.3 Smoke na lokalnym preview — 0fdd733
- [x] 4.4 E2E — 0fdd733
- [x] 4.5 Brak catch {} bez bindingu w src/pages poza formData — 0fdd733
- [x] 4.6 CI na PR zielone — 0fdd733

#### Manual

- [x] 4.7 Symulowana awaria bazy daje 503 i logi — 0fdd733
- [ ] 4.8 Linia logu z indeksowanymi polami w Workers Logs na produkcji
