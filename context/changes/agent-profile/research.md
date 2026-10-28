---
date: 2026-10-28T11:40:50+0100
researcher: Claude (Opus 5.5) dla bkreczmer
git_commit: e6ecf66
branch: main
repository: helloDOM
topic: "S-02 agent-profile: edycja profilu agenta i wspólny słownik miast oraz typów"
tags: [research, agent-profile, profiles, rls, dictionary, supabase, forms]
status: complete
last_updated: 2026-10-28
last_updated_by: Claude (Opus 5.5)
last_updated_note: "Dopisano decyzje użytkownika do Open Questions 1–4 (sekcja Decisions); pytania 5–9 zostają dla planu."
---

# Research: S-02 agent-profile

**Date**: 2026-10-28T11:40:50+0100
**Researcher**: Claude (Opus 5.5) dla bkreczmer
**Git Commit**: e6ecf66
**Branch**: main
**Repository**: helloDOM

## Research Question

Co w obecnym kodzie i dokumentach określa, jak zbudować S-02 z roadmapy: agent edytuje profil (miasta z listy 18 wojewódzkich, typy mieszkanie/dom/działka, przedział cen, lata doświadczenia), agent z niepełnym profilem nie trafia do rankingu, a zmiana wprowadza wspólny słownik miast i typów dla S-03. (Źródło: `context/changes/agent-profile/change.md`, `context/foundation/roadmap.md:102-112`.)

Badanie wykonałem lokalnie, bez podagentów: kod aplikacji to kilkanaście plików, a wszystkie istotne obszary dało się przeczytać bezpośrednio.

## Summary

- **Dane:** w bazie jest dokładnie jedna tabela aplikacji, `public.profiles` (`id`, `role`, `created_at`), z jedną polityką `select` „tylko swój” i bez grantu `update` (`supabase/migrations/20261027150939_create_profiles.sql:5-22`). Pól agenta nie ma. W role-based-signup zapisano zamiar: S-02 doda pola i grant kolumnowy `update (…)`, który pominie `role` (`context/archive/2026-10-27-role-based-signup/research.md:60`).
- **Słownik:** w kodzie nie ma listy miast ani typów. Roadmapa ustala, że to zamknięte listy wspólne dla formularza oferty, profilu agenta i rankingu, wprowadzane przez S-02 (`roadmap.md:31`, `:111`, `:124`). Wzorcem stałej domenowej jest `ROLES` w `src/types.ts:3-5`, używane w zod (`src/lib/services/auth-schemas.ts:18`) i w SQL `check (role in (...))` (`create_profiles.sql:7`).
- **Kompletność profilu:** PRD mówi tylko „agent z niepełnym profilem nie trafia do rankingu” (`prd.md:112`, FR-007 `prd.md:83-84`). Definicji „pełnego” profilu nie ma w żadnym przejrzanym dokumencie. To decyzja do planu.
- **Dostęp do odczytu dla rankingu:** S-03 będzie musiał czytać profile innych agentów jako właściciel. Obecne RLS na to nie pozwala (`create_profiles.sql:14-17`). Archiwum odkłada to do „S-02/S-03” (`role-based-signup/plan.md:48`), więc S-02 musi zdecydować, czy to zrobić teraz, czy zostawić S-03.
- **UI i endpointy:** strona musi leżeć pod `/agent/*` (`src/lib/route-guard.ts:3-7`, `CLAUDE.md`). Obecny wzorzec formularza to wyspa React z natywnym `POST` + przekierowanie z `?error=<kod>` (`src/components/auth/SignUpForm.tsx:89`, `src/pages/api/auth/signup.ts:8`). `/api/*` nie jest gated: endpoint sam sprawdza `locals.user` i czyta rolę z `profiles` (`src/middleware.ts:18-22`). W `src/components/ui/` są tylko `Card.astro` i `button.tsx`; nie ma komponentów checkbox/multi-select ani pola liczbowego.
- **Luka w PRD istotna dla rankingu:** oferta ma transakcję (sprzedaż/wynajem, FR-003 `prd.md:73`), a profil agenta ma jeden „przedział cen” (FR-007). Ceny sprzedaży i najmu różnią się o rzędy wielkości, a PRD nie mówi, czy przedział agenta zależy od transakcji. Patrz Open Questions.

## Detailed Findings

### Wymagania (PRD i roadmapa)

- FR-007: agent edytuje obsługiwane miasta, typy nieruchomości, przedział cen, lata doświadczenia; must-have. Socrates: agent bez uzupełnionego profilu nigdy nie trafi do top 3 — „akceptowane” (`context/foundation/prd.md:83-84`).
- Reguła wyniku, z której wynika, jakie typy danych są potrzebne (`prd.md:110-112`):
  - miasto: warunek konieczny → profil potrzebuje **zbioru** miast (wiele miast na agenta);
  - typ: 35 pkt, jeśli agent go obsługuje → **zbiór** typów;
  - cena: 35 pkt, jeśli mieści się w przedziale agenta → dwie liczby (min, max); PRD nie mówi, czy granice są włączne;
  - doświadczenie: liniowo do 10 lat, 10+ = 30 pkt → nieujemna liczba lat; PRD nie mówi, czy ułamkowe;
  - remis: więcej lat, potem wcześniejsza rejestracja → `profiles.created_at` już istnieje (`create_profiles.sql:8`).
- Decyzja roadmapy (2026-10-27): typy = mieszkanie, dom, działka; miasta = 18 miast wojewódzkich; jeden wspólny słownik dla formularza oferty, profilu agenta i rankingu; wprowadza go S-02 (`roadmap.md:31`). S-03 zakłada, że dopasowanie po mieście to „porównanie pozycji słownika, nie tekstu” (`roadmap.md:124`).
- Lista 18 miast nie jest zapisana w repo. Z wiedzy ogólnej (nie z repo; do potwierdzenia przez użytkownika): Białystok, Bydgoszcz, Gdańsk, Gorzów Wielkopolski, Katowice, Kielce, Kraków, Lublin, Łódź, Olsztyn, Opole, Poznań, Rzeszów, Szczecin, Toruń, Warszawa, Wrocław, Zielona Góra. Dwa województwa mają po dwie stolice (kujawsko-pomorskie: Bydgoszcz i Toruń; lubuskie: Gorzów Wlkp. i Zielona Góra), stąd 18 przy 16 województwach.
- PRD Access Control: agent może „swój profil” (`prd.md:122`). Weryfikacja danych agenta to non-goal: „dane z profilu są przyjmowane tak, jak je podał agent” (`prd.md:135`).
- NFR: każdy widok używalny przy 360 px, polskie znaki (`prd.md` sekcja Non-Functional Requirements). Polskie znaki dotyczą tu bezpośrednio nazw miast (Łódź, Gorzów, Zielona Góra).

### Baza danych i RLS

- `profiles`: `id uuid` PK → `auth.users` z `on delete cascade`, `role text not null check (role in ('owner','agent'))`, `created_at` (`create_profiles.sql:5-9`). Wiersz tworzy trigger `on_auth_user_created` (`:24-43`), więc każdy agent ma wiersz `profiles` od rejestracji.
- RLS włączone (`:11`). Jedyna polityka: `profiles_select_own` dla `authenticated`, `using (auth.uid() = id)` (`:14-17`). Granty: `revoke all` dla `anon, authenticated`, potem tylko `grant select` dla `authenticated` (`:20-22`). Komentarz: „Role is immutable: only a select policy; no insert, update or delete policies” (`:13`).
- Migracja ma blok `-- down:` (`:45-48`); README wymaga takiego bloku dla każdej migracji (README, „Migracje bazy na produkcji”). Migracje na produkcję wdraża człowiek przez `supabase db push` przed merge (README).
- Typy TS generuje `npm run db:types` (`package.json:14`) do `src/db/database.types.ts`; CI sprawdza, że plik jest aktualny (`.github/workflows/ci.yml:44`). Nowa migracja wymaga więc regeneracji i commitu typów, inaczej job smoke padnie.
- `Profile` w `src/types.ts:7-10` to `Row` z zawężoną `role`. Middleware wybiera jawnie `id, role, created_at` (`src/middleware.ts:29-33`), więc nowe kolumny w `profiles` nie zmienią tego, co trafia do `locals.profile`, chyba że plan rozszerzy select.
- Konsekwencja dla wyboru miejsca na dane (bez rekomendacji ostatecznej, to wybór dla planu):
  - **kolumny w `profiles`** + `grant update (cities, …) on public.profiles to authenticated` + polityka `update` „swój i rola = agent”. Zgodne z zamiarem z archiwum (`role-based-signup/research.md:60`). Wiersz istnieje od rejestracji, więc wystarczy `update`, bez `insert`. Właściciele mieliby puste kolumny agenta.
  - **osobna tabela `agent_profiles`** (1:1 z `profiles`): czystszy podział ról, ale wymaga `insert` lub upsertu i własnego RLS; CLAUDE.md wymaga RLS dla każdej nowej tabeli.
- Reprezentacja słownika w SQL (wybór dla planu): `check` z listą wartości (wzorzec z `role`), typ `enum` Postgresa albo tabele słownikowe. Dla zbiorów: kolumna `text[]` z `check (cities <@ array[...])` albo tabele łączące. W repo nie ma jeszcze żadnego z tych wzorców poza `check (... in (...))` dla skalara.
- Odczyt cudzych profili: obecna polityka nie dopuszcza, by właściciel czytał profil agenta (`:14-17`). Ranking w S-03 będzie potrzebował albo polityki `select` dla właścicieli na wierszach agentów, albo funkcji `security definer`. W repo jest jeden przykład `security definer` z `set search_path = ''` i odebranym `execute` (`:24-38`).

### Słownik w kodzie TS

- Wzorzec: `export const ROLES = ["owner", "agent"] as const; export type Role = (typeof ROLES)[number];` (`src/types.ts:3-5`), w zod przez `z.enum(ROLES)` (`src/lib/services/auth-schemas.ts:18`), etykiety PL trzymane w komponencie (`src/components/auth/RoleChoice.tsx:6-19`).
- CLAUDE.md: „shared types and DTOs in `src/types.ts`”, „Business logic in `src/lib/services/`”. Słownik (wartości + polskie etykiety) może więc trafić do `src/types.ts` (stałe i typy) z etykietami obok albo w osobnym module; S-03 zaimportuje to samo.
- Wartości przechowywane vs etykiety: dla miast z polskimi znakami trzeba zdecydować, czy w bazie trzymać nazwę (`"Łódź"`) czy slug (`"lodz"`). Roadmapa mówi tylko o „pozycji słownika, nie tekście” (`roadmap.md:124`).

### Routing, middleware, endpointy

- Panel agenta: `src/pages/agent/index.astro:1-15` (karta „Witaj” z tekstem „Tu pojawią się zaproszenia od właścicieli i Twój profil agenta”, `:11-12`). Nowa strona profilu musi leżeć pod `/agent/*` (`src/lib/route-guard.ts:3-7`); `AppLayout` rzuca błąd, gdy strona nie jest gated (`src/layouts/AppLayout.astro:13-21`).
- Middleware ładuje `locals.profile` tylko dla gated ścieżek; dla `/api/*` `profile` = `null` (`src/middleware.ts:18-22`). Endpoint zapisu profilu musi sam sprawdzić `locals.user` i odczytać rolę z `profiles` (CLAUDE.md, Auth flow; to samo zapisano w `role-based-signup/reviews/impl-review.md:80`). RLS zabezpieczy dane niezależnie od tego sprawdzenia, jeśli polityka `update` ograniczy się do własnego wiersza.
- Nawigacja: `navFor(role)` zwraca dziś jedną pozycję „Panel” dla każdej roli (`src/components/shell/nav.ts:12-14`); jedno źródło dla Sidebar, MobileNav i Dock (`:11`), dock mieści do 5 pozycji (`:16-17`). Pozycja „Profil” dla agenta to zmiana w `navFor`.

### Formularz i komponenty

- Wzorzec formularza: wyspa React (`client:load`) z walidacją po stronie klienta, natywnym `POST` na `/api/...` i `useNativeSubmitting` do stanu pending (`SignUpForm.tsx:25-89`, `src/components/hooks/useNativeSubmitting.ts:8-21`). Endpoint: `formData()` + `safeParse` w `try/catch`, porażka → przekierowanie z kodem błędu (`signup.ts:7-20`).
- Kody błędów: zamknięty zbiór + allowlist + polskie komunikaty w `src/lib/services/auth-errors.ts:1-50`. Zbiór jest nazwany i typowany jako auth (`AuthErrorCode`); profil potrzebuje własnych kodów albo uogólnienia tego modułu.
- Multi-select z `formData()`: wiele checkboxów o tej samej nazwie daje kilka wartości; `Object.fromEntries` (użyte w `signup.ts:13`) zachowuje tylko ostatnią. Endpoint profilu musi użyć `formData.getAll(...)` dla miast i typów.
- Komponenty: `src/components/ui/` zawiera tylko `Card.astro` i `button.tsx`; pola tekstowe żyją w `src/components/auth/FormField.tsx:1-74` (input z ikoną, błąd, hint, stan hover). Nie ma checkboxa, chipów ani select. Karty wyboru roli (`RoleChoice.tsx:21-80`) to istniejący wzorzec „wybieralnych kafelków” z ukrytym inputem i `has-[:focus-visible]`. Design system opisuje Input/Select/Textarea i Badge (`context/foundation/design-system.md:106-107`) oraz DoD widoku: 7 stanów, light/dark, 360 px (`design-system.md`, sekcja Definition of Done).
- Lekcja „Sprawdzaj kontrast tokenów” (`context/foundation/lessons.md`) dotyczy nowych kolorów w komponentach, np. stanu zaznaczonego chipa/checkboxa. Lekcja „Odhaczaj krok ręczny dopiero po zobaczeniu stanu” dotyczy weryfikacji stanów formularza.

### Testy i CI

- Brak frameworka testów (CLAUDE.md). Smoke (`scripts/smoke.mjs`) rejestruje agenta i sprawdza `/agent` (`scripts/smoke.mjs:83-95`); naturalne rozszerzenie: zapis profilu i 302/200 strony profilu.
- CI: `db:types` + `git diff --exit-code` (`ci.yml:44`), potem smoke na podglądzie produkcyjnym (`ci.yml:51-55`). Lokalnie i w CI `enable_confirmations = false` (`supabase/config.toml:209`), więc agent ze smoke ma sesję od razu.

## Code References

- `supabase/migrations/20261027150939_create_profiles.sql:5-22` — tabela `profiles`, RLS, granty
- `supabase/migrations/20261027150939_create_profiles.sql:24-43` — trigger tworzący profil (wzorzec `security definer`)
- `src/types.ts:3-10` — `ROLES`, `Role`, `Profile`
- `src/lib/services/auth-schemas.ts:15-19` — zod z `z.enum(ROLES)`
- `src/lib/services/auth-errors.ts:1-50` — kody błędów + allowlist
- `src/pages/api/auth/signup.ts:7-46` — wzorzec endpointu formularza
- `src/middleware.ts:18-51` — `locals.profile` tylko dla gated ścieżek
- `src/lib/route-guard.ts:3-27` — prefiksy ról
- `src/components/shell/nav.ts:12-14` — nawigacja per rola
- `src/pages/agent/index.astro:8-15` — obecny panel agenta
- `src/components/auth/SignUpForm.tsx:25-169`, `FormField.tsx`, `RoleChoice.tsx` — wzorce pól i kafelków wyboru
- `package.json:14`, `.github/workflows/ci.yml:44` — generowanie i kontrola typów DB
- `scripts/smoke.mjs:83-95` — kroki smoke dla agenta

## Architecture Insights

- Stałe domenowe są jednym źródłem dla TS (`as const`), zod i SQL `check` (rola). Słownik miast i typów może pójść tą samą drogą, ale wtedy lista istnieje dwa razy (TS i migracja); trzeba ją trzymać zgodną ręcznie albo przez tabelę słownikową czytaną przez aplikację.
- Bezpieczeństwo opiera się na RLS + jawnych grantach (`revoke all`, potem wąskie `grant`). Grant kolumnowy na `update` to naturalne przedłużenie, które chroni niezmienność `role`.
- Formularze są natywne (bez fetch/JSON), błędy idą przez kody w URL. Zapis profilu w tym modelu: `POST` → przekierowanie na `/agent/profile?saved=1` lub `?error=<kod>`.

## Historical Context (from prior changes)

- `context/archive/2026-10-27-role-based-signup/research.md:60` — „Gdy S-02 doda pola profilu, użyjemy grantu kolumnowego (`grant update (…) on public.profiles to authenticated`), który pomija `role`.” Werdykt: nadal zgodne z kodem (brak grantu `update` dziś, `create_profiles.sql:20-21`); to zamiar, nie decyzja wiążąca S-02.
- `context/archive/2026-10-27-role-based-signup/research.md:64` i `plan.md:48` — polityki czytania cudzych profili (ranking) odłożone do „S-02/S-03”. Werdykt: nadal otwarte; żadna taka polityka nie istnieje (`create_profiles.sql:14-17` to jedyna polityka).
- `context/archive/2026-10-27-role-based-signup/plan.md:47` — edycja profilu, pola agenta i słownik przypisane do S-02. Werdykt: zgodne z roadmapą (`roadmap.md:111`).
- `context/archive/2026-10-27-app-shell/plan-brief.md:24`, `plan.md:35` — komponenty (Badge, pill, wiersz oferty) powstają w wycinkach, które ich używają. Werdykt: nadal obowiązuje; S-02 dodaje własne kontrolki wyboru (chipy/checkboxy, pole liczbowe), jeśli ich potrzebuje.
- `context/archive/2026-10-27-role-based-signup/reviews/impl-review.md:80` — przyszłe endpointy dostaną `locals.profile = null` i muszą same sprawdzić rolę. Werdykt: zgodne z `src/middleware.ts:18-22` i CLAUDE.md.

## Related Research

- `context/archive/2026-10-27-role-based-signup/research.md` — tabela `profiles`, RLS, trigger, middleware.

## Decisions (2026-10-28, użytkownik)

Rozstrzygają pytania 1–4 z Open Questions poniżej. Zastępują propozycję z pytania 2 i otwarte warianty z pytań 1 i 3.

1. **Przedział cen:** jeden przedział na agenta, niezależny od transakcji (sprzedaż/wynajem), zgodnie z regułą wyniku w `prd.md:110`. Osobne przedziały dla sprzedaży i najmu trafiły do `## Parked` w `context/foundation/roadmap.md`.
2. **Pełny profil** = wszystkie warunki naraz:
   - co najmniej 1 miasto ze słownika;
   - co najmniej 1 typ ze słownika;
   - obie granice ceny podane, `0 ≤ min ≤ max`;
   - lata doświadczenia podane; 0 lat to profil pełny.
   Profil niespełniający któregoś warunku nie trafia do rankingu (`prd.md:112`).
3. **Jednostki:** cena w PLN jako liczba całkowita; granice przedziału włączne (cena oferty równa `min` lub `max` daje 35 pkt); lata doświadczenia całkowite w zakresie 0–60.
4. **Miasta:** lista 18 miast z sekcji „Wymagania” potwierdzona: Białystok, Bydgoszcz, Gdańsk, Gorzów Wielkopolski, Katowice, Kielce, Kraków, Lublin, Łódź, Olsztyn, Opole, Poznań, Rzeszów, Szczecin, Toruń, Warszawa, Wrocław, Zielona Góra.

## Open Questions

Decyzje produktowe (owner: użytkownik) — **rozstrzygnięte 2026-10-28, patrz Decisions wyżej**:

1. **Przedział cen a transakcja.** Oferta ma transakcję sprzedaż/wynajem (`prd.md:73`), profil ma jeden przedział (`prd.md:83`). Czy agent podaje jeden przedział (ryzyko: przedział sprzedażowy nigdy nie pasuje do najmu i odwrotnie), dwa przedziały, czy profil zawiera też obsługiwane transakcje? Decyzja wpływa na schemat S-02 i regułę S-03.
2. **Co to „pełny profil”.** Propozycja do potwierdzenia: co najmniej 1 miasto, co najmniej 1 typ, min i max ceny podane z min ≤ max, lata doświadczenia podane (≥ 0). Czy dopuszczalny jest przedział otwarty (np. bez górnej granicy)? Czy 0 lat to profil pełny?
3. **Jednostki i granice.** Cena w PLN, liczby całkowite? Granice przedziału włączne? Lata całkowite, z górnym limitem (np. 60)?
4. **Lista 18 miast** — potwierdzenie listy z sekcji Wymagania (spoza repo).

Wybory techniczne (owner: plan):

5. Kolumny w `profiles` vs osobna tabela `agent_profiles`.
6. Słownik w SQL: `check`/`enum`/tabela słownikowa; zbiory jako `text[]` czy tabele łączące; slug vs nazwa z polskimi znakami.
7. Czy S-02 dodaje już odczyt profili agentów dla rankingu (polityka lub funkcja `security definer`, np. widok/funkcja zwracająca tylko pełne profile), czy zostawia to S-03. Roadmapa przypisuje słownik S-02, a odczyt archiwum zostawia „S-02/S-03”.
8. Gdzie liczyć „pełny profil”: kolumna generowana / warunek w SQL (przydatne dla rankingu w S-03) czy funkcja TS w `src/lib/services/`.
9. Ścieżka strony (`/agent/profile` czy edycja w `/agent`) i pozycja w `navFor`; kody błędów profilu (nowy moduł vs uogólnienie `auth-errors.ts`).
