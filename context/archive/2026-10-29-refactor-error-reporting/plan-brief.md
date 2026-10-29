# Wspólna obsługa i raportowanie błędów (refaktor M4) — Plan Brief

> Full plan: `context/changes/refactor-error-reporting/plan.md`
> Research: `context/changes/refactor-error-reporting/research.md`

## What & Why

Na produkcji prawie żadna awaria nie zostawia śladu. Kod ma 0 wywołań `console.*` i 30 bloków `catch {}` po stronie serwera, a każdy błąd Supabase zamienia w zwykłe przekierowanie albo stronę 200. Refaktor wprowadza jeden helper `reportError` i używa go wszędzie. Usuwa też trzy miejsca, w których awaria udaje normalny stan: usunięcie konta, które niczego nie usunęło, awarię logowania wyglądającą jak wylogowanie i strony błędu z kodem 200.

## Starting Point

Każdy z 10 endpointów ma własne domknięcie `fail(code)` bez logu. Middleware ignoruje błąd `getUser()`. Usunięcie konta traktuje wynik `not_found` jak sukces. Strony w stanie błędu odpowiadają 200 (audyt observability: 5 krytycznych ustaleń; mapa: strefy ryzyka access i auth).

## Desired End State

Każda awaria to jedna linia JSON w Workers Logs z `op`, `route`, `requestId` (cf-ray) i `userId`, bez danych osobowych. Użytkownik przy awarii logowania widzi „usługa chwilowo niedostępna”, a nie stronę logowania bez komunikatu. Nieudane usunięcie konta wraca z błędem zamiast fałszywego potwierdzenia. Strony w stanie błędu odpowiadają 503.

## Key Decisions Made

| Decision                                     | Choice                                                                      | Why (1 sentence)                                                                                    | Source            |
| -------------------------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ----------------- |
| Cel refaktoru M4                             | A: obsługa błędów (nie kontrakt SQL rankingu, nie podział modułów)          | Łączy dwie strefy ryzyka z mapy z krytycznymi ustaleniami audytu, bez migracji                      | Plan (użytkownik) |
| D1: `not_found` przy zalogowanym użytkowniku | Błąd + log, bez signOut, `?error=unknown`                                   | Profil sprawdzony wcześniej, więc `not_found` to anomalia; odwraca decyzję z planu account-deletion | Plan (użytkownik) |
| `no_profile` w middleware                    | Zostaje signOut, dochodzi log                                               | Nie odwraca decyzji z role-based-signup, a masowe wylogowania stają się widoczne                    | Plan (użytkownik) |
| Awaria Supabase Auth                         | `302 /auth/signin?error=unavailable` + log; publiczne strony jako anonim    | Spójne z obsługą błędu profilu, smoke bez zmian                                                     | Plan (użytkownik) |
| Co jest awarią                               | Tylko `isAuthRetryableFetchError` (0 / 5xx)                                 | 4xx (np. JWT usuniętego konta) muszą zostać „brakiem sesji” — inaczej pętla i czerwony smoke        | Research          |
| Gdzie helper                                 | Czysty `src/lib/report-error.ts`, bez `astro:*`                             | Testowalny w Vitest bez konfiguracji Astro                                                          | Research          |
| Prywatność                                   | Bez `details`, bez `message` AuthError, bez e-maili, `route` = routePattern | `details` i komunikaty auth mogą zawierać dane użytkownika                                          | Research          |

## Scope

**In scope:**

- helper + testy jednostkowe;
- middleware;
- auth endpointy i callback;
- 7 endpointów biznesowych z D1;
- 6 stron (503 + log).

**Out of scope:**

- tracker błędów i alerty;
- zmiany SQL (O4, O8);
- strona 500;
- guard `AppLayout`;
- fail-loud konfiguracji;
- beacon po stronie klienta;
- log sukcesu usunięcia konta.

## Architecture / Approach

`reportError(level, op, err, ctx, extra)` pobiera `route`, `requestId` i `userId` z kontekstu Astro (ten sam typ w endpointach, middleware i stronach). Serializuje błąd według kształtu (Postgrest, Auth, wyjątek, wynik RPC) i wypisuje jeden obiekt przez `console.error` / `console.warn`. Zachowanie użytkownika zmienia się tylko w D1, przy awarii Auth i w statusach stron. Pozostałe zmiany dodają log przed istniejącym `return`.

## Phases at a Glance

| Phase                  | What it delivers                                 | Key risk                                             |
| ---------------------- | ------------------------------------------------ | ---------------------------------------------------- |
| 1. Helper i testy      | `report-error.ts`, `isAuthOutage`, `tests/unit`  | Przeciek danych osobowych do logu (test prywatności) |
| 2. Bramka i auth       | Middleware odróżnia awarię; logi auth i callback | Zła klasyfikacja 4xx → czerwony smoke / pętla        |
| 3. Endpointy biznesowe | Log w każdej gałęzi błędu; D1                    | Regresja przekierowań (smoke, e2e)                   |
| 4. Strony              | 503 + log w stanach błędu                        | Pomylenie „missing” (404) z „error” (503)            |

**Prerequisites:** lokalny Supabase (`npx supabase start`), `.env` z `E2E_*`.
**Estimated effort:** ~1 sesja, 4 commity.

## Open Risks & Assumptions

- Nie wiadomo z repo, czy Workers Logs indeksują pola obiektu z `console.error`. Sprawdzamy to raz na produkcji (krok 4.8).
- Pages pokryte tylko smoke i E2E (nie da się importować stron w Vitest).

## Success Criteria (Summary)

- Każda awaria serwerowa zostawia jedną bezpieczną linię logu z `op` i `requestId`.
- Użytkownik nie dostaje fałszywego „usunięto” ani „wylogowano” przy awarii.
- Smoke, E2E, testy integracyjne i CI zielone bez zmian w ich oczekiwaniach.
