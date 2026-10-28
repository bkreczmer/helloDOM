---
date: 2026-10-28T13:05:08+0100
researcher: Claude (Opus 5.5) dla bkreczmer
git_commit: 58f5ab5
branch: main
repository: helloDOM
topic: "S-03 offer-top3-ranking: oferta właściciela i ranking top 3 agentów z wynikiem 0–100"
tags: [research, offers, ranking, scoring, rls, security-definer, supabase, forms]
status: complete
last_updated: 2026-10-28
last_updated_by: Claude (Opus 5.5)
last_updated_note: "Pierwsza wersja."
---

# Research: S-03 offer-top3-ranking

**Date**: 2026-10-28T13:05:08+0100
**Researcher**: Claude (Opus 5.5) dla bkreczmer
**Git Commit**: 58f5ab5
**Branch**: main
**Repository**: helloDOM

## Research Question

Co w obecnym kodzie i dokumentach określa, jak zbudować S-03: zalogowany właściciel dodaje ofertę (wymagane: miasto, typ, cena, transakcja; opcjonalne: metraż, pokoje, opis) i po zapisaniu widzi do 3 agentów z wynikiem 0–100 albo komunikat, gdy dopasowanych jest mniej niż 3. (Źródło: `context/foundation/roadmap.md:114-125`, PRD FR-003, FR-008, US-01.)

## Summary

- **Nie ma jeszcze nic po stronie ofert.** W schemacie `public` jest jedna tabela, `profiles` (sprawdzone zapytaniem do `pg_tables` na lokalnej bazie, 2026-10-28). Brak tabeli ofert, serwisu, endpointu i stron; `/owner` to placeholder (`src/pages/owner/index.astro:8-13`), a nawigacja właściciela ma jedną pozycję „Panel” (`src/components/shell/nav.ts:12-18`).
- **Dane agenta do rankingu już są** jako kolumny `profiles` (`cities text[]`, `property_types text[]`, `price_min`, `price_max`, `experience_years`) i generowana kolumna `profile_complete` (`supabase/migrations/20261028100000_add_agent_profile.sql:7-37`). Wspólny słownik slugów i etykiet jest w `src/lib/dictionaries.ts:9-57`, a te same slugi pilnują check constrainty (`add_agent_profile.sql:15-24`).
- **Główna przeszkoda techniczna: właściciel nie może czytać profili agentów.** Jedyna polityka select na `profiles` to `auth.uid() = id` (`create_profiles.sql:14-17`). Sprawdzone lokalnie w transakcji z rollback: właściciel przez RLS widzi 0 wierszy agentów i 1 własny. Archiwum przypisuje to S-03 „razem z regułą wyniku” (`context/archive/2026-10-28-agent-profile/plan.md:35`). Rekomendacja: funkcja SQL `security definer`, która sprawdza, że oferta należy do wołającego, i zwraca tylko wynik oraz minimum danych agenta (szczegóły niżej). Polityka select dla właścicieli na wierszach agentów odsłoniłaby wszystkie kolumny wszystkich agentów każdemu właścicielowi.
- **Agent nie ma żadnego pola identyfikującego poza e-mailem w `auth.users`.** `profiles` nie ma imienia ani nazwy (`src/db/database.types.ts:38-72`, kolumny `id, role, created_at` + 6 kolumn profilu), signup nie zbiera nazwy. Ranking musi więc pokazać e-mail agenta, dodać pole nazwy albo pokazać agenta anonimowo do czasu zaproszenia. To decyzja produktowa (Open Questions 1).
- **Reguła wyniku jest w pełni określona** (PRD Business Logic, `prd.md` sekcja „Business Logic”) i daje liczby całkowite: miasto = bramka, typ 35, cena w przedziale 35, doświadczenie `3 × min(lata, 10)`. Remisy: więcej lat, potem wcześniejsza rejestracja (`profiles.created_at`).
- **Otwarty wybór statusu po zapisie** („szkic” od razu czy „szuka agenta”) — nieblokujący, właściciel: użytkownik (`roadmap.md:123`).

## Detailed Findings

### Reguła wyniku (PRD)

- Bramka: agent, który nie obsługuje miasta oferty, ma 0 (PRD Business Logic; `shape-notes.md:147-151`).
- Punkty sumują się: typ obsługiwany → 35; cena w przedziale agenta → 35, poza nim 0; doświadczenie liniowo do 10 lat, 10+ = 30. Przy `experience_years integer` (`add_agent_profile.sql:12`) to `3 × least(experience_years, 10)`, więc wynik jest całkowity w zbiorze 0–100.
- Granice przedziału włącznie (cena równa `price_min` lub `price_max` daje 35) — decyzja z S-02 (`context/archive/2026-10-28-agent-profile/plan-brief.md:24`, wg raportu przeglądu archiwum). Jeden przedział agenta niezależnie od transakcji (`roadmap.md:197`, Parked).
- Pokazywani są tylko agenci z wynikiem > 0, najwyżej 3; mniej niż 3 → komunikat (FR-008). Wniosek: agent obsługujący miasto, ale z innym typem, ceną poza przedziałem i 0 lat ma 0 i nie jest pokazywany, mimo że przeszedł bramkę.
- Sortowanie: wynik malejąco, potem `experience_years` malejąco, potem data rejestracji rosnąco. Data rejestracji to `profiles.created_at` (default `now()` w chwili triggera po insert do `auth.users`, `create_profiles.sql:8`, `:40-43`). Przy identycznym `created_at` PRD nie podaje dalszego kryterium; `id` jako ostatni klucz daje deterministyczną kolejność (wniosek, nie wymóg).
- Do rankingu trafiają tylko `role = 'agent' and profile_complete` (`add_agent_profile.sql:31-37`; serwis wprost mówi, że ranking polega na kolumnie, nie na funkcji TS: `src/lib/services/agent-profile.ts:74-77`).
- Wykluczenie agentów, którzy odrzucili zaproszenie (FR-011), wymaga tabeli zaproszeń, której jeszcze nie ma; należy do S-05/S-06 (`roadmap.md` S-06). S-03 może zostawić w funkcji miejsce na ten warunek, ale nie ma czego filtrować.
- Kryterium akceptacji US-01: agent z miasta oferty jest wyżej niż agent spoza miasta — przy bramce spełnione trywialnie, bo agent spoza miasta ma 0 i w ogóle nie jest pokazywany.

### Dostęp do danych: tabela ofert i odczyt profili

- Wzorzec RLS z repo: `enable row level security`, `revoke all ... from anon, authenticated`, wąskie granty, polityki per operacja i rola z `(select auth.uid())` (`create_profiles.sql:11-22`; `add_agent_profile.sql:39-48`). CLAUDE.md wymaga RLS na każdej nowej tabeli; właściciel widzi tylko swoje oferty, agent tylko te, do których go zaproszono (PRD Guardrails).
- Dla tabeli ofert w S-03: polityki select/insert dla właściciela na `owner_id = auth.uid()`, z warunkiem roli `owner` (wzorzec roli w polityce: `add_agent_profile.sql:44-48`). Agent nie dostaje żadnego dostępu do ofert w S-03 (dostęp przez zaproszenie to S-05). Update/delete należą do S-04 (FR-005, FR-006), więc w S-03 można ich nie grantować.
- Odczyt profili agentów przez właściciela — dwie opcje znane z archiwum (`agent-profile/research.md:65`):
  - **Funkcja `security definer`** (np. `rank_agents_for_offer(offer_id uuid)`), `set search_path = ''`, `execute` odebrane z `public, anon` i nadane `authenticated`. Funkcja sprawdza `offers.owner_id = auth.uid()` i zwraca tylko kolumny potrzebne w widoku (id agenta, wynik, ewentualnie identyfikator do wyświetlenia), już posortowane i obcięte do 3. Wzorzec definer w repo: `create_profiles.sql:24-38` (tam `execute` odebrane wszystkim, bo to trigger). Wynik liczony w SQL jest jednym źródłem prawdy i daje się testować w `supabase/tests/*.sql`.
  - **Polityka select dla właścicieli na wierszach agentów** — prostsza, ale odsłania wszystkie kolumny wszystkich agentów każdemu właścicielowi (profil to cały wiersz `profiles`) i przenosi regułę wyniku do TS. Słabsza wobec Guardrails; nie rekomenduję.
- `service_role` w Workerze: niedopuszczalne do tego celu (CLAUDE.local: klucz `service_role` nigdy w kliencie; roadmapa traktuje dodatkowy sekret jako osobną decyzję S-07).
- Nazwa agenta: e-mail jest tylko w `auth.users`; funkcja definer mogłaby go zwrócić (`auth.users.email`), ale to ujawnienie danych kontaktowych przed zaproszeniem. Alternatywa: nowa kolumna np. `display_name` w `profiles` (zmiana profilu z S-02 i signup/profile form) albo etykieta „Agent 1/2/3” + dane profilu (miasta, staż). Open Questions 1.

### Model oferty (z PRD)

- Pola wymagane: miasto (slug z `CITIES`), typ (slug z `PROPERTY_TYPES`), cena (liczba całkowita PLN), transakcja (sprzedaż/wynajem) — FR-003. Opcjonalne: metraż, liczba pokoi, opis.
- Transakcja nie ma jeszcze słownika w kodzie; `src/lib/dictionaries.ts` ma tylko miasta i typy. Wzorzec: stała `as const` + etykiety PL w `dictionaries.ts`, typ w `src/types.ts:8-10`, check w SQL.
- Cena: profil używa `integer` z górną granicą `MAX_PRICE = 2_147_483_647` (`src/lib/services/agent-profile.ts:6-7`); ta sama skala dla ceny oferty pozwala porównywać bez rzutowań. Metraż może wymagać ułamków (np. 48,5 m²) — PRD nie precyzuje typu (decyzja planu).
- Statusy z PRD: szkic → szuka agenta → zaproszenie wysłane → w obsłudze (`prd.md` Success Criteria; `shape-notes.md:81`). S-03 tworzy kolumnę statusu; jej pełny zbiór warto ustalić teraz, żeby S-04/S-05 nie zmieniały checka.
- Otwarte: czy zapis tworzy ofertę od razu w „szuka agenta” (krótsza droga do rankingu, zgodna z „3 akcje”) czy w „szkicu” z osobną akcją (`roadmap.md:123`). Czy ranking pokazuje się też dla szkicu — PRD mówi „po zapisaniu oferty” bez warunku statusu (PRD Business Logic, ostatnie zdanie).

### UI i wzorce formularzy

- Formularz profilu to wyspa React z natywnym POST do `/api/agent/profile`, walidacją zod po stronie serwera i redirectem z `?error=<kod>` / `?saved=1` (`src/pages/api/agent/profile.ts:5-62`, `src/pages/agent/profile.astro:36-37`). Mapowanie kodu błędu na polski komunikat bez przepuszczania tekstu z URL: `src/lib/services/agent-profile.ts:87-105`.
- Komponenty do ponownego użycia: `ChoiceChips` (multi-select, zbudowany ogólnie z myślą o formularzu oferty — `agent-profile/plan.md:239`; `src/components/agent/ChoiceChips.tsx:23-25`), `FormField`, `SubmitButton`, `ServerError`, `useNativeSubmitting` (`src/components/agent/AgentProfileForm.tsx:3-8`). Miasto, typ i transakcja w ofercie są jednokrotnego wyboru, więc `ChoiceChips` (checkboxy) nie pasuje 1:1 — potrzebny select albo wariant radio (design system ma Input/Select/Textarea 38 px, `design-system.md:106`; Badge `:107` może posłużyć do wyniku).
- Nowe strony muszą być pod `/owner/*` (CLAUDE.md, `src/lib/route-guard.ts:4-7`); middleware gwarantuje tam zalogowanego właściciela (`src/middleware.ts:48-51`). Endpoint pod `/api/*` sam sprawdza `locals.user` i rolę z `profiles` (`src/pages/api/agent/profile.ts:12-29`).
- Nawigacja: `navFor('owner')` zwraca tylko „Panel” (`src/components/shell/nav.ts:12-18`); dock mieści do 5 pozycji (`:20-21`).

### Testy i CI

- CI uruchamia każdy `supabase/tests/*.sql` przez psql po `supabase start` (`.github/workflows/ci.yml:43-49`) — nowy plik (np. `offer-ranking.sql`) wejdzie automatycznie. Wzorzec: `supabase/tests/agent-profile.sql:8-137` (transakcja z rollback, asercje w `do $$`, przełączanie na `authenticated` + `request.jwt.claims`).
- CI sprawdza aktualność typów: `npm run db:types && git diff --exit-code` (`ci.yml:50-51`). Funkcja RPC pojawi się w `Database["public"]["Functions"]` (dziś puste: `database.types.ts:77-79`), co da typowane `supabase.rpc(...)`.
- Smoke (`scripts/smoke.mjs`, lista kroków od `:82`) testuje dziś auth i zapis profilu agenta; nowy endpoint oferty powinien dostać kroki (właściciel zapisuje ofertę → 302 na stronę rankingu; agent dostaje 403).
- Reguła wyniku to ryzyko z roadmapy (`roadmap.md:124`: „błąd w regule podważa cały produkt”) — test SQL na funkcji z zestawem agentów pokrywającym bramkę miasta, każdy składnik punktów, granice przedziału, cap 10 lat, wynik 0 (ukryty), remisy (lata, potem `created_at`), niepełny profil i obcą ofertę (wywołanie przez innego właściciela zwraca 0 wierszy lub błąd).

## Code References

- `supabase/migrations/20261027150939_create_profiles.sql:14-17` — jedyna polityka select na `profiles` (własny wiersz).
- `supabase/migrations/20261027150939_create_profiles.sql:24-38` — wzorzec funkcji `security definer` z `search_path = ''`.
- `supabase/migrations/20261028100000_add_agent_profile.sql:7-48` — kolumny profilu, checki słownika, `profile_complete`, grant kolumnowy, polityka update.
- `src/lib/dictionaries.ts:9-57` — slugi i etykiety miast i typów.
- `src/lib/services/agent-profile.ts:6-49` — zod dla liczb całkowitych z formularza, `MAX_PRICE`.
- `src/lib/services/agent-profile.ts:74-77` — ranking ma polegać na kolumnie `profile_complete`.
- `src/pages/api/agent/profile.ts:5-62` — wzorzec endpointu POST z kontrolą roli i redirectami błędów.
- `src/pages/owner/index.astro:8-13` — placeholder panelu właściciela.
- `src/components/shell/nav.ts:12-18` — nawigacja ról.
- `src/types.ts:8-26` — typy słownika i DTO.
- `supabase/tests/agent-profile.sql` — wzorzec testu SQL.
- `.github/workflows/ci.yml:43-51` — testy SQL i kontrola typów w CI.

## Architecture Insights

- Reguły danych żyją w Postgresie (checki, kolumna generowana, RLS), a TS je odzwierciedla do UI. Ranking w funkcji SQL jest zgodny z tym podziałem: jedno źródło reguły, testowalne w CI bez frameworka testowego.
- Słownik ma trzy kopie (TS, check SQL, smoke); transakcja oferty doda czwarty słownik w tym samym wzorcu.
- Endpointy formularzy działają bez JS (natywny POST + redirect), wyspy React tylko dla stanu i walidacji po stronie klienta.

## Historical Context (from prior changes)

- `context/archive/2026-10-27-role-based-signup/plan.md:48` — odczyt cudzych profili odłożony do „S-02/S-03”. Werdykt: nadal otwarte, należy do S-03.
- `context/archive/2026-10-28-agent-profile/plan.md:35` — „Odczyt profili agentów przez właścicieli (polityka lub funkcja `security definer`) — powstaje w S-03 razem z regułą wyniku.” Werdykt: wiążące co do właściciela (S-03); wybór mechanizmu otwarty.
- `context/archive/2026-10-28-agent-profile/plan.md:239` — `ChoiceChips` ogólny dla formularza oferty. Werdykt: komponent istnieje, ale jest wielokrotnego wyboru.
- `context/archive/2026-10-28-agent-profile/research.md:144` (pytanie o przedział cen a transakcję) — rozstrzygnięte: jeden przedział, osobne przedziały w Parked (`roadmap.md:197`).
- `context/archive/2026-10-28-agent-profile/plan-brief.md:24` — granice ceny włącznie, całe PLN, lata 0–60 (wg przeglądu archiwum przez subagenta; nie czytane bezpośrednio).

## Related Research

- `context/archive/2026-10-28-agent-profile/research.md`
- `context/archive/2026-10-27-role-based-signup/research.md`

## Open Questions

1. **Jak właściciel identyfikuje agenta w rankingu?** W bazie nie ma nazwy agenta. Opcje: (a) e-mail z `auth.users` zwracany przez funkcję definer — zero zmian w profilu, ale ujawnia kontakt przed zaproszeniem; (b) nowa kolumna `display_name` w profilu agenta (zmiana formularza S-02, dodatkowe pole w `profile_complete`?); (c) bez danych osobowych do czasu zaproszenia — „Agent” + staż, miasta, wynik. Wpływa na schemat i zakres S-03. Właściciel: użytkownik.
2. **Status oferty po zapisie**: od razu „szuka agenta” czy „szkic” z osobną akcją (`roadmap.md:123`). Właściciel: użytkownik, nieblokujące.
3. **Metraż**: liczba całkowita czy z ułamkiem; liczba pokoi całkowita ≥ 1? Decyzja planu.
4. **Czy ranking jest liczony na żywo przy każdym wejściu na stronę oferty** (zmienia się, gdy agenci edytują profile) czy zapisywany przy zapisie oferty. PRD nie mówi; FR-011 („wypada z rankingu, jego miejsce zajmuje kolejny”) sugeruje liczenie na żywo. Decyzja planu.
5. **Gdzie właściciel widzi ranking**: strona `/owner/offers/[id]` po redirecie z zapisu vs na `/owner`. S-04 doda listę ofert; trasa szczegółu warto ustalić teraz. Decyzja planu.
