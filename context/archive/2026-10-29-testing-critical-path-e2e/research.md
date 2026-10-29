---
date: 2026-10-29T14:39:10+01:00
researcher: Claude (Opus 5.5) z bkreczmer
git_commit: 6823f8d
branch: test/testing-critical-path-e2e
repository: helloDOM
topic: "Rollout Phase 2: test E2E ścieżki krytycznej (ryzyka #1, #2, #3) — ugruntowanie w kodzie"
tags: [research, e2e, playwright, ranking, rls, invitations, ci]
status: complete
last_updated: 2026-10-29
last_updated_by: Claude (Opus 5.5) z bkreczmer
---

# Research: test E2E ścieżki krytycznej (Phase 2 z test-plan.md)

**Date**: 2026-10-29T14:39:10+01:00
**Researcher**: Claude (Opus 5.5) z bkreczmer
**Git Commit**: 6823f8d
**Branch**: test/testing-critical-path-e2e
**Repository**: helloDOM

## Research Question

Ugruntować w kodzie ryzyka #1 (zły top 3), #2 (IDOR przez UI) i #3 (cykl statusów) z `context/foundation/test-plan.md` §2 dla jednego testu E2E (Playwright, Chromium): właściciel → oferta → top 3 → zaproszenie → agent przyjmuje. Zweryfikować wytyczne odpowiedzi na ryzyko, wskazać istniejące testy, wartość dodaną E2E ponad Phase 1, seeding kont, odczyt stanu bazy i miejsce w jobie `smoke` w CI.

## Summary

- **Reguła rankingu jest w jednym miejscu**: `rank_agents_for_offer` w `supabase/migrations/20261028200000_invitation_response.sql:21-54`. Zgadza się z PRD (`prd.md:106-112`). Strona i komponent nie sortują i nie filtrują (`offers.ts:149-156`, `RankingList.astro:30-34`). E2E sprawdza więc to, czego Phase 1 nie dotyka: mapowanie RPC → HTML przez sesję z ciasteczka SSR, pozycję N ↔ właściwy `agentId` za przyciskiem „Zaproś agenta N”, komunikaty „mniej niż 3” i „brak agentów” oraz zniknięcie i powrót rankingu po zaproszeniu i odrzuceniu.
- **Ranking w UI jest anonimowy** (`RankingList.astro:18,34`: „Agent {index + 1}”, bez nazwy i e-maila). Tożsamość agenta na pozycji N da się sprawdzić tylko przez ukryte pole `input[name="agentId"]` w `<li>` (`:55`), porównane z `user.id` z rejestracji. Wyrocznię trzeba więc zapisać jako listę `[etykieta agenta, wynik]`, a nie same wyniki.
- **Izolacja w UI opiera się wyłącznie na RLS i kliencie z ciasteczka sesji.** Strony nie sprawdzają właściciela same (`owner/offers/[id].astro:27`, `agent/offers/[id].astro:13-14`). Cudza lub niezaproszona oferta daje 404 z kartą „Nie znaleziono oferty”. Zła rola daje 302 do własnego panelu (`middleware.ts:48-51`). Testy I1–I16 nie wykryją regresji, w której strona SSR zacznie czytać uprzywilejowanym klientem. E2E to wykryje.
- **Cykl statusów** pilnują: indeks częściowy `invitations_one_active_per_offer` (`20261028180000_create_invitations.sql:21-24`), RPC `invite_agent` i `respond_to_invitation` (blokada `for update`, zwracają `offer_locked`/`already_responded`) oraz polityka `offers_update_own_editable` (`20261029100000_owner_offer_management.sql:18-22`). Druga próba przyjęcia kończy się 302 do `/agent?error=already_responded`. Odpowiedź HTTP nie dowodzi stanu, więc E2E musi czytać bazę.
- **Odczyt stanu bazy w teście**: supabase-js z kluczem anon i sesją właściciela (`signInWithPassword`). Właściciel widzi wszystkie zaproszenia swojej oferty (`invitations_select_own_owner`). Bez `service_role` i bez psql.
- **Seeding**: przez `POST /api/auth/signup` (form, pole `role`) i `POST /api/agent/profile` (form) z nagłówkiem `Origin`, jak w smoke. Konta rejestrowane sekwencyjnie, miasta inne niż w smoke i w testach integracyjnych, a przed testem sonda pustych miast (`assertCitiesEmpty`).
- **CI**: Playwright pasuje do joba `smoke` po kroku smoke i przed `supabase stop`, na już zbudowanej aplikacji (`ci.yml:61-66`). Instalacja Chromium to dodatkowy krok. `astro check` i lint obejmą `tests/e2e/**` (`tsconfig.json` ma `**/*`), więc `@playwright/test` musi być w devDeps.

## Detailed Findings

### Ryzyko #1 — top 3 w przeglądarce

**Ścieżka awarii (kod).**
- Wynik: `case when o.property_type = any (p.property_types) then 35 else 0 end + case when o.price between p.price_min and p.price_max then 35 else 0 end + 3 * least(p.experience_years, 10)` (`20261028200000_invitation_response.sql:33-35`).
- Miasto jest warunkiem złączenia: `join public.profiles p on o.city = any (p.cities)` (`:41`). Agent spoza miasta w ogóle nie trafia do wyniku.
- Kwalifikacja: `p.role = 'agent' and p.profile_complete` (`:44-45`); `profile_complete` to kolumna generowana (`20261028100000_add_agent_profile.sql:31-37`). Agent odrzucony jest wykluczany per oferta (`:46-49`).
- Filtr i kolejność: `where r.score > 0`, potem `order by r.score desc, r.experience_years desc, r.created_at asc, r.agent_id asc limit 3` (`:51-53`). Filtr wyniku 0 działa przed `limit`.
- Strona woła RPC tylko przy statusie `seeking_agent` (`owner/offers/[id].astro:55-58`). Przy innym statusie zamiast `RankingList` renderuje `InvitationStatusCard` (`:167-182`).
- Komponent renderuje `<ol>`, w którym każde `<li>` ma `<h3>Agent {index + 1}</h3>`, odznakę `{score}/100` (sr-only „Wynik dopasowania: ”), „Staż: …”, miasta i formularz z ukrytymi `offerId`/`agentId` oraz przyciskiem `aria-label="Zaproś agenta N"` (`RankingList.astro:30-60`).
- Komunikaty: przy `< 3` „Dopasowanych agentów jest mniej niż 3…”, przy 0 „Nie ma jeszcze dopasowanych agentów…” (`:68-74`).

**PRD a SQL.** Reguły zgadzają się. Różnice nie wpływają na wyrocznię:
- US-01 mówi, że agent spoza miasta ma być „niżej”, a SQL go wyklucza. Wynika to z Business Logic: wynik 0 nie jest pokazywany.
- SQL ma dodatkowy remis po `agent_id`, istotny tylko przy identycznym `created_at`.
- „Wcześniejsza rejestracja” w SQL to `profiles.created_at`, czyli moment założenia konta, a nie uzupełnienia profilu.

**Weryfikacja wytycznych.**
- „Jeden agent w top 3 dowodzi reguły” — **obalone**. Dziś smoke sprawdza w HTML tylko „Agent 1”, „100/100” i „Zaproś” dla jednego agenta (`smoke.mjs:303-311`). Taki test przejdzie przy odwróconej kolejności pozycji 2–3, przy złym remisie i przy wycieku czwartego agenta.
- „Phase 1 już to pokrywa, więc E2E nic nie dodaje” — **częściowo prawda**. Arytmetykę i remisy pokrywają R1–R8 (`tests/integration/ranking.test.ts`) i `supabase/tests/offer-ranking.sql`. E2E ich nie powtarza i nie powinno mieć tabeli przypadków brzegowych (test-plan §1 „koszt × sygnał”). E2E dodaje: (a) kolejność w DOM i mapowanie pozycji na `agentId`, bo zły `agentId` za przyciskiem oznacza zaproszenie złej osoby; (b) dokładnie 3 elementy `<li>`, bez wycieku agenta niekwalifikowanego; (c) widoczny komunikat „mniej niż 3” (odłożony do Phase 2 w `context/archive/2026-10-29-testing-ranking-and-isolation/plan.md:38`); (d) ranking zastąpiony kartą po zaproszeniu i przywrócony z komunikatem po odrzuceniu; (e) prawdziwy przepływ formularz oferty → 302 → ranking (US-01).
- Wyrocznia z PRD, policzona ręcznie. Remis musi faktycznie zachodzić w danych.

**Proponowana wyrocznia (do potwierdzenia w planie, liczona ręcznie z `prd.md:110-112`).** Miasto `lublin`, oferta: mieszkanie, 500 000 zł. Agentów rejestrujemy w podanej kolejności.

| Agent | Profil | Wynik z PRD | Oczekiwanie |
|---|---|---|---|
| P (perfect) | lublin, apartment, 400–600 tys., 10 lat | 35+35+30 = 100 | Agent 1 |
| T1 | lublin, apartment, 400 tys.–**500 000** (granica), 5 lat | 35+35+15 = 85 | Agent 2 (remis z T2: ten sam wynik i staż, wcześniejsza rejestracja) |
| T2 | lublin, apartment, **500 000**–700 tys., 5 lat | 85 | Agent 3 |
| F (fourth) | lublin, house, 400–600 tys., 15 lat | 0+35+30 = 65 | poza top 3; wchodzi jako Agent 3 po odrzuceniu przez P |
| I (incomplete) | lublin, apartment, 400–600 tys., brak stażu | — (niepełny profil) | nigdy w HTML |
| O (other city) | rzeszow, apartment, 400–600 tys., 10 lat | 0 (miasto) | nigdy w HTML |

Wynik 0 jest pokazywany w kodzie dopiero przy mniej niż 3 kwalifikujących się agentach. Agent z wynikiem 0, który nie mieści się w top 3, nie dowodzi więc filtra. Dlatego proponuję drugą, małą ofertę: `zielona-gora`, działka, 950 000 zł. Agent Y (zielona-gora, plot, 900 tys.–1 mln, 0 lat) ma 70 pkt, a Z (zielona-gora, house, 1–10 zł, 0 lat) ma 0. Oczekiwane jest dokładnie jedno `<li>` „70/100” = Y plus komunikat „mniej niż 3”, a Z nie występuje.

### Ryzyko #2 — izolacja przez UI

**Ścieżka (kod).**
- Bramkowane są `/dashboard`, `/owner`, `/agent` z podścieżkami (`route-guard.ts:7,10-11`). Zła rola: `context.redirect(homeFor(profile.role))` (`middleware.ts:48-51`). `/api/*` nie jest bramkowane. Endpointy same sprawdzają `locals.user` i zwracają 403 przy złej roli (`api/owner/invitations.ts:38-40`, `api/agent/invitations.ts:39-41`).
- Strony czytają ofertę klientem z ciasteczka (`createClient(Astro.request.headers, Astro.cookies)`) przez `.eq("id", offerId).maybeSingle()`. Nie filtrują po `owner_id`: rolę filtra pełni RLS (`owner/index.astro:19`, `owner/offers/[id].astro:27`).
- Gdy wiersza brak, strona ustawia `Astro.response.status = 404` i pokazuje kartę „Nie znaleziono oferty” (`owner/offers/[id].astro:96-98,184-186`; `owner/offers/[id]/edit.astro:57-58`; `agent/offers/[id].astro:61-63,113`).
- RLS: `offers_select_own` (`20261028140000_create_offers.sql:47-50`), `offers_select_invited_agent` z `i.status in ('pending','accepted')` (`20261028180000_create_invitations.sql:47-57`), `invitations_select_own_owner/_own_agent` (`:35-43`) i `profiles_select_own` (`20261027150939_create_profiles.sql:13-14`).
- Zaakceptowane ujawnienia (`isolation.test.ts:37-40`): zaproszony agent może przez PostgREST odczytać `owner_id` oferty, a strona go nie wybiera. Właściciel dostaje z RPC `agent_id`, ale w UI widzi tylko ukryte pole.

**Weryfikacja wytycznych.**
- „Middleware chroni, więc wystarczy sprawdzić UI” — **obalone**. Middleware sprawdza tylko rolę, nie właściciela. Ownership zapewnia wyłącznie RLS plus klient sesji na stronie. Właściciel B ma tę samą rolę co A, więc middleware go przepuszcza. E2E musi więc sprawdzić B na `/owner/offers/X` i `/owner/offers/X/edit`: 404, karta „Nie znaleziono oferty” i brak unikalnego opisu X w HTML. Sama poprawna rola niczego tu nie dowodzi.
- „Pusta lista = brak dostępu” — wymaga kontroli pozytywnej w tym samym przebiegu: A widzi X na `/owner` i `/owner/offers/X`, zaproszony agent widzi X na `/agent` i `/agent/offers/X`. Dopiero wtedy 404 u B i u niezaproszonego agenta (np. T2) jest dowodem.
- „Agent widzi **tylko** ofertę, do której go zaproszono”: właściciel A ma drugą ofertę (zielona-gora). Zaproszony agent nie widzi jej na `/agent`, a bezpośredni URL daje 404. A widzi obie (kontrola pozytywna).
- Unikać „niezalogowany → redirect” jako jedynego testu. Przekierowanie między rolami (właściciel na `/agent/offers/X` → `/owner`) to tani dodatek, nie główny dowód.
- Wartość dodana ponad I1–I16 (`tests/integration/isolation.test.ts`, PostgREST z JWT): E2E wykrywa regresję w warstwie SSR, np. stronę czytającą uprzywilejowanym klientem albo stronę błędu z danymi. Przez PostgREST tego nie widać. Dziś nic w `src` nie używa `service_role` (sprawdzone przez agenta badawczego w `src/**`).

### Ryzyko #3 — cykl statusów

**Ścieżka (kod).**
- Statusy oferty: `draft|seeking_agent|invited|in_progress`, domyślnie `seeking_agent` (`create_offers.sql:18,33`). Statusy zaproszenia: `pending|accepted|rejected` (`create_invitations.sql:17`), plus `unique (offer_id, agent_id)` i check `(status = 'pending') = (responded_at is null)` (`invitation_response.sql:10-11`).
- `invite_agent` (`create_invitations.sql:67-110`) robi kolejno:
  1. `for update` na ofercie;
  2. `not_found` dla cudzej oferty;
  3. `offer_locked`, gdy status ≠ `seeking_agent`;
  4. `agent_not_ranked`, gdy agenta nie ma w top 3;
  5. insert, w którym `unique_violation` zamienia się na `offer_locked`;
  6. ustawienie statusu `invited`.
- `respond_to_invitation` (`invitation_response.sql:71-122`) zwraca `already_responded`, gdy zaproszenie nie jest `pending` albo oferta nie jest `invited`. Przyjęcie daje `accepted` i `in_progress`, odrzucenie `rejected` i `seeking_agent`.
- Blokada edycji: polityka `offers_update_own_editable … status in ('draft','seeking_agent')` (`owner_offer_management.sql:18-22`). Grant nie obejmuje kolumny `status` (`:14`).
- UI po zaproszeniu chowa link „Edytuj” i pokazuje „Edycja jest zablokowana…” (`owner/offers/[id].astro:146-159`). GET `/edit` daje 302 do `?error=edit_locked` (`edit.astro:53-56`). POST `update` zmienia 0 wierszy i przekierowuje do `?error=edit_locked` (`api/owner/offers/update.ts:73-90`).
- Druga próba przyjęcia przez tego samego agenta daje 302 do `/agent?error=already_responded` i alert „Na to zaproszenie już odpowiedziano.” (`api/agent/invitations.ts:64-66`). Przyjęcie przez niezaproszonego agenta daje 404 „Not Found” (`:61-63`). Po przyjęciu UI nie renderuje przycisków (`agent/offers/[id].astro:88-101`), więc drugą próbę trzeba wysłać przez `page.request.post` z `Origin`.

**Weryfikacja wytycznych.**
- „200 = poprawny stan” — **obalone i doprecyzowane**. Endpointy nie zwracają 200: to natywne formularze z odpowiedzią 302, a błąd też jest 302 z `?error=`. Sam komunikat w UI nie dowodzi stanu. Po każdej akcji test czyta bazę sesją właściciela:
  - `offers.status`;
  - `count(invitations where offer_id = X and status = 'accepted') = 1`;
  - po edycji po zaproszeniu: niezmienione `price`/`description`.
- „Tylko jeden przyjęty agent” daje się w UI sprawdzić tylko pośrednio, bo drugie zaproszenie jest zablokowane na poziomie bazy (indeks częściowy). W E2E wystarczy, że po przyjęciu w bazie jest dokładnie 1 `accepted` i druga próba przyjęcia jej nie zmienia. Wyścig dwóch przyjęć pokrywa `invitation-response.sql`. Przy jednym zaproszeniu na ofertę w E2E taki wyścig nie zachodzi, więc nie jest to cel tego testu.
- Proponowane rozszerzenie ścieżki tanim kosztem: P **odrzuca** i (1) w UI właściciela wraca ranking z komunikatem, a P znika z pozycji; (2) F wchodzi jako Agent 3; (3) baza: oferta `seeking_agent`. Potem właściciel zaprasza T1, T1 przyjmuje. To pokrywa ryzyko #3 „oferta zostaje w `invited` po odrzuceniu” i wykluczenie odrzuconego z ryzyka #1. Usunięcie konta (FR-012) zostaje poza E2E: pokrywa je `account-deletion.sql` i smoke (`smoke.mjs:715-788`).

### Seeding kont i danych

- `POST /api/auth/signup`: form-encoded `email`, `password` (min 6), `role ∈ {owner, agent}` (`auth-schemas.ts:15-19`). Przy wyłączonych potwierdzeniach (`config.toml:211`) odpowiedź to 302 do `/dashboard` z ciasteczkami `sb-*` (`signup.ts:45`, `supabase.ts:10-20`). JSON jest odrzucany (`signup.ts:13`).
- `POST /api/agent/profile`: form z powtarzanymi kluczami `cities` i `propertyTypes` oraz `priceMin`, `priceMax`, `experienceYears` (`agent-profile.ts:26-48`). Na poziomie API każde pole jest opcjonalne, więc agent I (niepełny) to po prostu brak `experienceYears`.
- Ofertę tworzy właściciel w UI: „Dodaj ofertę” → formularz → „Zapisz i pokaż agentów” (`OfferForm.tsx:97`). To kawałek ścieżki krytycznej, nie seed.
- Nagłówek `Origin`: smoke wysyła go przy każdym POST (`smoke.mjs:114-117`). `astro.config.mjs` nie ustawia `security`, więc najpewniej działa domyślne `checkOrigin`. To wniosek, nie test: w Playwright `APIRequestContext` trzeba ustawić `extraHTTPHeaders: { Origin: baseURL }`. Kliknięcia w przeglądarce wysyłają `Origin` same.
- Sesja w przeglądarce: osobny `browser.newContext()` na użytkownika. Rejestracja przez `context.request.post(...)` zapisuje ciasteczka w tym kontekście. Bez plików storageState na dysku, a jeśli jednak powstaną, trzeba dodać `.auth/`, `test-results/` i `playwright-report/` do `.gitignore`, bo dziś ich tam nie ma.
- Kolejność rejestracji wyznacza remis T1 < T2, więc konta zakładamy sekwencyjnie i nie równolegle (test-plan §6.1).
- Unikalność między przebiegami: e-mail `e2e-<rola>-<runId>@example.com`. Miasta niezajęte przez inne zestawy: smoke używa `warszawa` (`smoke.mjs:295`), integracja `opole`, `krakow`, `torun`, `kielce` (`ranking.test.ts:24-51`, `isolation.test.ts:21-29`), więc E2E bierze `lublin`, `rzeszow` i `zielona-gora`.
- Zanieczyszczenie danymi z poprzednich przebiegów: przed seedem sonda pustych miast, wzorem `assertCitiesEmpty` (`helpers.ts:111-138`). Ten helper nie zależy od vitest i da się go zaimportować jako `../integration/helpers`, ale komunikat naprawczy zna tylko wzorce `it-%` i `smoke-%` (`:132-133`), więc trzeba dopisać `e2e-%`.
- Limit auth: `sign_in_sign_ups = 100` na 5 min na IP (`config.toml:192`). Job smoke zużywa dziś ok. 13 kont integracyjnych i ok. 14 wywołań smoke. Propozycja E2E zakłada 10 kont (A, B, P, T1, T2, F, I, O, Y, Z) plus logowania do odczytu bazy, czyli w sumie poniżej 100. Lokalnie kolejne przebiegi pod rząd mogą dostać 429 (test-plan §6.5).
- Sprzątanie w `afterAll`: `POST /api/account/delete` z kontekstu każdego użytkownika (`api/account/delete.ts`, RPC `delete_own_account` w `20261028220000_account_deletion.sql:54-79`), tak jak robi smoke.

### Odczyt stanu bazy z testu

- supabase-js z `SUPABASE_URL`/`SUPABASE_KEY` (anon) oraz `signInWithPassword(email, hasło)` właściciela A:
  - `from("offers").select("status, price, description").eq("id", X)`;
  - `from("invitations").select("agent_id, status").eq("offer_id", X)`.
  RLS pokazuje to właścicielowi (`invitations_select_own_owner`).
- Opcjonalnie sesją agenta T1: jego zaproszenie ma status `accepted`.
- Nie psql i nie `service_role`. Psql w CI jest dostępny (`ci.yml:43-49`), ale omija RLS i dodaje zależność od kontenera. Odczyt sesją jest zgodny z §6.2.
- Zmienne env: `helpers.ts:36-37` czyta `process.env.SUPABASE_URL/KEY` i odrzuca hosty inne niż lokalne (`:47-50`). `playwright.config.ts` musi je załadować sam (vitest robi to przez `loadEnv` w `vitest.config.ts:7-21`). W CI są w `supabase.env`/`.env` (`ci.yml:41-42,56-60`).

### CI

- Job `smoke` (`ci.yml:27-68`) robi kolejno: `supabase start -x …`, testy SQL przez psql, `npm run test:integration`, kontrolę dryfu `db:types`, zapis `.env` i `.dev.vars`, `npm run build`, a na koniec jeden krok: `npm run preview -- --port 4321 &`, pętla curl i `npm run smoke`.
- Miejsce dla E2E: po smoke, przed `supabase stop`. Bezpieczny wariant to Playwright `webServer: { command: "npm run preview -- --port 4321", reuseExistingServer: true, url: "http://localhost:4321" }` w osobnym kroku. Albo dopisać `npx playwright test` w tym samym kroku co smoke, bo nie wiadomo, czy proces preview w tle przeżyje koniec kroku (niesprawdzone).
- Build już istnieje, więc `webServer` nie powinien budować drugi raz.
- `npx playwright install --with-deps chromium`: szacunkowo 1–2 min (niezmierzone). Warto cache'ować `~/.cache/ms-playwright` po wersji. To zadanie dla `/10x-e2e-setup`.
- Vitest bierze tylko `tests/integration/**/*.test.ts` (`vitest.config.ts`), więc `tests/e2e/*.spec.ts` nie koliduje. `tsconfig.json` obejmuje `**/*`, więc spec przechodzi przez `astro check` i lint.
- Bramka z test-plan §5 „e2e ścieżki krytycznej | CI on PR” jest spełniona, bo job `smoke` uruchamia się na PR (`ci.yml`).

### Lokatory (brak `data-testid` w `src/**`)

| Krok | Lokator |
|---|---|
| Panel właściciela | link „Dodaj ofertę” (`owner/index.astro:52-55`) |
| Formularz oferty | etykiety pól, przycisk „Zapisz i pokaż agentów” (`OfferForm.tsx:97`); po zapisie `?created=1` i „Zapisano ofertę” |
| Ranking | sekcja z nagłówkiem „Najlepiej dopasowani agenci” → `ol > li`; „Agent N”; „NN/100”; `input[name=agentId]`; przycisk „Zaproś agenta N” |
| Po zaproszeniu | `role="status"` „Wysłano zaproszenie”; karta „Zaproszenie wysłane”; „Edycja jest zablokowana…” |
| Agent | „Zaproszenia”, pigułka „Oczekuje na odpowiedź”, link „Zobacz ofertę”; „Przyjmij” → „Tak, przyjmij” (wyspa React, czekaj na hydrację); `?accepted=1` „Przyjęto zaproszenie”; pigułki „Przyjęte”, „W obsłudze” |
| Odrzucenie | „Odrzuć” → „Tak, odrzuć” → `/agent?rejected=1` „Odrzucono zaproszenie” |
| Błędy | `role="alert"` (`ServerError.tsx:12`) |

Plan może rozważyć dodanie `data-testid` na `<li>` rankingu z numerem pozycji. Nie jest to konieczne: lokatory ról i tekstu wystarczają, a `agentId` jest w ukrytym polu.

## Code References

- `supabase/migrations/20261028200000_invitation_response.sql:21-54` — `rank_agents_for_offer` (bieżąca definicja)
- `supabase/migrations/20261028200000_invitation_response.sql:71-122` — `respond_to_invitation`
- `supabase/migrations/20261028180000_create_invitations.sql:21-24,47-57,67-110` — indeks jednego aktywnego zaproszenia, RLS agenta, `invite_agent`
- `supabase/migrations/20261029100000_owner_offer_management.sql:14-22` — grant i polityka edycji
- `src/pages/owner/offers/[id].astro:27,55-58,96-98,146-186` — RLS-404, RPC tylko w `seeking_agent`, blokada edycji, karta statusu
- `src/components/owner/RankingList.astro:18-74` — anonimowy ranking, ukryte `agentId`, komunikaty
- `src/pages/agent/offers/[id].astro:13-14,61-63,88-113` — 404 bez zaproszenia, brak przycisków po przyjęciu
- `src/middleware.ts:25-51`, `src/lib/route-guard.ts:7-25` — bramka roli
- `src/pages/api/agent/invitations.ts:39-66`, `src/pages/api/owner/invitations.ts:38-55`, `src/pages/api/owner/offers/update.ts:73-90` — mapowanie kodów RPC na 302/403/404
- `tests/integration/helpers.ts:29-138` — `signUpAs`, `assertCitiesEmpty`, `deleteUsers`
- `scripts/smoke.mjs:45-56,93-124,303-311` — unikalna cena, słoik ciasteczek z `Origin`, płytka asercja rankingu
- `.github/workflows/ci.yml:27-68` — job smoke
- `vitest.config.ts`, `supabase/config.toml:192,211`

## Architecture Insights

- Logika rankingu i przejść statusów żyje w Postgresie (`security definer` RPC + RLS). TypeScript tylko mapuje kody wyniku na przekierowania. Najdroższe do wykrycia regresje E2E siedzą więc na styku: mapowanie, wybór klienta Supabase na stronie i warunki renderowania (`status === "seeking_agent"`).
- Wszystkie akcje to natywne formularze z 302 i `?error=`/`?ok=1`. W asercjach liczy się URL po przekierowaniu i `role="status"`/`role="alert"`, a nie kody 200.
- Ranking jest celowo anonimowy. Test musi sprawdzać tożsamość przez ukryte `agentId` i nie powinien dodawać danych osobowych do UI dla wygody testu.

## Historical Context (from prior changes)

- `context/archive/2026-10-29-testing-ranking-and-isolation/plan.md:38` i `plan-brief.md:40` odkładają komunikat „mniej niż 3” i `/api/*` przez HTTP do E2E w Phase 2 — **aktualne**, oba punkty mają tu miejsce.
- `context/archive/2026-10-27-app-shell/plan.md:176` mówi, że polskie komunikaty `?error=` są stałe, żeby E2E mogło je sprawdzać — **aktualne** (`invitationErrorMessage`, `offerActionErrorMessage`).
- `context/archive/2026-10-28-invitation-response/reviews` (F1: test remisu przechodził z niewłaściwego powodu) potwierdza zasadę wytycznych, że remis musi zachodzić w danych. Wyrocznia T1/T2 ma ten sam wynik i staż.
- test-plan §2 sam zastrzega, że hot-spoty odzwierciedlają kolejność budowy (cały kod z 3 dni), a nie niestabilność. Liczby commitów (`supabase/tests/` 11, `src/pages/api/` 19, `scripts/` 18) nie wskazują miejsca awarii. Zgodnie z §1.3 rację ma niniejszy research.

## Related Research

- `context/archive/2026-10-29-testing-ranking-and-isolation/research.md` — Phase 1 (integracja rankingu i izolacji).

## Open Questions

1. **Zakres ścieżki** (decyzja do planu): czysta ścieżka zaproś → przyjmij, czy z odrzuceniem przez P przed zaproszeniem T1? Rekomendacja: z odrzuceniem. Kosztuje jedno konto i kilka kroków, a pokrywa FR-011 w UI.
2. **Druga oferta (zielona-gora)** dla dowodu filtra wyniku 0 i komunikatu „mniej niż 3”: w tym samym teście czy w osobnym `test()` w tym samym pliku? Rekomendacja: ten sam plik, osobny `test()` na wspólnym seedzie (`test.describe.serial`).
3. **`Origin` w `APIRequestContext`**: niesprawdzone, czy bez nagłówka POST dostaje 403. Rozstrzygnie seed test w `/10x-e2e-setup`.
4. **Preview w CI**: `webServer` w Playwright czy wspólny krok ze smoke. Rozstrzygnie `/10x-e2e-setup`.
5. Sonda pustych miast nie widzi agenta z 0 lat bez dopasowania typu i ceny (`helpers.ts`, komentarz). Taki agent może dać fałszywą czerwień, nigdy fałszywą zieleń, więc ryzyko jest akceptowalne.
