# Profil agenta i wspólny słownik — Implementation Plan

## Overview

Agent edytuje na `/agent/profile` swój profil: obsługiwane miasta (18 miast wojewódzkich), typy nieruchomości (mieszkanie, dom, działka), przedział cen w PLN i lata doświadczenia. Profil można zapisać niepełny; strona mówi wtedy, czego brakuje, żeby agent trafił do rankingu. Zmiana wprowadza wspólny słownik miast i typów (TS + SQL) oraz kolumnę `profiles.profile_complete`, z której S-03 odfiltruje agentów do rankingu (PRD FR-007, `prd.md:110-112`; roadmapa S-02).

## Current State Analysis

- Jedyna tabela aplikacji to `public.profiles (id, role, created_at)` z RLS „select swój” i bez grantu `update` (`supabase/migrations/20261027150939_create_profiles.sql:5-22`). Wiersz każdego użytkownika tworzy trigger przy rejestracji (`:24-43`), więc agent ma wiersz od pierwszej chwili.
- Słownika miast i typów nie ma w kodzie. Wzorzec stałej domenowej: `ROLES` (`src/types.ts:3-5`) → `z.enum(ROLES)` (`src/lib/services/auth-schemas.ts:18`) → SQL `check` (`create_profiles.sql:7`).
- Formularze: wyspa React z natywnym `POST` (`src/components/auth/SignUpForm.tsx:89`), endpoint z `formData()` + `safeParse` + przekierowanie `?error=<kod>` (`src/pages/api/auth/signup.ts:7-46`), allowlist kodów błędów (`src/lib/services/auth-errors.ts`).
- `/api/*` nie jest gated; endpoint sam sprawdza `locals.user` i rolę z `profiles` (`src/middleware.ts:18-22`, CLAUDE.md).
- Nawigacja z jednego źródła: `navFor(role)` (`src/components/shell/nav.ts:12-14`).
- Typy DB generuje `npm run db:types`; CI wymaga, by były aktualne (`.github/workflows/ci.yml:44`).
- Pełna analiza: `context/changes/agent-profile/research.md`.

## Desired End State

- Zalogowany agent widzi w nawigacji „Profil”, otwiera `/agent/profile`, zaznacza miasta i typy, wpisuje cenę min/max i lata, zapisuje i widzi potwierdzenie. Po ponownym wejściu formularz pokazuje zapisane wartości.
- Gdy profil nie spełnia definicji pełnego, strona pokazuje „Profil niepełny — nie pojawiasz się w rankingu” i listę brakujących elementów; gdy spełnia — „Profil pełny”.
- W bazie `profiles.profile_complete` jest `true` dokładnie wtedy, gdy: `cardinality(cities) ≥ 1` ∧ `cardinality(property_types) ≥ 1` ∧ `price_min` i `price_max` nie są null ∧ `experience_years` nie jest null. Ograniczenia bazy wymuszają: wartości tylko ze słownika, `0 ≤ price_min ≤ price_max`, `0 ≤ experience_years ≤ 60`.
- Agent może zmieniać tylko 5 kolumn profilu i tylko we własnym wierszu; właściciel nie może zmieniać kolumn agenta; `role` pozostaje niezmienna.
- Słownik (`src/lib/dictionaries.ts`) jest gotowy do importu przez formularz oferty i ranking w S-03.

### Key Discoveries:

- Zamiar z role-based-signup: grant kolumnowy `update (…)`, który pomija `role` (`context/archive/2026-10-27-role-based-signup/research.md:60`).
- Middleware wybiera tylko `id, role, created_at` (`src/middleware.ts:29-33`) — nowe kolumny nie zmieniają `locals.profile`; strona profilu czyta je sama.
- `Object.fromEntries(formData)` (`signup.ts:13`) zostawia ostatnią wartość powtarzanego klucza — miasta i typy trzeba czytać przez `formData.getAll`.
- Smoke wysyła `new URLSearchParams(form)` (`scripts/smoke.mjs:36`), które przyjmuje też tablicę par — wystarczy do powtarzanych kluczy.
- W `src/components/ui/` są tylko `Card.astro` i `button.tsx`; wzorzec wybieralnych kafelków: `src/components/auth/RoleChoice.tsx:21-80`; pole tekstowe: `src/components/auth/FormField.tsx`.

## What We're NOT Doing

- Odczyt profili agentów przez właścicieli (polityka lub funkcja `security definer`) — powstaje w S-03 razem z regułą wyniku.
- Reguła wyniku, ranking, formularz oferty — S-03.
- Osobne przedziały cen dla sprzedaży i najmu — w `## Parked` roadmapy (decyzja 2026-10-28).
- Tabele słownikowe, enumy Postgresa, tabele łączące — słownik to slugi w `text[]` + `check`.
- Pola profilu spoza FR-007 (opis, telefon, zdjęcie, imię).
- Uogólnianie `auth-errors.ts` — profil ma własny mały zbiór kodów.
- Framework testów jednostkowych — weryfikacja przez skrypt SQL, smoke i ręczną.

## Implementation Approach

Kolejność: schemat → zapis → UI. Faza 1 ustala kontrakt danych (słownik w TS i w SQL, kolumny, ograniczenia, `profile_complete`, uprawnienia) i dowodzi go skryptem SQL na lokalnej bazie. Faza 2 dodaje walidację i endpoint, sprawdzane przez smoke bez UI (smoke zapisuje profil ze wszystkimi 18 miastami i 3 typami, co wykrywa rozjazd listy TS ↔ SQL). Faza 3 dokłada stronę, formularz i nawigację w design systemie.

Wartości słownika w bazie to ASCII-slugi; polskie etykiety żyją tylko w TS. Typy: `apartment`, `house`, `plot` (kod po angielsku, jak `owner`/`agent`). Miasta: slugi z nazw bez znaków diakrytycznych.

## Critical Implementation Details

- **Lista w dwóch miejscach:** slugi występują w `src/lib/dictionaries.ts` i w `check` migracji. Endpoint mapuje naruszenie `check` przez bazę (Postgres `23514`), którego zod nie wyłapał, na kod `unknown` — dzięki temu krok smoke z pełną listą padnie przy rozjeździe, zamiast go maskować jako `invalid_input`.
- **Granty kolumnowe:** `update` na tabeli wymaga, by polityka `update` miała `using` i `with check` „swój wiersz i `role = 'agent'`”. Kolumna generowana nie trafia do grantu (nie da się jej zapisać).

## Phase 1: Słownik i schemat bazy

### Overview

Wspólny słownik w TS oraz migracja dodająca kolumny profilu agenta z ograniczeniami, `profile_complete` i uprawnieniami. Dowód: skrypt SQL z asercjami.

### Changes Required:

#### 1. Słownik

**File**: `src/lib/dictionaries.ts` (nowy), `src/types.ts`

**Intent**: Jedno źródło slugów i polskich etykiet miast i typów dla profilu (S-02) oraz oferty i rankingu (S-03).

**Contract**:
- `CITIES` — `as const` tuple 18 slugów w kolejności alfabetycznej polskich nazw: `bialystok, bydgoszcz, gdansk, gorzow-wielkopolski, katowice, kielce, krakow, lublin, lodz, olsztyn, opole, poznan, rzeszow, szczecin, torun, warszawa, wroclaw, zielona-gora`.
- `CITY_LABELS: Record<City, string>` — Białystok, Bydgoszcz, Gdańsk, Gorzów Wielkopolski, Katowice, Kielce, Kraków, Lublin, Łódź, Olsztyn, Opole, Poznań, Rzeszów, Szczecin, Toruń, Warszawa, Wrocław, Zielona Góra.
- `PROPERTY_TYPES = ["apartment", "house", "plot"] as const`; `PROPERTY_TYPE_LABELS`: Mieszkanie, Dom, Działka.
- `src/types.ts`: `export type City = (typeof CITIES)[number]`, `export type PropertyType = (typeof PROPERTY_TYPES)[number]` (import z `@/lib/dictionaries`), obok `Role`.

#### 2. Migracja

**File**: `supabase/migrations/<YYYYMMDDHHmmss>_add_agent_profile.sql` (nowy)

**Intent**: Kolumny profilu agenta w `profiles`, ograniczenia z decyzji użytkownika, kolumna generowana kompletności i wąskie uprawnienia do edycji.

**Contract**:
- Kolumny: `cities text[] not null default '{}'`, `property_types text[] not null default '{}'`, `price_min integer`, `price_max integer`, `experience_years integer`.
- Ograniczenia (nazwane): `cities <@ array[…18 slugów…]::text[]`; `property_types <@ array['apartment','house','plot']::text[]`; `price_min >= 0`; `price_max >= price_min` (null przepuszcza); `experience_years between 0 and 60`.
- `profile_complete boolean generated always as (cardinality(cities) >= 1 and cardinality(property_types) >= 1 and price_min is not null and price_max is not null and experience_years is not null) stored`.
- `grant update (cities, property_types, price_min, price_max, experience_years) on public.profiles to authenticated`.
- Polityka `profiles_update_own_agent` `for update to authenticated using ((select auth.uid()) = id and role = 'agent') with check ((select auth.uid()) = id and role = 'agent')`.
- Komentarz nagłówka jak w pierwszej migracji (dlaczego grant kolumnowy, że lista slugów musi być zgodna z `src/lib/dictionaries.ts`); blok `-- down:` usuwający politykę, odbierający grant i usuwający kolumny.

#### 3. Typy i profil w TS

**File**: `src/db/database.types.ts` (wygenerowany), `src/types.ts`

**Intent**: Typy DB obejmują nowe kolumny; DTO profilu agenta zawęża `text[]` do słownika.

**Contract**: `npm run db:types`. W `src/types.ts`: `AgentProfile` — `cities: City[]`, `propertyTypes: PropertyType[]`, `priceMin: number | null`, `priceMax: number | null`, `experienceYears: number | null`, `complete: boolean` (DTO dla strony i endpointu; mapowanie z `Row` w serwisie w Fazie 2). Istniejący `Profile` bez zmian.

#### 4. Skrypt sprawdzający schemat

**File**: `supabase/tests/agent-profile.sql` (nowy)

**Intent**: Powtarzalny dowód ograniczeń, kolumny generowanej i RLS na lokalnej bazie, bez frameworka testów.

**Contract**: Jedna transakcja zakończona `rollback`; asercje jako bloki `do $$ … raise exception … $$`, `\set ON_ERROR_STOP on`. Każda oczekiwana porażka siedzi w bloku z przechwyceniem wyjątku, żeby nie przerwać transakcji: `do $$ begin <update>; raise exception 'expected failure'; exception when check_violation or insufficient_privilege then null; end $$` (wyjątek `expected failure` przechodzi dalej i zatrzymuje skrypt). Liczbę zmienionych wierszy sprawdza `get diagnostics n = row_count`. Tworzy dwóch agentów i właściciela w `auth.users` (trigger tworzy profile). Sprawdza:
- nowy agent: `profile_complete = false`, `cities = '{}'`;
- komplet pól → `true`; `experience_years = 0` → nadal `true`; `price_min = price_max` dozwolone;
- odrzucone: slug spoza słownika (miasto i typ), `price_min = -1`, `price_max < price_min`, `experience_years = 61` i `-1`;
- jako `authenticated` z `request.jwt.claims` agenta A: update własnych kolumn → 1 wiersz; update wiersza agenta B → 0 wierszy; update `role` → błąd uprawnień;
- jako właściciel: update `cities` własnego wiersza → 0 wierszy.
Uruchomienie: `docker exec -i supabase_db_10x-astro-starter psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/agent-profile.sql` (nazwa kontenera z `project_id` w `supabase/config.toml:5`; lokalnie nie ma `psql`). Z zainstalowanym `psql`: `psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -f supabase/tests/agent-profile.sql`.

### Success Criteria:

#### Automated Verification:

- Migracja stosuje się na czystej bazie: `npx supabase db reset`
- Skrypt SQL przechodzi wszystkie asercje: `docker exec -i supabase_db_10x-astro-starter psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/agent-profile.sql`
- Typy są aktualne: `npm run db:types && git diff --exit-code src/db/database.types.ts` (po commicie wygenerowanego pliku)
- Typy i lint przechodzą: `npx astro check && npm run lint`

#### Manual Verification:

- W Supabase Studio (`http://localhost:54323`) tabela `profiles` pokazuje nowe kolumny, a lista slugów w `check` zgadza się 1:1 z `CITIES` w `src/lib/dictionaries.ts`

**Implementation Note**: Po zielonej weryfikacji automatycznej zatrzymaj się na ręczne potwierdzenie przed Fazą 2.

---

## Phase 2: Zapis profilu

### Overview

Walidacja i parser formularza w serwisie oraz endpoint zapisujący profil; dowód przez nowe kroki smoke.

### Changes Required:

#### 1. Serwis profilu agenta

**File**: `src/lib/services/agent-profile.ts` (nowy)

**Intent**: Jedno miejsce reguł profilu po stronie serwera: schemat wejścia, mapowanie wiersza na DTO, lista braków, kody błędów strony profilu.

**Contract**:
- `agentProfileSchema` (`z` z `astro/zod`): `cities: z.array(z.enum(CITIES))`, `propertyTypes: z.array(z.enum(PROPERTY_TYPES))` (oba deduplikowane, mogą być puste); `priceMin`, `priceMax`, `experienceYears` — brak klucza (`get` zwraca `null`) lub pusty string po `trim` → `null`, inaczej liczba całkowita (cena `0 … 2 147 483 647`, lata `0 … 60`); `refine`: gdy obie ceny podane, `priceMin ≤ priceMax`.
- `parseAgentProfileForm(formData: FormData)` — `getAll("cities")`, `getAll("propertyTypes")`, `get(...)` dla liczb → `safeParse`.
- `toAgentProfile(row)` → `AgentProfile`; `missingForRanking(profile): ("cities" | "propertyTypes" | "price" | "experience")[]` — ta sama definicja co `profile_complete` w SQL (UI pokazuje braki; o rankingu decyduje kolumna w bazie).
- Kody błędów: `PROFILE_ERROR_CODES = ["invalid_input", "unavailable", "unknown"] as const` + `profileErrorMessage(code: string | null)` z allowlistą i polskimi komunikatami (wzorzec `authErrorMessage`, `auth-errors.ts:46-50`).

#### 2. Endpoint

**File**: `src/pages/api/agent/profile.ts` (nowy)

**Intent**: Zapis profilu zalogowanego agenta natywnym `POST`.

**Contract**: `export const POST: APIRoute`.
- Brak klienta Supabase → 302 `/agent/profile?error=unavailable` (wzorzec `signup.ts`); brak `locals.user` → 302 `/auth/signin`.
- Rola z `profiles` (select `role` po `user.id`); błąd odczytu → `?error=unavailable`; rola ≠ `agent` → `403`.
- `formData()` w `try/catch`; walidacja nieudana → 302 `/agent/profile?error=invalid_input`.
- `update` 5 kolumn (snake_case) `.eq("id", user.id)` — zapis zawsze zastępuje wszystkie 5 kolumn (pole puste lub pominięte czyści wartość); błąd Postgres `23514` lub inny → `?error=unknown`; wyjątek → `?error=unknown`.
- Sukces → 302 `/agent/profile?saved=1`.

#### 3. Smoke

**File**: `scripts/smoke.mjs`

**Intent**: Dowód zapisu, walidacji i kontroli roli na zbudowanej aplikacji; pełna lista slugów wykrywa rozjazd TS ↔ SQL.

**Contract**: `form` może być tablicą par (`URLSearchParams` ją przyjmuje). Nowe kroki (sesja agenta, przed jego wylogowaniem; sesja właściciela, gdy jest zalogowany):
- agent zapisuje profil ze wszystkimi 18 miastami, 3 typami, `priceMin=0`, `priceMax=2000000`, `experienceYears=0` → 302 `/agent/profile?saved=1`;
- agent zapisuje profil niepełny (tylko jedno miasto; `priceMin`, `priceMax`, `experienceYears` wysłane jako `""`) → 302 `/agent/profile?saved=1`;
- agent wysyła nieznane miasto → 302 `/agent/profile?error=invalid_input`;
- agent wysyła `priceMin > priceMax` → 302 `/agent/profile?error=invalid_input`;
- agent wysyła `experienceYears=61` → 302 `/agent/profile?error=invalid_input`;
- właściciel wysyła profil → 403;
- niezalogowany wysyła profil → 302 `/auth/signin`.
Lista miast w smoke jest wpisana dosłownie (smoke nie importuje TS) — to celowo drugie, niezależne źródło do porównania z `check` w bazie.

### Success Criteria:

#### Automated Verification:

- Typy i lint przechodzą: `npx astro check && npm run lint`
- Build przechodzi: `npm run build`
- Smoke przechodzi na podglądzie: `npm run preview` w tle, potem `BASE_URL=http://localhost:4321 npm run smoke`

#### Manual Verification:

- Po krokach smoke w Supabase Studio wiersz agenta smoke ma ostatnio zapisane wartości (jedno miasto, `profile_complete = false`)

**Implementation Note**: Po zielonej weryfikacji automatycznej zatrzymaj się na ręczne potwierdzenie przed Fazą 3.

---

## Phase 3: Strona profilu i nawigacja

### Overview

Strona `/agent/profile` z formularzem w design systemie, stan kompletności, pozycja „Profil” w nawigacji agenta i odnośnik z panelu.

### Changes Required:

#### 1. Strona

**File**: `src/pages/agent/profile.astro` (nowy)

**Intent**: Wczytanie profilu zalogowanego agenta i wyrenderowanie formularza z komunikatami.

**Contract**: `AppLayout title="Profil agenta"`. Czyta własny wiersz (`cities, property_types, price_min, price_max, experience_years, profile_complete`) klientem z `createClient(Astro.request.headers, Astro.cookies)`; błąd odczytu → komunikat „chwilowo niedostępne” zamiast formularza. Przekazuje do wyspy `AgentProfileForm client:load`: `initial: AgentProfile`, `missing` z `missingForRanking`, `serverError` z `profileErrorMessage(Astro.url.searchParams.get("error"))`, `saved = searchParams.has("saved")`.

#### 2. Formularz

**File**: `src/components/agent/AgentProfileForm.tsx` (nowy), `src/components/agent/ChoiceChips.tsx` (nowy), `src/components/auth/FormField.tsx`

**Intent**: Edycja profilu natywnym `POST` na `/api/agent/profile`, z walidacją klienta odpowiadającą serwerowi.

**Contract**:
- Sekcje: „Miasta” (18 kafelków-checkboxów, `name="cities"`), „Typy nieruchomości” (3, `name="propertyTypes"`), „Przedział cen (PLN)” (dwa `FormField` `inputMode="numeric"`, `name="priceMin"`/`"priceMax"`), „Lata doświadczenia” (`FormField`, `name="experienceYears"`, 0–60).
- `FormField`: nowy opcjonalny prop `inputMode` przekazywany do `<input>`; obecne wywołania (SignIn, SignUp) bez zmian. Ikony pól liczbowych: `Banknote` (ceny), `Briefcase` (lata).
- `ChoiceChips` — fieldset z legendą, kafelki jak w `RoleChoice.tsx` (ukryty `input type="checkbox"`, `has-[:focus-visible]:shadow-focus`, stany zaznaczony/hover/błąd), siatka zawijająca się przy 360 px; komponent ogólny, by S-03 mógł użyć go w formularzu oferty.
- Status nad formularzem: pełny → „Profil pełny — pojawiasz się w rankingu”; niepełny → „Profil niepełny — nie pojawiasz się w rankingu. Brakuje: …” (polskie nazwy braków). Po `saved` — potwierdzenie „Zapisano profil”.
- Walidacja klienta: liczby całkowite, cena ≥ 0, min ≤ max (gdy obie podane), lata 0–60; puste pola dozwolone (zapis niepełny). Fokus na pierwsze błędne pole, `useNativeSubmitting`, `SubmitButton` „Zapisz profil” / „Zapisywanie…”, `ServerError`.
- Kolory i stany wyłącznie z istniejących tokenów (`rs-accent-strong`, `rs-surface-2`, `rs-input-border`, `rs-fg-3`, `rs-danger`); nowy kolor tylko po sprawdzeniu kontrastu w obu motywach (lessons.md).

#### 3. Nawigacja i panel

**File**: `src/components/shell/nav.ts`, `src/pages/agent/index.astro`

**Intent**: Agent znajduje profil z nawigacji i z panelu.

**Contract**: `navFor("agent")` zwraca „Panel” i „Profil” (`/agent/profile`, ikona `UserRound` z lucide); `navFor("owner")` bez zmian. `isActive` w `nav.ts` zwraca `pathname === href`, gdy `href` jest jednym z `Object.values(ROLE_PREFIXES)` (pozycja domowa), a w pozostałych przypadkach `matchesPrefix(pathname, href)`. Zmiana tylko w `nav.ts`; Sidebar, MobileNav i Dock korzystają z niej bez edycji. Na `/agent` karta z tekstem o profilu linkuje do `/agent/profile`.

#### 4. Smoke

**File**: `scripts/smoke.mjs`

**Intent**: Strona profilu renderuje się dla agenta i jest chroniona.

**Contract**: kroki: agent `GET /agent/profile` → 200; właściciel `GET /agent/profile` → 302 `/owner`; niezalogowany `GET /agent/profile` → 302 `/auth/signin`.

### Success Criteria:

#### Automated Verification:

- Typy i lint przechodzą: `npx astro check && npm run lint`
- Build przechodzi: `npm run build`
- Smoke przechodzi na podglądzie: `BASE_URL=http://localhost:4321 npm run smoke`

#### Manual Verification:

- Agent zapisuje pełny profil, widzi „Zapisano profil” i „Profil pełny”; po odświeżeniu wartości są zachowane
- Agent odznacza wszystkie typy i zapisuje: widzi „Profil niepełny” z „Brakuje: typy nieruchomości”
- Walidacja klienta: min > max, lata 61, tekst w polu ceny pokazują błąd przy polu i fokus na pierwszym błędnym
- 7 stanów kafelków i pól (default, hover, focus, disabled podczas wysyłki, error, empty, loading/pending) widziane w przeglądarce — stany trudne do wywołania wymuszone w DevTools (lessons.md)
- Widok przy 360 px bez poziomego przewijania; polskie znaki (Łódź, Gorzów Wielkopolski, Zielona Góra, Działka) poprawne; light i dark
- Nawigacja: „Profil” aktywny na `/agent/profile`, „Panel” aktywny tylko na `/agent`; dock na mobile pokazuje obie pozycje
- Właściciel nie widzi pozycji „Profil”

**Implementation Note**: Po zielonej weryfikacji automatycznej zatrzymaj się na ręczne potwierdzenie.

---

## Testing Strategy

### Unit Tests:

- Brak frameworka (CLAUDE.md). Reguły bazy dowodzi `supabase/tests/agent-profile.sql`; walidację endpointu — smoke.

### Integration Tests:

- Smoke: zapis pełny/niepełny, odrzucenie złego slugu, min > max, lata > 60, 403 dla właściciela, przekierowanie niezalogowanego, render strony i ochrona trasy.
- Skrypt SQL: ograniczenia, `profile_complete` (w tym 0 lat i min = max), RLS i grant kolumnowy.

### Manual Testing Steps:

1. Zarejestruj agenta lokalnie, wejdź w „Profil”, zobacz „Profil niepełny” ze wszystkimi czterema brakami.
2. Uzupełnij wszystko z 0 lat i min = max, zapisz — „Profil pełny”.
3. Odznacz wszystkie miasta, zapisz — „Brakuje: miasta”; w Studio `profile_complete = false`.
4. Sprawdź 360 px, dark, stany z DevTools.

## Performance Considerations

Brak istotnych: jeden `select` i jeden `update` po kluczu głównym.

## Migration Notes

- Migracja dodaje kolumny z domyślnymi wartościami do istniejących wierszy; istniejący agenci i właściciele dostają `cities = '{}'`, `property_types = '{}'`, nulle i `profile_complete = false`.
- Produkcja: `npx supabase db push --dry-run`, potem `db push` przed merge do `main` (README). Wycofanie: SQL z bloku `-- down:` w SQL Editorze.

## References

- Research: `context/changes/agent-profile/research.md` (sekcja Decisions 2026-10-28)
- PRD: `context/foundation/prd.md:83-84`, `:110-112`
- Roadmapa: `context/foundation/roadmap.md` S-02, Decisions 2026-10-27, Parked
- Wzorce: `supabase/migrations/20261027150939_create_profiles.sql`, `src/pages/api/auth/signup.ts`, `src/components/auth/RoleChoice.tsx`, `src/lib/services/auth-errors.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Słownik i schemat bazy

#### Automated

- [ ] 1.1 Migracja stosuje się na czystej bazie
- [ ] 1.2 Skrypt SQL przechodzi wszystkie asercje
- [ ] 1.3 Typy są aktualne
- [ ] 1.4 Typy i lint przechodzą

#### Manual

- [ ] 1.5 Lista slugów w check zgadza się 1:1 z CITIES

### Phase 2: Zapis profilu

#### Automated

- [ ] 2.1 Typy i lint przechodzą
- [ ] 2.2 Build przechodzi
- [ ] 2.3 Smoke przechodzi na podglądzie

#### Manual

- [ ] 2.4 Wiersz agenta smoke ma ostatnio zapisane wartości

### Phase 3: Strona profilu i nawigacja

#### Automated

- [ ] 3.1 Typy i lint przechodzą
- [ ] 3.2 Build przechodzi
- [ ] 3.3 Smoke przechodzi na podglądzie

#### Manual

- [ ] 3.4 Zapis pełnego profilu z potwierdzeniem i zachowaniem wartości
- [ ] 3.5 Profil niepełny pokazuje braki
- [ ] 3.6 Walidacja klienta z fokusem na pierwszym błędnym polu
- [ ] 3.7 7 stanów kafelków i pól widziane w przeglądarce
- [ ] 3.8 360 px, polskie znaki, light i dark
- [ ] 3.9 Aktywna pozycja nawigacji i dock
- [ ] 3.10 Właściciel nie widzi pozycji Profil
