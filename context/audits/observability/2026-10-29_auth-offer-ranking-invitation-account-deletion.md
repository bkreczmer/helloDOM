---
type: observability-audit
date: 2026-10-29 16:23
mode: audit
commit: ceeda1c
branch: main
dirty_tree: false
areas: [auth, offer-ranking-invitation, account-deletion]
area_source: foundation
runtime_proof: not-run
error_tracker: none (Cloudflare Workers Logs via wrangler.jsonc observability.enabled)
previous_report: null
findings: { critical: 5, high: 9, medium: 12, low: 5 }
---

# Audyt observability — auth, oferta → ranking → zaproszenie, usunięcie konta (2026-10-29)

## 1. TL;DR

- **Kod nie loguje niczego.** W `src/` jest 0 wywołań `console.*`, 0 `catch (e)` i 32 `catch {}` bez bindingu. Workers Logs widzą tylko to, co Astro złapie samo, a prawie każda awaria jest złapana wcześniej przez kod aplikacji.
- **Każda awaria API to zwykłe 302.** 10 endpointów ma własne domknięcie `fail(code)`, które zamienia błąd Supabase, wyjątek i złamany kontrakt RPC na `?error=unknown|unavailable`. Szacunkowo ~100% z ~38 gałęzi błędów w `src/pages/api/**` nie zostawia w logach nic poza 302.
- **Strony degradują się do 200.** Błąd odczytu oferty, rankingu (rdzeń produktu) albo list renderuje się jako „chwilowo niedostępne” ze statusem 200. Pełna awaria Supabase wygląda w metrykach jak zdrowy ruch.
- **Awaria wygląda jak stan użytkownika.** Błąd `getUser()` jest ignorowany: awaria Supabase Auth to „wylogowany”. Brak profilu (np. po złej migracji RLS) wylogowuje użytkownika. RPC zwraca „bezpieczne” kody (`not_found`, 0 wierszy), które kod traktuje jak wynik biznesowy.
- **Najpoważniejsza pojedyncza konsekwencja:** `POST /api/account/delete` traktuje `not_found` z `delete_own_account` jak sukces. Jeśli JWT nie dotrze do PostgREST (`auth.uid()` = null), konto **nie** zostaje usunięte, a użytkownik widzi „Konto zostało usunięte razem z Twoimi danymi”. Nikt się o tym nie dowie (wymóg PRD o usunięciu danych).

## 2. Model przechwytywania

- **Runtime:** Astro 7 SSR (`output: "server"`), `@astrojs/cloudflare` na Cloudflare Workers (`astro.config.mjs`, `wrangler.jsonc`).
- **Logi:** `wrangler.jsonc` → `"observability": { "enabled": true }` (Workers Logs: `console.*` i wynik wywołania).
- **Tracker błędów:** brak (żadnego SDK w `package.json` ani `src/`).
- **Granica przechwytywania:** tylko globalny catch Astro. Adapter woła `app.render()` bez własnego try (`node_modules/@astrojs/cloudflare/dist/utils/handler.js:79`). Astro łapie wyjątek, loguje `err.stack` przez `logger.error` → `console.error` (`node_modules/astro/dist/core/routing/handler.js:188-195`) i zwraca domyślne 500. Wyjątek nie dochodzi do runtime'u, więc wynik wywołania to „ok”, a w logach jest tylko linia tekstu.
- **Poza granicą:**
  - wszystko złapane w kodzie aplikacji (32 `catch {}`, 29 destrukturyzacji `{ error }` bez logu);
  - błędy komponentów potomnych po wysłaniu nagłówków 200 w strumieniu SSR (`astro/dist/runtime/server/render/astro/render.js:73-80`), np. guard `src/layouts/AppLayout.astro:17`.
- **Logger, scrubbing, sampling:** brak w kodzie.
- **Tożsamość wdrożenia:**
  - brak tagu wersji i środowiska w kodzie;
  - jedna instancja Workera (`hellodom`), deploy tylko z `main`, preview niewdrażane.
- **Praca w tle:** brak (`ctx.waitUntil`, cron i kolejki nieużywane).
- **Klient:** wyspy React bez `fetch`. Formularze są natywne, więc błąd hydratacji zostaje w konsoli przeglądarki. Brak `window.onerror`.

**Założenia (poza repo, niepotwierdzone):**

- Workers Logs zbierają logi na produkcji (retencja, sampling i alerty nieznane).
- Nie wiadomo, czy Workers Logs zapisują nagłówek `Location` odpowiedzi.
- Nie wiadomo, czy workerd loguje przerwany strumień odpowiedzi.
- Nie ma reguł alertów na `console.error` ani na status ≥500 (nieznane).

## 3. Co trafia do logów (statycznie, bez sond runtime)

| Kształt awarii                                            | Odpowiedź                           | Workers Logs                                         | Werdykt   |
| --------------------------------------------------------- | ----------------------------------- | ---------------------------------------------------- | --------- |
| Wyjątek w frontmatterze strony, poza try                  | 500 (domyślna strona Astro)         | `console.error` ze stackiem jako tekst; outcome „ok” | słabo     |
| Wyjątek w komponencie potomnym (np. `AppLayout.astro:17`) | 200 z uciętym body                  | prawdopodobnie nic (niezweryfikowane)                | pominięte |
| Supabase `{ error }` w endpoincie API                     | 302 `?error=unknown/unavailable`    | nic                                                  | pominięte |
| Wyjątek w `try` endpointu API                             | 302 `?error=unknown`                | nic                                                  | pominięte |
| Błąd RPC rankingu na stronie oferty                       | 200 „Ranking chwilowo niedostępny”  | nic                                                  | pominięte |
| Błąd `getUser()` w middleware                             | 302 `/auth/signin` (jak wylogowany) | nic                                                  | pominięte |
| Błąd odczytu profilu w middleware                         | 302 `?error=unavailable`            | nic                                                  | pominięte |
| Brak `SUPABASE_URL` / `SUPABASE_KEY`                      | 302 / pusta strona + baner UI       | nic                                                  | pominięte |
| `delete_own_account` → `not_found`                        | 302 `/?deleted=1` („usunięto”)      | nic                                                  | pominięte |

## 4. Systemowe przyczyny źródłowe

1. **Mapowanie błędu na redirect bez punktu logowania.** Każdy endpoint definiuje własne `const fail = (code) => context.redirect(...?error=code)`, np. `src/pages/api/owner/offers.ts:6`, `src/pages/api/agent/invitations.ts:16-17`, `src/pages/auth/callback.ts:7`. Wspólnego helpera w `src/lib/` nie ma, więc nie ma jednego miejsca, w którym błąd mógłby zostać zapisany. Lokalnie to rozsądne: użytkownik nie widzi surowego błędu. Problem w tym, że reguła „nie pokazuj błędu” objęła też logi. Wyjaśnia ustalenia A3, A4, A6, O1, O5, D2, D3, D5.
2. **`catch {}` bez bindingu i zwracane `{ error }` zatrzymują błąd przed jedyną granicą.** Supabase zwraca błędy zamiast je rzucać. 29 miejsc sprawdza `error` i go porzuca, a 32 `catch {}` nie mają nawet zmiennej, którą dałoby się zalogować. Globalny catch Astro (`astro/dist/core/routing/handler.js:188`) widzi więc tylko wyjątki spoza try. Łapane są też celowe wyjątki `oneOf()` (`src/lib/services/offers.ts:101-104`) przeznaczone do wykrywania dryfu schematu. Wyjaśnia A1, A3, O1, O2, O6, O7, P1.
3. **Stan degradacji renderowany jako 200 albo jako normalny stan użytkownika.** `state = "error"` i `agents = null` nie ustawiają statusu (`src/pages/owner/offers/[id].astro:43-61`, status tylko dla 404 w `:97`). Middleware nie odróżnia awarii od braku sesji: `getUser()` bez odczytu `error` (`src/middleware.ts:11-14`), a `data === null` profilu powoduje wylogowanie (`:39-41`). Wyjaśnia A1, A2, O2, O3, O7, P2.
4. **Kontrakt „bezpiecznych” kodów wyniku miesza anomalie z wynikiem biznesowym.**
   - `delete_own_account` zwraca `not_found` także przy `auth.uid()` null (`supabase/migrations/20261028220000_account_deletion.sql:64-71`), a endpoint uznaje to za sukces (`src/pages/api/account/delete.ts:48`).
   - `rank_agents_for_offer` zwraca 0 wierszy przy cudzej ofercie albo braku sesji (`20261028200000_invitation_response.sql:44-45`).
   - `invite_agent` zamienia `unique_violation` na `offer_locked` (`20261028180000_*:100-104`).
   - Wyjaśnia D1, O4, O8, O9.
5. **Brak kontekstu korelacji.** Nigdzie nie ma id użytkownika, id oferty, kodu Postgres/PostgREST, statusu HTTP Supabase ani `cf-ray`. Nawet po dodaniu logów nie byłoby jak powiązać zgłoszenia z incydentem. Wyjaśnia A9, D4, P4.

## 5. Ustalenia według obszarów

### Auth (rejestracja, logowanie, wylogowanie, callback, middleware)

| #   | Lokalizacja                                                                   | Kategoria          | Waga     | Co się dzieje na produkcji                                                                                                                                                                               | Kierunek poprawki                                                                                                     |
| --- | ----------------------------------------------------------------------------- | ------------------ | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| A1  | `src/middleware.ts:11-14`                                                     | missing-throw      | critical | Awaria lub timeout Supabase Auth → `user` = null. Strony bramkowane robią 302 na `/auth/signin` bez kodu błędu (`:26`). Użytkownik „wylogowany”, w logach zwykłe 302.                                    | Odczytać `error`; poza „brak sesji” zalogować i zwrócić 503 / `?error=unavailable`.                                   |
| A2  | `src/middleware.ts:39-41`                                                     | flattened-response | critical | Regresja polityki SELECT na `profiles` → `data === null` bez błędu → `signOut()` i `?error=no_profile` u każdego użytkownika. Wygląda jak problem pojedynczego konta.                                    | Zalogować `no_profile` z `user.id` jako naruszenie niezmiennika (trigger gwarantuje profil); bez cichego wylogowania. |
| A3  | `src/middleware.ts:35-37`                                                     | swallowed          | high     | Błąd odczytu profilu → 302 `?error=unavailable`. Kod, wiadomość i hint PostgREST porzucone.                                                                                                              | Zalogować błąd z kodem i ścieżką przed redirectem.                                                                    |
| A4  | `src/pages/api/auth/signup.ts:36-38`, `src/lib/services/auth-errors.ts:40-44` | identity-lost      | high     | Awaria SMTP, błąd triggera `handle_new_user` („Database error saving new user”) i błąd sieci → `unknown`. Status nieczytany; awaria wygląda jak błąd użytkownika.                                        | Logować każde nieznane `code`, `status >= 500` i brak `code`; mapować je na `unavailable`.                            |
| A5  | `src/pages/auth/callback.ts:9-25`                                             | flattened-response | high     | Wygasły link, brak weryfikatora PKCE (inna przeglądarka), awaria Supabase i parametry `error_code`/`error_description` → zawsze `link_expired`. Jedyna droga do nowego konta jest nie do zdiagnozowania. | Zalogować `error.code`/`status` i parametry błędu; `link_expired` tylko dla kodów wygaśnięcia.                        |
| A6  | `src/pages/api/auth/signin.ts:29-31`, `signup.ts:40-42`                       | swallowed          | high     | `catch {}` zabiera wyjątki (np. zły `SITE_URL` w `new URL`) jedynej granicy, która by je zalogowała.                                                                                                     | Bind `catch (e)`, zalogować ze stackiem, potem redirect.                                                              |
| A7  | `src/lib/services/auth-errors.ts:34-37`                                       | flattened-response | medium   | 429 `over_email_send_rate_limit` (~2 maile/h) → 302 bez logu. Rejestracje stają na potwierdzeniu, nikt nie widzi częstotliwości.                                                                         | Zliczana linia logu dla `rate_limited`.                                                                               |
| A8  | `src/lib/supabase.ts:7-9`, `astro.config.mjs:19-20`                           | config             | medium   | Brak sekretu na produkcji (`optional: true`) → aplikacja „wylogowana” wszędzie, endpointy `unavailable`; tylko baner w UI.                                                                               | Na produkcji rzucić albo zalogować raz przy starcie.                                                                  |
| A9  | wszystkie endpointy auth + middleware                                         | missing-context    | medium   | Brak ścieżki, id użytkownika, `cf-ray` i statusu Supabase w czymkolwiek.                                                                                                                                 | Wspólny helper logowania (zob. §6, krok 1).                                                                           |
| A10 | `src/pages/api/auth/signout.ts:7`, `src/middleware.ts:40`                     | missing-throw      | low      | Wynik `signOut()` ignorowany; nieudane unieważnienie sesji wygląda jak sukces.                                                                                                                           | Zalogować `error`.                                                                                                    |

### Oferta → ranking → zaproszenie → odpowiedź agenta

| #   | Lokalizacja                                                                                                                                                                                                                                                                                                        | Kategoria                      | Waga     | Co się dzieje na produkcji                                                                                                                                                                  | Kierunek poprawki                                                                            |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| O1  | `catch {}` w `src/pages/api/owner/invitations.ts:63`, `owner/offers.ts:63`, `owner/offers/update.ts:91`, `owner/offers/delete.ts:57`, `agent/invitations.ts:70`, `agent/profile.ts:60` oraz gałęzie `if (error) fail(...)` (np. `owner/offers.ts:58`, `agent/invitations.ts:54`, sprawdzenie roli we wszystkich 6) | swallowed / flattened-response | critical | Błąd PostgREST, naruszenie CHECK, wyjątek sieci, wygasły JWT i złamany kontrakt RPC → ten sam 302 `?error=unknown`. Brak id oferty, użytkownika i kodu Postgres.                            | `reportError(context, op, err, { offerId, pgCode })` w każdym `catch (e)` i gałęzi `error`.  |
| O2  | `src/pages/owner/offers/[id].astro:43-61` (render `:196`), `agent/offers/[id].astro:31-39`, `owner/offers/[id]/edit.astro:37-45`, `owner/index.astro:30-35`, `agent/index.astro:28-33`, `agent/profile.astro:28-33`                                                                                                | flattened-response             | critical | Błąd odczytu oferty lub RPC rankingu → „chwilowo niedostępne” / „Ranking chwilowo niedostępny” ze statusem 200. Rdzeń produktu może nie działać u wszystkich właścicieli bez śladu.         | W stanie `error` ustawić `Astro.response.status = 503` i zalogować błąd.                     |
| O3  | `src/pages/agent/offers/[id].astro:43-55` (render `:94-101`)                                                                                                                                                                                                                                                       | swallowed                      | high     | Błąd odczytu zaproszenia → strona mówi „Zaproszono Cię…”, ale bez przycisków Przyjmij/Odrzuć. Agent utknął; 200, brak logu.                                                                 | Stan błędu + log + 503.                                                                      |
| O4  | `supabase/migrations/20261028200000_invitation_response.sql:44-45`                                                                                                                                                                                                                                                 | flattened-response             | high     | `rank_agents_for_offer` zwraca 0 wierszy, gdy `owner_id <> auth.uid()` (też dla null) → UI „brak dopasowanych agentów”. Zepsuty JWT wygląda jak wynik biznesowy.                            | RPC: `raise` przy niewidocznej ofercie albo log przy pustym rankingu oferty `seeking_agent`. |
| O5  | `src/pages/api/owner/invitations.ts:50`, `src/pages/api/agent/invitations.ts:54,67-68`                                                                                                                                                                                                                             | missing-throw                  | high     | Dryf kontraktu SQL↔TS (`!isInviteResult`) i niemożliwe `invalid_response` → „spróbuj ponownie”.                                                                                             | Zalogować surowe `data` na poziomie error.                                                   |
| O6  | `src/lib/services/offers.ts:101-104` + `catch {}` stron                                                                                                                                                                                                                                                            | swallowed                      | high     | Celowy wyjątek `oneOf()` (nieznany status lub miasto po migracji) → „Oferta chwilowo niedostępna” (200) bez stacku.                                                                         | Mapowanie poza `try` albo przepuszczać błędy inne niż Supabase.                              |
| O7  | `src/pages/owner/offers/[id].astro:62-90`                                                                                                                                                                                                                                                                          | swallowed                      | medium   | `.maybeSingle()` zwraca błąd przy dwóch aktywnych zaproszeniach (złamany niezmiennik), a kod tylko gubi datę.                                                                               | Zalogować `error.code` (PGRST116 = problem integralności).                                   |
| O8  | `supabase/migrations/20261028180000_*:100-104`, `20261028200000_invitation_response.sql:106-108`                                                                                                                                                                                                                   | flattened-response             | medium   | `unique_violation` przy `seeking_agent` → `offer_locked`; zaproszenie `pending` przy ofercie nie-`invited` → `already_responded`. Naruszenia integralności wyglądają jak zwykłe komunikaty. | Osobny kod (`inconsistent_state`) logowany jako błąd.                                        |
| O9  | `src/pages/api/owner/invitations.ts:58`, `api/agent/invitations.ts:63`, `api/owner/offers/delete.ts:53-54`                                                                                                                                                                                                         | missing-context                | medium   | `not_found` / 0 wierszy po tym, jak użytkownik właśnie widział ofertę → 404 nie do odróżnienia od skanu IDOR albo regresji RLS.                                                             | `warn` z `userId` i `offerId`.                                                               |
| O10 | `src/components/agent/InvitationResponse.tsx:56-77`, `src/components/owner/DeleteOffer.tsx:64`                                                                                                                                                                                                                     | coverage-gap                   | low      | Pierwszy krok to `type="button"` zależny od hydratacji; błąd JS daje martwe przyciski bez raportu.                                                                                          | Minimalny beacon `onerror` albo pierwszy krok jako prawdziwy `<form>`.                       |
| O11 | `src/lib/services/offers.ts:154`, `src/lib/services/agent-profile.ts:62-63`                                                                                                                                                                                                                                        | swallowed                      | low      | `cities.filter(isCity)` po cichu gubi nieznane miasta, inaczej niż `oneOf`.                                                                                                                 | Spójnie z `oneOf` albo log porzuconych wartości.                                             |

### Usunięcie konta i oferty

| #   | Lokalizacja                                                                                              | Kategoria                          | Waga     | Co się dzieje na produkcji                                                                                                                                                             | Kierunek poprawki                                                                                                        |
| --- | -------------------------------------------------------------------------------------------------------- | ---------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| D1  | `src/pages/api/account/delete.ts:41-48`, `supabase/migrations/20261028220000_account_deletion.sql:64-71` | flattened-response / missing-throw | critical | `not_found` (też przy `auth.uid()` null) traktowane jak sukces → wylogowanie i „Konto zostało usunięte razem z Twoimi danymi”, choć niczego nie usunięto. Naruszenie PRD, niewidoczne. | Przy obecnym `locals.user` traktować `not_found` jako anomalię: log z `user.id` + `?error=unknown` (albo `raise` w RPC). |
| D2  | `src/pages/api/account/delete.ts:41-46`                                                                  | swallowed / missing-context        | high     | Błąd PostgREST (np. trigger w kaskadzie), dryf kontraktu i wyjątek → `unknown`, bez id użytkownika i kodu błędu.                                                                       | Log per gałąź z `userId`, `code`, `data`.                                                                                |
| D3  | `src/pages/api/account/delete.ts:14-35`                                                                  | swallowed                          | medium   | Brak konfiguracji, błąd odczytu roli i brak profilu → `/auth/signin?error=unavailable`, strona niezwiązana z usuwaniem.                                                                | Zalogować gałąź (config / DB / brak profilu) z `user.id`.                                                                |
| D4  | `src/pages/api/account/delete.ts:55`                                                                     | missing-context                    | medium   | Nieodwracalny zapis bez śladu sukcesu; nie da się odpowiedzieć na „czy konto naprawdę zostało usunięte”.                                                                               | `console.info({ op: "account_deleted", userId, role })` (id, nie e-mail).                                                |
| D5  | `src/pages/api/owner/offers/delete.ts:16-58`                                                             | swallowed                          | medium   | Pięć różnych awarii (config, rola, błąd kaskady/triggera, wyjątek) → `delete_failed` bez logu.                                                                                         | Log `{ op: "offer_delete", userId, offerId, error }` per gałąź.                                                          |
| D6  | `src/pages/api/account/delete.ts:50-54`                                                                  | swallowed                          | low      | Wynik `signOut()` (`{ error }`) ignorowany; `catch {}` łapie tylko wyjątki. Ciasteczka usuniętego konta mogą zostać.                                                                   | Sprawdzić `error`, `warn` z `userId`.                                                                                    |

### Platforma / wspólne elementy

| #   | Lokalizacja                                                                  | Kategoria           | Waga   | Co się dzieje na produkcji                                                                              | Kierunek poprawki                                                                        |
| --- | ---------------------------------------------------------------------------- | ------------------- | ------ | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| P1  | `node_modules/astro/dist/core/routing/handler.js:188-195` (zachowanie Astro) | logged-not-captured | medium | Prawdziwe 500 to tylko linia `console.error` ze stackiem; outcome wywołania „ok”, metryki wyjątków = 0. | Alertować na `console.error`/status ≥500 albo logować strukturalnie we własnym helperze. |
| P2  | `src/layouts/AppLayout.astro:17`                                             | missing-throw       | medium | Guard rzuca w komponencie potomnym, już po nagłówkach 200 → ucięta strona, prawdopodobnie bez logu.     | Guard w frontmatterze strony albo w middleware.                                          |
| P3  | brak `src/pages/500.astro`                                                   | flattened-response  | low    | Domyślna strona 500 bez identyfikatora żądania do zgłoszenia.                                           | `500.astro` z `cf-ray`.                                                                  |
| P4  | brak id żądania i wersji w logach                                            | missing-context     | medium | Nie da się powiązać logu ze zgłoszeniem ani z deployem.                                                 | `cf-ray`, `userId` i wersja w każdej linii logu.                                         |

## 6. Rekomendowana kolejność poprawek

1. **Jeden helper `src/lib/observability.ts`** (`reportError(context, op, err, extra)` → `console.error(JSON.stringify({ level, op, path, userId, cfRay, code, status, message, stack, ...extra }))`). Wołany w każdym `fail()` i każdym `catch (e)` (bind wszystkich 32). Zamyka najwięcej ślepoty najmniejszym kosztem: A3, A4, A6, A9, O1, O5, O6, D2, D3, D5, P4. Ograniczenie prywatności: logować `userId` (uuid), nigdy e-mail, hasło ani treść opisu oferty.
2. **D1:** `not_found` przy zalogowanym użytkowniku → błąd, nie sukces. Jedna gałąź, realna ochrona wymogu PRD.
3. **Middleware (A1, A2, A3):** odczyt `error` z `getUser()`, log przy `no_profile` i błędzie profilu. Zatrzymuje ciche masowe wylogowania.
4. **Statusy stron (O2, O3):** 503 + log w stanach `error` i przy `agents === null`. Dzięki temu zwykłe metryki statusów zaczynają widzieć awarie.
5. **Kontrakty RPC (O4, O8):** odróżnić naruszenie integralności od wyniku biznesowego. Wymaga migracji, więc zrobić jako osobny slice.
6. **Drobne:** `500.astro` z `cf-ray` (P3), guard `AppLayout` w frontmatterze (P2), fail-loud konfiguracji (A8), `rate_limited` jako licznik (A7), callback (A5).

Uwaga przy wdrożeniu: logować strukturalny JSON jedną linią (Workers Logs indeksują pola), a błędy walidacji użytkownika (`invalid_input`, `invalid_credentials`) na poziomie `info`/`warn`, żeby nie zagłuszały awarii (kategoria noise).

## 7. Metoda i ograniczenia

- **Agenci:** 3 audytorów obszarów (auth; oferta → ranking → zaproszenie; usunięcie konta) i 1 audytor przekrojowy, równolegle, tylko odczyt, commit `ceeda1c`.
- **Sprawdzone ręcznie:**
  - D1 (`delete.ts:38-56`, RPC `account_deletion.sql:55-75`);
  - A1 (`middleware.ts:9-16`);
  - A2 (`middleware.ts:36-41`);
  - O2 (statusy w `owner/offers/[id].astro`, tylko `404` w `:97`);
  - P2 (`AppLayout.astro:15-19`);
  - brak `500.astro`;
  - liczby z przeglądu: 32 `catch {`, 0 `catch (`, 0 `console.`, 29 destrukturyzacji `{ … error … } = await`, 10 plików z `const fail`.
- **Runtime:** nie uruchomiono (`runtime_proof: not-run`). Werdykty w §3 są statyczne. Zachowanie Astro i adaptera potwierdzono w źródłach w `node_modules` (Astro 7.4.2, `@astrojs/cloudflare` 14.3.1). Do potwierdzenia sondami (`references/runtime-probes.md` skilla): logowanie przerwanego strumienia przez workerd (P2) i to, czy Workers Logs zapisują `Location`.
- **Niezweryfikowalne z repo:** retencja, sampling i alerty Workers Logs, Logpush.
