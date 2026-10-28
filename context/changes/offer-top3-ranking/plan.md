# Oferta i ranking top 3 — Implementation Plan

## Overview

Zalogowany właściciel dodaje ofertę (wymagane: miasto, typ, cena, transakcja; opcjonalne: metraż, pokoje, opis). Oferta zapisuje się od razu w statusie „szuka agenta”, a właściciel trafia na jej stronę z top 3 agentów z wynikiem 0–100 albo z komunikatem, gdy dopasowanych agentów jest mniej niż 3. Ranking liczy funkcja SQL `security definer`; agent w rankingu jest anonimowy (wynik, staż, miasta). To gwiazda przewodnia MVP (S-03, US-01, FR-003, FR-008).

## Current State Analysis

- Po stronie ofert nie ma nic: w `public` jest tylko `profiles`; `/owner` to placeholder (`src/pages/owner/index.astro:8-13`), nawigacja właściciela ma jedną pozycję „Panel” (`src/components/shell/nav.ts:12-18`).
- Dane agenta do rankingu są w `profiles` (`cities`, `property_types`, `price_min`, `price_max`, `experience_years`, generowana `profile_complete`) — `supabase/migrations/20261028100000_add_agent_profile.sql:7-37`.
- Właściciel nie może czytać profili agentów: jedyna polityka select to `auth.uid() = id` (`supabase/migrations/20261027150939_create_profiles.sql:14-17`). Archiwum S-02 przypisało rozwiązanie tego do S-03 (`context/archive/2026-10-28-agent-profile/plan.md:35`).
- Agent nie ma w `profiles` żadnego pola identyfikującego; e-mail jest tylko w `auth.users`.
- Słownik miast i typów: `src/lib/dictionaries.ts:9-57`; transakcji jeszcze nie ma.
- Wzorce: endpoint formularza z kontrolą roli i redirectem `?error=<kod>` (`src/pages/api/agent/profile.ts:5-62`), mapowanie kodu na komunikat (`src/lib/services/agent-profile.ts:87-105`), wyspa formularza z walidacją klienta i `useNativeSubmitting` (`src/components/agent/AgentProfileForm.tsx`), karty radio (`src/components/auth/RoleChoice.tsx`), test SQL w transakcji z rollback (`supabase/tests/agent-profile.sql`), smoke (`scripts/smoke.mjs`).

## Desired End State

- Właściciel na `/owner` widzi przycisk „Dodaj ofertę” i prostą listę swoich ofert (miasto, typ, transakcja, cena, data) z linkiem do rankingu każdej z nich; bez ofert — stan pusty.
- `/owner/offers/new` zawiera formularz oferty; po zapisie właściciel trafia na `/owner/offers/<id>?created=1`.
- `/owner/offers/<id>` pokazuje podsumowanie oferty i do 3 agentów („Agent 1/2/3”, wynik `NN/100`, staż, obsługiwane miasta), posortowanych zgodnie z regułą PRD; przy mniej niż 3 agentach — komunikat. Cudza lub nieistniejąca oferta → 404.
- Reguła wyniku żyje wyłącznie w funkcji `public.rank_agents_for_offer` i jest pokryta testem `supabase/tests/offer-ranking.sql` uruchamianym w CI.

### Key Discoveries:

- Wzorzec `security definer` z `set search_path = ''` i odebranym `execute`: `create_profiles.sql:24-38`.
- Grant kolumnowy jako sposób na niezmienne kolumny: `add_agent_profile.sql:39-41` — tu użyty dla `insert`, żeby właściciel nie ustawiał `owner_id` ani `status`.
- Ranking ma polegać na kolumnie `profile_complete`, nie na funkcji TS: `src/lib/services/agent-profile.ts:74-77`.
- CI uruchamia każdy `supabase/tests/*.sql` i sprawdza aktualność typów: `.github/workflows/ci.yml:43-51`.
- Strony aplikacji muszą być pod `/owner/*`; `/api/*` sam sprawdza sesję i rolę (CLAUDE.md, `src/lib/route-guard.ts:4-7`).

## What We're NOT Doing

- Edycja, usuwanie, pełna lista ze statusami i filtrami (S-04). Lista na `/owner` jest minimalna: bez statusu, bez akcji.
- Status „szkic” i przejście szkic → szuka agenta: kolumna dopuszcza `draft`, ale S-03 zawsze zapisuje `seeking_agent`.
- Zaproszenia i wykluczanie agentów, którzy odrzucili zaproszenie (S-05, S-06) — funkcja nie ma jeszcze czego filtrować.
- Jakiekolwiek dane osobowe agenta w rankingu (e-mail, nazwa) i nowa kolumna nazwy w profilu.
- Uzasadnienie wyniku (FR-013, Parked), zapisywanie wyniku w bazie (ranking liczony na żywo).
- Klucz `service_role` w Workerze.

## Implementation Approach

Najpierw schemat i reguła wyniku w SQL z testem — to największe ryzyko slice'a i jedno źródło prawdy. Potem zapis oferty (serwis zod + endpoint + formularz) według wzorca profilu agenta. Na końcu strona rankingu, panel właściciela i nawigacja. Ranking jest liczony przy każdym wejściu na stronę oferty, więc zmiany profili agentów (i w przyszłości odrzucenia zaproszeń) od razu go zmieniają.

## Critical Implementation Details

- **Zakres rankingu w funkcji definer**: funkcja omija RLS, więc sama musi zawęzić ofertę do `owner_id = (select auth.uid())` i agentów do `role = 'agent' and profile_complete`. Dla cudzej oferty zwraca 0 wierszy (nie błąd); rozróżnienie „brak oferty” vs „brak agentów” robi strona, czytając ofertę przez RLS przed wywołaniem RPC.
- **Kolejność filtrów**: bramka miasta (`o.city = any(p.cities)`) w `where`, filtr `score > 0` na wyliczonym wyniku (podzapytanie/CTE), dopiero potem `order by` i `limit 3` — inaczej agent z wynikiem 0 mógłby zająć miejsce w top 3.
- **Identyfikator oferty z URL**: przed zapytaniem zwaliduj UUID (zod `uuid()`), bo zły format daje błąd Postgresa `22P02`, a ma dać 404.

## Phase 1: Schemat i reguła wyniku

### Overview

Tabela `offers` z RLS dla właściciela i funkcja `rank_agents_for_offer` z regułą PRD, pokryte testem SQL; typy wygenerowane.

### Changes Required:

#### 1. Migracja

**File**: `supabase/migrations/20261028140000_create_offers.sql`

**Intent**: Utworzyć tabelę ofert z pełnym zbiorem statusów, checkami słownika i RLS (właściciel widzi i dodaje tylko swoje), oraz funkcję rankingu, która jest jedynym miejscem reguły wyniku. Blok `-- down:` jak w poprzednich migracjach.

**Contract**:
- `public.offers`: `id uuid pk default gen_random_uuid()`, `owner_id uuid not null default auth.uid() references public.profiles(id) on delete cascade`, `city text not null` (check: slug z tej samej listy co `profiles_cities_in_dictionary`), `property_type text not null` (check `apartment|house|plot`), `transaction text not null` (check `sale|rent`), `price integer not null check (price > 0)`, `area_m2 numeric(7,2) null check (area_m2 > 0)`, `rooms integer null check (rooms between 1 and 50)`, `description text null check (char_length(description) <= 2000)`, `status text not null default 'seeking_agent' check (status in ('draft','seeking_agent','invited','in_progress'))`, `created_at timestamptz not null default now()`; indeks na `(owner_id, created_at desc)`.
- RLS włączone; `revoke all ... from anon, authenticated`; `grant select` oraz `grant insert (city, property_type, transaction, price, area_m2, rooms, description)` dla `authenticated` (bez `owner_id`, `status`, `id`, `created_at` — biorą wartości domyślne); `grant all` dla `service_role`. Brak update/delete (S-04).
- Polityki: `offers_select_own` (select, `owner_id = (select auth.uid())`), `offers_insert_own_owner` (insert, `with check` `owner_id = (select auth.uid())` i wołający ma `role = 'owner'` w `profiles`).
- `public.rank_agents_for_offer(p_offer_id uuid) returns table (agent_id uuid, score integer, experience_years integer, cities text[])`, `language sql stable security definer set search_path = ''`. Wynik: `35` za typ w `property_types` + `35` za `price between price_min and price_max` (włącznie) + `3 * least(experience_years, 10)`; tylko agenci z miastem oferty w `cities`, `profile_complete`, `score > 0`; `order by score desc, experience_years desc, created_at asc, id asc limit 3`. `revoke execute ... from public, anon`; `grant execute ... to authenticated`.

#### 2. Test SQL

**File**: `supabase/tests/offer-ranking.sql`

**Intent**: Udowodnić regułę wyniku i granice dostępu w transakcji z rollback, wzorem `supabase/tests/agent-profile.sql` (asercje w `do $$`, przełączanie na `authenticated` z `request.jwt.claims`).

**Contract**: Przypadki co najmniej: bramka miasta (agent spoza miasta nieobecny); każdy składnik osobno (typ 35, cena 35, staż 3/rok); cena równa `price_min` i `price_max` daje 35, o 1 poza — 0; staż 10 i 25 lat → 30; agent w mieście z wynikiem 0 nieobecny; niepełny profil nieobecny; właściciel nie jest agentem w rankingu; remis wyniku → więcej lat wyżej; remis wyniku i lat → wcześniejsze `created_at` wyżej (`created_at` ustawione jawnie w kolejności odwrotnej do `id`, bo `now()` w transakcji jest stałe i bez tego remis rozstrzygnęłoby `id`); więcej niż 3 dopasowanych → dokładnie 3; inny właściciel wołający funkcję dla cudzej oferty → 0 wierszy; checki `offers` odrzucają złe miasto/typ/transakcję/cenę ≤ 0/pokoje 0; insert jako owner ustawia `owner_id = auth.uid()` i `status = 'seeking_agent'`; insert jako agent odrzucony przez RLS; insert z jawnym `status` lub cudzym `owner_id` odrzucony (brak grantu kolumny); owner widzi przez select tylko swoje oferty; `anon` nie ma `execute` funkcji.

#### 3. Typy bazy

**File**: `src/db/database.types.ts`

**Intent**: Wygenerować typy z tabelą `offers` i funkcją w `Functions`, żeby `supabase.rpc("rank_agents_for_offer", …)` było typowane.

**Contract**: `npm run db:types`; brak ręcznych edycji.

### Success Criteria:

#### Automated Verification:

- Migracja stosuje się na czystej bazie: lokalnie `npx supabase migration up` (bez kasowania kont); czystą bazę potwierdza job smoke w CI (`supabase start` stosuje wszystkie migracje)
- Test SQL przechodzi wszystkie asercje: `docker exec -i supabase_db_10x-astro-starter psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/offer-ranking.sql`
- Poprzedni test SQL nadal przechodzi: `supabase/tests/agent-profile.sql`
- Typy są aktualne: `npm run db:types && git diff --exit-code src/db/database.types.ts` po commicie typów
- Typy i lint przechodzą: `npx astro check && npm run lint`

**Implementation Note**: Faza nie ma kroków ręcznych; zgodność listy miast w checku `offers` z `CITIES` sprawdza smoke fazy 2 (pętla po `ALL_CITIES`).

---

## Phase 2: Zapis oferty

### Overview

Właściciel wypełnia formularz na `/owner/offers/new`, endpoint waliduje dane i zapisuje ofertę przez RLS, a potem przekierowuje na stronę oferty.

### Changes Required:

#### 1. Słownik transakcji i typy

**File**: `src/lib/dictionaries.ts`, `src/types.ts`

**Intent**: Dodać czwarty słownik w tym samym wzorcu (`as const` + polskie etykiety) i typy DTO oferty oraz agenta w rankingu.

**Contract**: `TRANSACTIONS = ["sale", "rent"] as const`, `TRANSACTION_LABELS` (`Sprzedaż`, `Wynajem`); w `types.ts`: `Transaction`, `Offer` (id, city, propertyType, transaction, price, areaM2, rooms, description, status, createdAt), `RankedAgent` (agentId, score, experienceYears, cities: City[]). Komentarz o synchronizacji z checkiem migracji `create_offers`.

#### 2. Serwis ofert

**File**: `src/lib/services/offers.ts`

**Intent**: Walidacja formularza zod, mapowanie wierszy na DTO i kody błędów — wzorem `agent-profile.ts`.

**Contract**:
- `offerSchema`: `city`/`propertyType`/`transaction` — `z.enum` ze słowników (wymagane); `price` — wymagana liczba całkowita z cyfr, 1…`MAX_PRICE` (reużyć `MAX_PRICE` z `agent-profile.ts` albo przenieść do wspólnego miejsca); `areaM2` — opcjonalna, `^\d{1,5}([.,]\d{1,2})?$`, przecinek zamieniany na kropkę, > 0; `rooms` — opcjonalna liczba całkowita 1–50; `description` — opcjonalny, przycięty, pusty → `null`, ≤ 2000 znaków. Limity jako eksportowane stałe zgodne z checkami.
- `parseOfferForm(formData)`, `toOffer(row)`, `toRankedAgent(row)` (filtr `isCity` jak w `toAgentProfile`).
- `OFFER_ERROR_CODES = ["invalid_input", "unavailable", "unknown"]`, `offerErrorMessage(code)` — komunikaty po polsku, dowolny tekst z URL nie trafia do UI.

#### 3. Endpoint

**File**: `src/pages/api/owner/offers.ts`

**Intent**: `POST` zapisujący ofertę wzorem `src/pages/api/agent/profile.ts`: brak sesji → `/auth/signin`, rola inna niż `owner` → 403, zły formularz → `?error=invalid_input`.

**Contract**: błędy → `302 /owner/offers/new?error=<kod>`; insert tylko kolumn z grantu (bez `owner_id`, `status`), `.select("id").single()`; sukces → `302 /owner/offers/<id>?created=1`. Błąd insertu (w tym `23514`) → `unknown`.

#### 4. Strona i formularz

**File**: `src/pages/owner/offers/new.astro`, `src/components/owner/OfferForm.tsx`, `src/components/owner/ChoiceCards.tsx` (nowy komponent; `RoleChoice` i `SignUpForm` bez zmian)

**Intent**: Wyspa formularza z walidacją po stronie klienta odpowiadającą schematowi serwera, wysyłana natywnym POST jak `AgentProfileForm`. Miasto — natywny `<select>` (18 opcji) z klasami pola jak w `FormField`; typ i transakcja — karty radio jednokrotnego wyboru w nowym `ChoiceCards` wzorem `RoleChoice`; cena, metraż, pokoje — `FormField`; opis — natywny `<textarea>` z klasami pola jak w `FormField` i licznikiem znaków. W `src/components/ui/` nie ma Select ani Textarea i nie dodajemy ich.

**Contract**: nazwy pól formularza `city`, `propertyType`, `transaction`, `price`, `areaM2`, `rooms`, `description`; limity przekazywane propsami ze strony (wyspa nie bundluje zod); błąd serwera przez `ServerError` z `offerErrorMessage`; fokus na pierwsze błędne pole; `inert` zamiast `disabled` podczas wysyłania; przycisk „Zapisz i pokaż agentów”. Po błędzie serwera formularz startuje pusty (serwer odrzuca tylko dane, które ominęły walidację klienta).

#### 5. Smoke

**File**: `scripts/smoke.mjs`

**Intent**: Pokryć zapis oferty i granice ról na działającym serwerze.

**Contract**: dopuścić oczekiwanie `location` jako wzorzec (np. `locationMatch: RegExp`) i zapamiętać id oferty z `Location`. Kroki: `/owner/offers/new` → 200 dla właściciela; agent na `/owner/offers/new` → 302 `/agent`; poprawna oferta → 302 `^/owner/offers/<uuid>\?created=1$`; oferta w każdym mieście z `ALL_CITIES` → 302 na stronę oferty (druga, niezależna kopia słownika łapie rozjazd z checkiem `offers`); nieznane miasto / brak ceny / cena `0` / metraż `abc` → 302 `/owner/offers/new?error=invalid_input`; agent POST → 403; anonim POST → 302 `/auth/signin`.

### Success Criteria:

#### Automated Verification:

- Typy i lint przechodzą: `npx astro check && npm run lint`
- Build przechodzi: `npm run build`
- Smoke przechodzi na podglądzie: `npm run smoke`

#### Manual Verification:

- Wiersz oferty smoke w bazie ma `status = 'seeking_agent'` i `owner_id` właściciela smoke (psql)
- Formularz na `/owner/offers/new`: walidacja klienta, fokus na błędnym polu, klawiatura na kartach radio i selekcie, 360 px, light/dark

**Implementation Note**: Strona docelowa `/owner/offers/<id>` powstaje w fazie 3 — w tej fazie przekierowanie kończy się 404 w przeglądarce; smoke sprawdza tylko nagłówek `Location`.

---

## Phase 3: Ranking i panel

### Overview

Strona oferty z top 3, panel właściciela z przyciskiem i listą ofert, pozycja w nawigacji.

### Changes Required:

#### 1. Strona oferty z rankingiem

**File**: `src/pages/owner/offers/[id].astro`, `src/components/owner/OfferSummary.astro`, `src/components/owner/RankingList.astro`, `src/components/ui/badge.tsx` (`npx shadcn@latest add badge`)

**Intent**: Odczytać ofertę przez RLS (cudza/nieistniejąca/zły UUID → status 404 z kartą „Nie znaleziono oferty” i linkiem do `/owner`), wywołać RPC rankingu i pokazać wynik. Komponenty bez stanu, więc `.astro`.

**Contract**:
- `?created=1` → komunikat „Zapisano ofertę” (`role="status"`, wzór z `AgentProfileForm`).
- Podsumowanie: miasto, typ, transakcja, cena (format PLN), opcjonalnie metraż, pokoje, opis.
- Agent: etykieta „Agent N” (pozycja), Badge z wynikiem `NN/100`, staż z polską odmianą (`1 rok`, `2–4 lata`, `5+ lat`, z wyjątkami 12–14), obsługiwane miasta jako etykiety ze słownika. Bez e-maila i `agent_id` w HTML poza ewentualnym atrybutem potrzebnym w S-05 (w S-03 — nie renderować).
- 1–2 agentów → lista + komunikat, że dopasowanych agentów jest mniej niż 3; 0 → tylko komunikat, że nie ma jeszcze dopasowanych agentów.
- Błąd RPC → `ServerError` w miejscu rankingu, podsumowanie oferty nadal widoczne.

#### 2. Panel właściciela

**File**: `src/pages/owner/index.astro`

**Intent**: Zastąpić placeholder przyciskiem „Dodaj ofertę” i prostą listą ofert właściciela (najnowsze pierwsze), każda pozycja linkuje do `/owner/offers/<id>`.

**Contract**: select przez RLS `id, city, property_type, transaction, price, created_at` order `created_at desc`; pozycja: miasto, typ, transakcja, cena, data; stan pusty z zachętą do dodania pierwszej oferty; błąd odczytu → `ServerError`.

#### 3. Nawigacja

**File**: `src/components/shell/nav.ts`

**Intent**: Dodać właścicielowi pozycję „Nowa oferta” → `/owner/offers/new` (ikona lucide, np. `FilePlus2`).

**Contract**: `navFor('owner')` zwraca `[Panel, Nowa oferta]`; `isActive` bez zmian (strona oferty `/owner/offers/<id>` nie podświetla „Nowa oferta”, bo ta wskazuje na `/owner/offers/new`).

#### 4. Smoke

**File**: `scripts/smoke.mjs`

**Intent**: Pokryć dostęp do strony oferty.

**Contract**: `session()` zwraca też `body` (tekst odpowiedzi). Oferta do rankingu powstaje po zapisaniu pełnego profilu agenta smoke (warszawa, apartment, 100–900 tys., 5 lat): właściciel dodaje ofertę `warszawa`/`apartment`/`500000`, a strona oferty → 200, body zawiera „Agent 1” i „/100” i nie zawiera `agentEmail` (bez sprawdzania dokładnego wyniku, bo lokalne konta dev mogą wyprzedzić agenta smoke). Dalej: drugi właściciel (nowa sesja + signup) GET tej oferty → 404; GET `/owner/offers/not-a-uuid` → 404; agent → 302 `/agent`; anonim → 302 `/auth/signin`; `/owner` → 200.

### Success Criteria:

#### Automated Verification:

- Typy i lint przechodzą: `npx astro check && npm run lint`
- Build przechodzi: `npm run build`
- Smoke przechodzi na podglądzie, w tym ranking widoczny i bez e-maila agenta: `npm run smoke`
- Test SQL rankingu nadal przechodzi: `supabase/tests/offer-ranking.sql`

#### Manual Verification:

- Ranking dla oferty z 4 lokalnymi agentami (różne wyniki i remis stażu) pokazuje 3 właściwych agentów we właściwej kolejności z wynikami zgodnymi z regułą
- Oferta z 1 dopasowanym agentem pokazuje agenta i komunikat; oferta bez dopasowań pokazuje sam komunikat
- Strona oferty i panel w light/dark i na 360 px; fokus i klawiatura na liście i przycisku
- Na produkcji po deployu: właściciel dodaje ofertę i widzi ranking

**Implementation Note**: Po zielonej weryfikacji automatycznej zatrzymaj się na potwierdzenie kroków ręcznych.

---

## Testing Strategy

### Unit Tests:

- Brak frameworka testowego; reguła wyniku testowana w SQL (`supabase/tests/offer-ranking.sql`) — składniki, granice, cap stażu, wynik 0, remisy, limit 3, niepełny profil, obca oferta, RLS i granty `offers`.

### Integration Tests:

- Smoke: zapis oferty (poprawny, niepoprawny, rola, anonim), strona oferty (właściciel, obcy właściciel, zły UUID, agent, anonim), panel `/owner`.

### Manual Testing Steps:

1. Załóż lokalnie 4 agentów przez `POST /api/auth/signup` i uzupełnij profile przez `POST /api/agent/profile` (Kraków; różne typy, przedziały i staże, dwóch z tym samym wynikiem i stażem).
2. Jako właściciel dodaj ofertę w Krakowie i porównaj kolejność i wyniki z ręcznym wyliczeniem.
3. Dodaj ofertę w mieście z jednym agentem i w mieście bez agentów; sprawdź komunikaty.
4. Wróć do `/owner` i otwórz ofertę z listy.

## Performance Considerations

Funkcja przegląda wszystkich agentów z pełnym profilem przy każdym wejściu na stronę oferty; przy skali MVP to pomijalne. Indeks GIN na `profiles.cities` dopiero, gdy agentów będą tysiące.

## Migration Notes

Nowa tabela i funkcja, bez zmian istniejących danych. Na produkcję przed merge: `npx supabase db push --dry-run` (pokazać wynik, czekać na zgodę) → `npx supabase db push`. Cofnięcie: blok `-- down:` (drop function, drop table).

## References

- Research: `context/changes/offer-top3-ranking/research.md`
- PRD: `context/foundation/prd.md` (Business Logic, Access Control, FR-003, FR-008, US-01)
- Roadmapa: `context/foundation/roadmap.md` (S-03)
- Wzorzec endpointu: `src/pages/api/agent/profile.ts:5-62`
- Wzorzec definer: `supabase/migrations/20261027150939_create_profiles.sql:24-38`
- Wzorzec testu SQL: `supabase/tests/agent-profile.sql`
- Poprzedni plan: `context/archive/2026-10-28-agent-profile/plan.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Schemat i reguła wyniku

#### Automated

- [x] 1.1 Migracja stosuje się na czystej bazie — 855eff4
- [x] 1.2 Test SQL przechodzi wszystkie asercje — 855eff4
- [x] 1.3 Poprzedni test SQL nadal przechodzi — 855eff4
- [x] 1.4 Typy są aktualne — 855eff4
- [x] 1.5 Typy i lint przechodzą — 855eff4

### Phase 2: Zapis oferty

#### Automated

- [x] 2.1 Typy i lint przechodzą — 5b8600f
- [x] 2.2 Build przechodzi — 5b8600f
- [x] 2.3 Smoke przechodzi na podglądzie — 5b8600f

#### Manual

- [x] 2.4 Wiersz oferty smoke ma status seeking_agent i owner_id właściciela — 5b8600f
- [x] 2.5 Formularz oferty: walidacja, fokus, klawiatura, 360 px, light/dark — 5b8600f

### Phase 3: Ranking i panel

#### Automated

- [x] 3.1 Typy i lint przechodzą — 317dcad
- [x] 3.2 Build przechodzi — 317dcad
- [x] 3.3 Smoke przechodzi na podglądzie (ranking bez e-maila agenta) — 317dcad
- [x] 3.4 Test SQL rankingu nadal przechodzi — 317dcad

#### Manual

- [x] 3.5 Ranking 4 agentów: właściwi 3, kolejność i wyniki zgodne z regułą — 317dcad
- [x] 3.6 Komunikaty przy 1 i 0 dopasowanych agentach — 317dcad
- [x] 3.7 Strona oferty i panel: light/dark, 360 px, fokus, klawiatura — 317dcad
- [ ] 3.8 Produkcja: właściciel dodaje ofertę i widzi ranking
