---
date: 2026-10-29T11:55:51+01:00
researcher: Claude (Opus 5.5) z bkreczmer
git_commit: 95556e2
branch: main
repository: helloDOM
topic: "Etap 1 planu testów: ranking top 3 i izolacja danych (ryzyka #1, #2, #6)"
tags: [research, testing, vitest, ranking, rls, idor, ci, test-plan-phase-1]
status: complete
last_updated: 2026-10-29
last_updated_by: Claude (Opus 5.5)
---

# Research: Etap 1 planu testów — ranking top 3 i izolacja danych

**Date**: 2026-10-29T11:55:51+01:00
**Researcher**: Claude (Opus 5.5) z bkreczmer
**Git Commit**: 95556e2 (working tree: nieśledzone `context/changes/testing-ranking-and-isolation/` i `context/foundation/test-plan.md`)
**Branch**: main
**Repository**: helloDOM

## Research Question

Ugruntować etap 1 z `context/foundation/test-plan.md:46`: wprowadzić runner testów i udowodnić z prawdziwymi sesjami, że (#1) top 3 zgadza się z regułą PRD, (#2) użytkownik B nie dosięga danych użytkownika A przez REST, RPC ani `/api/*`, oraz (#6) celowo zepsuta reguła zapala nowe testy na czerwono. Kontekst do ugruntowania wg `test-plan.md:31-32`: gdzie liczy się wynik, jak wywołać ranking z sesją właściciela, co pokrywają testy SQL, pełna lista powierzchni dostępu, jak uzyskać dwie sesje.

## Summary

- **Runner:** Vitest 5.0.5 (`npm view`: peer `vite ^6.4 || ^7 || ^8`, Node `^24`) pasuje do zainstalowanego `vite` 8.3.5 i Node 24 (`.nvmrc`). Zwykły `vitest.config.ts` bez `getViteConfig` wystarcza, bo testy wołają tylko supabase-js po HTTP; ładowanie configu Astro wciągnęłoby `@astrojs/cloudflare` i `astro:env` bez potrzeby. Pliki testów pod `tests/` trafią do `astro check` i do ESLint z regułami type-checked (`tsconfig.json:3` `include: ["**/*"]`, `eslint.config.js:17-22`).
- **Sesje:** lokalnie `enable_confirmations = false` (`supabase/config.toml:209`), więc `supabase.auth.signUp({ options: { data: { role } } })` z kluczem anon od razu zwraca sesję; rolę w `profiles` ustawia trigger `handle_new_user` z `raw_user_meta_data->>'role'` (`supabase/migrations/20261027150939_create_profiles.sql:24-43`). Profil agenta to bezpośredni `update` na `profiles` własną sesją (grant kolumnowy `20261028100000_add_agent_profile.sql:40`). Sprzątanie bez `service_role`: każde konto woła `rpc('delete_own_account')` (`20261028220000_account_deletion.sql:54-79`).
- **Ranking:** jedyne miejsce liczenia to `public.rank_agents_for_offer(p_offer_id)` w ostatniej wersji `20261028200000_invitation_response.sql:21-57` (SECURITY DEFINER, `search_path = ''`, EXECUTE tylko `authenticated`). Caller rozpoznawany przez `o.owner_id = auth.uid()` (`:43`). Aplikacja woła ją sesją użytkownika w `src/pages/owner/offers/[id].astro:57`, tylko gdy `status === "seeking_agent"` (`:55`).
- **Kluczowa przewaga prawdziwych sesji:** `profiles.created_at` ma `default now()` i nie ma grantu na update (`add_agent_profile.sql:39` komentarz). Kolejne `signUp` to osobne transakcje, więc data rejestracji jest rzeczywista i rośnie z kolejnością rejestracji — tie-break „wcześniejsza rejestracja” da się sprawdzić bez ręcznego ustawiania `created_at`, którego wymagały testy SQL (archiwum F1, niżej).
- **Główne ryzyko testu rankingu:** pozostałości w lokalnej bazie. Ranking widzi wszystkich kompletnych agentów w mieście oferty (`invitation_response.sql:41,44-45`), a agent smoke zapisuje profil ze wszystkimi miastami i ceną 0–2 000 000 (`scripts/smoke.mjs:230-238`); nieudany przebieg smoke go nie usuwa. W chwili badania lokalna baza ma 1 kompletnego agenta (miasto `warszawa`) na 2 profile (zapytanie `psql` przez `docker exec`). Test musi więc albo sprawdzić czystość puli przed asercjami, albo zbudować przypadki odporne na obcych agentów (Open Question 1).
- **Izolacja:** wszystkie 3 tabele (`profiles`, `offers`, `invitations`) mają RLS z politykami tylko `to authenticated` i `revoke all` dla anon; 4 RPC są SECURITY DEFINER z bramką `auth.uid()`; brak klucza `service_role` w `src/` (grep). Testy SQL podszywają się przez `set local role authenticated` + `request.jwt.claims`, a smoke sprawdza tylko endpointy Astro. **Nikt dziś nie wysyła prawdziwego JWT użytkownika B do PostgREST** (`/rest/v1/*`, `/rest/v1/rpc/*`) — to główna luka do zamknięcia w etapie 1.
- **CI:** testy integracyjne mogą działać tylko w jobie `smoke` (jedyny z lokalnym Supabase, `.github/workflows/ci.yml:26-64`); naturalne miejsce to krok po „Run database tests” (`:43-49`), przed buildem, z env z `supabase.env` (`:42`). Serwer aplikacji nie jest potrzebny, jeśli testy nie idą przez `/api/*`.

## Detailed Findings

### 1. Reguła rankingu — wyrocznia z PRD (nie z kodu)

Cytaty z `context/foundation/prd.md`:
- `:108` — wynik 0–100, miasto warunkiem koniecznym, do trzech agentów z wynikiem > 0.
- `:110` — spoza miasta = 0; typ +35; cena w przedziale +35, poza 0; doświadczenie do 30 pkt liniowo do 10 lat.
- `:112` — malejąco wg wyniku; remis → więcej lat; potem wcześniejsza rejestracja; odrzucający wypada z rankingu tej oferty; niepełny profil nie trafia.
- `:87` (FR-008) — wynik 0 niepokazywany; mniej niż 3 → komunikat. `:97-98` (FR-011) — miejsce odrzucającego zajmuje kolejny. `:52-59` (US-01) — agent z miasta wyżej niż spoza miasta. `:83-84` (FR-007) — niepełny profil nigdy w top 3.

Tabela wyroczni (do tabeli przypadków w planie):

| Id | Reguła PRD | Wartości do testu |
|---|---|---|
| O1 | agent spoza miasta oferty = 0 → nieobecny | agent z idealnym typem/ceną/stażem w innym mieście |
| O2 | typ obsługiwany +35 | — |
| O3 | cena „mieści się” w przedziale +35 | granice: `price = price_min`, `= price_max`, ±1 |
| O4 | staż liniowo do 10 lat, max 30 | 0→0, 5→15, 10→30, 15→30 |
| O5 | wynik 0 niepokazywany | agent z miasta bez typu, poza ceną, staż 0 |
| O6 | najwyżej 3 | ≥4 kandydatów |
| O7 | wynik ↓, staż ↓, rejestracja ↑ | faktyczny remis wyniku przy różnym stażu; remis wyniku i stażu przy różnej dacie rejestracji |
| O8 | odrzucający wypada z tej oferty, kolejny wchodzi | 4 kandydatów, #1 odrzuca → #2,#3,#4 |
| O9 | niepełny profil nieobecny | brak ceny / brak typu przy pełnym reszcie |
| O10 | ranking widzi tylko właściciel oferty (`prd.md:121`) | to pokrywa #2 |

Zastrzeżenia do wyroczni:
- Włączność granic ceny (O3) wynika z `between` w kodzie (`invitation_response.sql:34`), a PRD mówi tylko „mieści się” — to interpretacja do zatwierdzenia w planie, nie wyrocznia PRD.
- Remis stażu po capie: kod sortuje po surowych latach (`:52`, `experience_years desc`), PRD mówi „większa liczba lat doświadczenia” — 15 lat wygrywa z 12 przy tym samym wyniku 100; zgodne z PRD, nieprzetestowane.
- Ostatni klucz `agent_id asc` (`:52`) nie wynika z PRD; prawdziwe sesje nie dadzą dwóch równych `created_at`, więc test nie powinien na nim polegać.

### 2. Funkcja rankingu i jej wywołanie

- Definicja: `supabase/migrations/20261028200000_invitation_response.sql:21-57` (`create or replace` zastępuje wersję z `20261028140000_create_offers.sql:70-102`; dodaje wykluczenie odrzuconych `:46-49`). Późniejsze migracje (sprawdzone: `20261028220000_account_deletion.sql`, `20261029100000_owner_offer_management.sql`) jej nie redefiniują.
- Zwraca `agent_id, score, experience_years, cities` (`:22`); nie zwraca `created_at`. Filtry: miasto przez join (`:41`), `role = 'agent'`, `profile_complete` (`:44-45`), brak zaproszenia `rejected` (`:46-49`), `score > 0` przed `limit 3` (`:51,53`).
- Funkcja nie filtruje po statusie oferty; robi to strona (`src/pages/owner/offers/[id].astro:55`). `invite_agent` używa rankingu jako bramki (`20261028180000_create_invitations.sql:92-97`).
- `profile_complete` to kolumna generowana: ≥1 miasto, ≥1 typ, `price_min`, `price_max`, `experience_years` niepuste (`20261028100000_add_agent_profile.sql:30-37`). Ograniczenia: staż 0–60 (`:28`), `price_max >= price_min`, ceny ≥ 0.
- Wywołanie w teście: właściciel z prawdziwą sesją robi `insert` oferty (grant kolumnowy bez `owner_id`/`status`, `create_offers.sql:43`; `owner_id default auth.uid()` i `status default 'seeking_agent'`, `create_offers.sql:10,18`), potem `rpc('rank_agents_for_offer', { p_offer_id })`. Kolejność pozycji = kolejność wierszy RPC (mapowanie `src/lib/services/offers.ts:149-156`).

### 3. Co dziś pokrywają testy SQL rankingu

`supabase/tests/offer-ranking.sql` (transakcja + rollback; dev-agenci wyzerowani `cities='{}'` `:14`; użytkownicy wstawiani do `auth.users` `:17-24`):
- Pojedyncze sondy (`:52-104`): tylko typ = 35, tylko cena = 35, staż 1/4/10/25, granice ceny min/max i ±1, komplet 100, bramka miasta, niepełny profil **tylko** przez `experience_years = null` (`:103-104`). Sekcje `:36-122` idą jako `postgres` z claims; `set local role authenticated` dopiero od `:145`.
- Kolejność (`:131-165`): B 100/25 lat, A 100/10 lat, D i C 85/5 lat z ręcznym `created_at` (`:139-142`); oczekiwane B, A, D.
- Obca oferta → 0 wierszy (`:221-230`), granty (`:246-254`).

`supabase/tests/invitation-response.sql:101-112`: po odrzuceniu B, C, D; asercja sortuje `array_agg(... order by r.score desc)` (`:101`), więc nie sprawdza kolejności zwróconej przez funkcję — działa tylko, bo wyniki są różne.

Luki względem wyroczni: staż 5 i 15 w izolacji; remis wyniku z różnych składników; remis stażu po capie; mieszana pula miasto/spoza miasta (US-01); wynik 0 rywalizujący o miejsce; niepełny profil przez brak ceny/typu; „mniej niż 3”; brak jakiegokolwiek testu przez prawdziwą sesję i PostgREST.

### 4. Powierzchnia dostępu (stan po 8 migracjach)

Tabele (RLS włączone we wszystkich; anon: `revoke all`):

| Tabela | Granty `authenticated` | Polityki |
|---|---|---|
| `profiles` | select wszystkie kolumny; update tylko 5 kolumn profilu (`add_agent_profile.sql:40`) | SELECT `auth.uid() = id` (`create_profiles.sql:14-17`); UPDATE własny wiersz i `role='agent'` (`add_agent_profile.sql:44-48`); brak INSERT/DELETE |
| `offers` | select; insert/update tylko kolumn treści (`create_offers.sql:43`, `owner_offer_management.sql:14`); delete (`:16`) | SELECT własne (`create_offers.sql:47-50`) lub zaproszony agent ze statusem pending/accepted (`create_invitations.sql:47-57`); INSERT `owner_id = auth.uid()` + rola owner (`create_offers.sql:53-62`); UPDATE własne w draft/seeking_agent (`owner_offer_management.sql:18-22`); DELETE własne (`:24-27`) |
| `invitations` | tylko select (`create_invitations.sql:31-33`) | SELECT jako owner (`:35-38`) lub jako agent (`:40-43`) |

RPC (wszystkie SECURITY DEFINER, `search_path = ''`, EXECUTE odebrane `public, anon`): `rank_agents_for_offer` (cudza oferta → 0 wierszy), `invite_agent` (`for update ... owner_id = auth.uid()` → `not_found`, `create_invitations.sql:77-85`), `respond_to_invitation` (bez zaproszenia → `not_found`, `invitation_response.sql:96-104`), `delete_own_account` (bez argumentu). Funkcje wyzwalaczy mają odebrane EXECUTE także dla `authenticated` (`create_profiles.sql:38`, `account_deletion.sql:29`).

Endpointy `/api/*` (wszystkie z sesją użytkownika i kluczem anon, `src/lib/supabase.ts:6-10`): id od klienta przyjmują `api/owner/offers/update.ts` (`offerId`), `api/owner/offers/delete.ts` (`offerId`), `api/owner/invitations.ts` (`offerId`, `agentId`), `api/agent/invitations.ts` (`offerId`); przy cudzym id każdy zwraca 404 (RLS/RPC daje 0 wierszy albo `not_found`). Strony z id z URL: `owner/offers/[id].astro`, `owner/offers/[id]/edit.astro`, `agent/offers/[id].astro` → 404.

Zaakceptowane, celowe ujawnienia (nie traktować jako błąd testu, ale udokumentować): `owner_id` w `offers`/`invitations` przez REST dla zaproszonego agenta (agent-invitation F4), `agent_id`/staż/miasta agentów z RPC dla właściciela własnej oferty (offer-top3-ranking F3), krótka blokada `for update` cudzej oferty w `respond_to_invitation` (invitation-response F3).

### 5. Co dziś pokrywa izolację

- SQL (podszywanie przez `set local role` + claims, np. `agent-profile.sql:87-88`): obcy owner nie widzi ofert ani rankingu (`offer-ranking.sql:209-230`); `invite_agent` cudzej oferty → `not_found` (`agent-invitation.sql:124-145`); widoczność ofert/zaproszeń dla agenta zaproszonego/niezaproszonego/odrzuconego (`:149-186`, `:228-242`); obcy owner nie aktualizuje/nie usuwa oferty (`owner-offer-management.sql:107-184`); agent A nie aktualizuje profilu B (`agent-profile.sql:105`).
- Smoke (`scripts/smoke.mjs`, osobne cookie jary `:93-130`): drugi owner → 404 na stronę oferty, zaproszenie, edycję, update, delete (`:331, :356, :568, :573, :626`); agent → 404 bez zaproszenia i po odrzuceniu (`:400, :421, :431`); 403 przy zamianie ról.
- Luki (dla etapu 1): (a) brak prawdziwego JWT B wobec PostgREST: `GET /rest/v1/offers?id=eq.<A>`, `invitations`, `profiles?id=eq.<A>`, `PATCH`/`DELETE` cudzych wierszy, `rpc/rank_agents_for_offer` i `rpc/invite_agent` na ofertę A; (b) brak testu, że użytkownik nie czyta cudzego wiersza `profiles`; (c) brak przypadku agent B kontra agent A przy tym samym właścicielu; (d) brak kontroli pozytywnej w tym samym teście (A widzi swoje dane) — wymagana przez `test-plan.md:32`. `/api/*` z cudzym id jest już pokryte przez smoke; ponowne pokrycie przez HTTP wymagałoby serwera w teście.

### 6. Runner, sesje, env, limity

- `vitest.config.ts` z `defineConfig` z `vitest/config`, `environment: 'node'`. Vitest nie czyta `paths` z tsconfig — alias `@/` trzeba dodać ręcznie, a import `src/lib/supabase.ts` odpada, bo zależy od `astro:env/server`. Typy wyników przez `Database` z `src/db/database.types.ts` (reguły `no-unsafe-*` z `strictTypeChecked`).
- Dwie sesje = dwa klienty `createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })`.
- Env: `.env.example` ma `SUPABASE_URL`, `SUPABASE_KEY`; w CI `supabase.env` daje `API_URL`, `ANON_KEY` (`ci.yml:42`). `service_role` niepotrzebny ani do seedu, ani do sprzątania.
- Limit auth: `sign_in_sign_ups = 30` na 5 minut na IP (`supabase/config.toml:190`). Smoke wysyła 6 żądań signup (`smoke.mjs:138,148,153,216,324,719`) i 8 signin (`:158,163,287,732,743,762,778,783`) = 14. Tabela przypadków rankingu potrzebuje ~6–8 agentów + 1 właściciela, izolacja ~2 właścicieli + 2 agentów; w tym samym jobie i oknie 5 minut suma może się zbliżyć do 30. Wniosek (nie zmierzone): współdzielić konta między przypadkami (jedna pula agentów, kilka ofert) albo podnieść limit w lokalnym `config.toml` (dotyczy tylko lokalnego/CI Supabase).
- Unikalne e-maile wzorem `smoke-${Date.now()}@example.com` (`smoke.mjs:7-13`).

### 7. Break-check (#6)

Testy przez PostgREST widzą tylko zatwierdzone zmiany, więc break-check nie może iść w transakcji z rollback (jak testy SQL). Wniosek: zepsucie = `psql` przez `docker exec` z `create or replace` funkcji z odwróconym tie-breakiem (np. `experience_years asc`) albo `drop policy profiles_select_own` / `offers_select_own`, uruchomienie testów (oczekiwany czerwony), przywrócenie przez ponowne wykonanie definicji z pliku migracji. `npx supabase db reset` też przywraca, ale kasuje lokalne konta (uprzedzić użytkownika).

## Code References

- `supabase/migrations/20261028200000_invitation_response.sql:21-57` — `rank_agents_for_offer` (aktualna wersja)
- `supabase/migrations/20261028100000_add_agent_profile.sql:30-48` — `profile_complete`, grant kolumnowy, polityka update profilu
- `supabase/migrations/20261027150939_create_profiles.sql:14-43` — polityka select profilu, trigger `handle_new_user`
- `supabase/migrations/20261028140000_create_offers.sql:38-62` — RLS i granty `offers`
- `supabase/migrations/20261028180000_create_invitations.sql:28-113` — RLS `invitations`, `invite_agent`
- `supabase/migrations/20261028220000_account_deletion.sql:54-79` — `delete_own_account`
- `supabase/migrations/20261029100000_owner_offer_management.sql:14-27` — update/delete ofert
- `src/pages/owner/offers/[id].astro:55-57` — wywołanie rankingu z sesją użytkownika
- `supabase/tests/offer-ranking.sql:14,131-165,221-230` — obecne testy rankingu
- `scripts/smoke.mjs:50-56,230-238` — izolacja smoke od pozostałości; agent ze wszystkimi miastami
- `supabase/config.toml:190,209` — limit auth, wyłączone potwierdzenia
- `.github/workflows/ci.yml:26-64` — job `smoke` z lokalnym Supabase
- `tsconfig.json:3`, `eslint.config.js:17-22` — testy objęte type-check i lintem

## Architecture Insights

- Cała autoryzacja danych siedzi w bazie (RLS + SECURITY DEFINER z `auth.uid()`); Astro nie ma klucza `service_role`. Test na poziomie PostgREST z prawdziwym JWT sprawdza więc tę samą bramkę, z której korzystają `/api/*` i strony.
- Funkcja rankingu jest jednocześnie regułą biznesową i bramką `invite_agent`; błąd w rankingu psuje też zaproszenia.
- Konwencja projektu: testy SQL dla RLS/RPC (`test-plan.md:107-110`), smoke dla ścieżek HTTP. Etap 1 dodaje trzecią warstwę: integracja przez supabase-js z prawdziwymi sesjami.

## Historical Context (from prior changes)

- `context/archive/2026-10-28-offer-top3-ranking/reviews/plan-review.md:25-33` (F1) — w transakcji `now()` jest stałe, remis rozstrzygało `id asc`; poprawka: ręczny `created_at`. Wspiera wybór prawdziwych sesji dla O7.
- `context/archive/2026-10-28-offer-top3-ranking/reviews/impl-review.md:38-46` (F1) — usunięcie `experience_years desc` nie psuło testu; poprawka: zamiana staży, break-check potwierdzony (`plan.md:315`). Precedens dla #6.
- `context/archive/2026-10-28-offer-top3-ranking/reviews/impl-review.md:58-75` (F3) — enumeracja profili przez RPC, ACCEPTED; follow-up skierowany do M3.
- `context/archive/2026-10-28-agent-invitation/reviews/impl-review.md:82-90` (F4) — `owner_id` widoczny przez REST dla agenta, ACCEPTED, grant nadal na całą tabelę.
- `context/archive/2026-10-27-role-based-signup/reviews/impl-review.md:74-80` (F4) — `/api/*` nie bramkowane w middleware; naprawione tylko dokumentacją, kontrola w każdym endpoincie.
- `context/archive/2026-10-28-invitation-response/reviews/plan-review.md:35-42` (F2) — w CI ranking po odrzuceniu był pusty (świeża baza bez agentów).
- Brak wcześniejszej decyzji o frameworku testów w `context/archive/**` (grep `vitest|test framework|runner`); jedyne wzmianki to `test-plan.md:49,58`.

## Related Research

- `context/archive/2026-10-28-offer-top3-ranking/research.md`
- `context/archive/2026-10-29-owner-offer-management/research.md`

## Open Questions

1. **Izolacja testu rankingu od pozostałości w bazie** (decyzja do planu). Opcje: (a) strażnik na starcie — oferta-sonda w wybranym mieście musi dać pusty ranking, inaczej test kończy się czytelnym błędem „brudna baza” (nie fałszywym zielonym); (b) przypadki odporne na obcych (wysoki staż i unikalna cena jak smoke) — nie da się tak sprawdzić niskich wyników ani O5; (c) wymaganie `db reset` lokalnie (kasuje konta). Rekomendacja badacza: (a) + miasto nieużywane przez smoke; w CI baza jest świeża, bo testy SQL robią rollback, a smoke idzie po teście.
2. **Czy etap 1 testuje `/api/*` przez HTTP**, czy tylko PostgREST/RPC. Smoke już pokrywa 404 na cudze id w endpointach; HTTP w teście wymaga serwera (`npm run preview` w CI startuje dopiero `ci.yml:60`). Rekomendacja: tylko PostgREST/RPC, z notą, że `/api/*` pokrywa smoke.
3. **Włączność granic ceny** — kod `between` (włącznie); PRD milczy. Potwierdzić jako regułę produktu przed zapisaniem w tabeli przypadków.
4. ~~Default `status` nowej oferty~~ — rozstrzygnięte: `seeking_agent` (`create_offers.sql:18`), `owner_id` z `auth.uid()` (`:10`).
5. **Budżet limitu auth** w jobie `smoke` (30 / 5 min / IP) — liczba kont w tabeli przypadków zależy od planu; mierzyć przy implementacji.
