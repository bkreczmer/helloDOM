# Zaproszenie agenta — Implementation Plan

## Overview

Właściciel na stronie swojej oferty w statusie „szuka agenta” klika „Zaproś” przy jednym z agentów top 3. Funkcja SQL `invite_agent` w jednej transakcji sprawdza właściciela, status oferty i obecność agenta w aktualnym top 3, zapisuje zaproszenie i przestawia ofertę na „zaproszenie wysłane”. Ranking znika ze strony oferty i zastępuje go karta statusu. Agent widzi swoje zaproszenia na `/agent` i treść oferty na `/agent/offers/[id]`, ale tylko wtedy, gdy ma do niej zaproszenie `pending` albo `accepted`. To slice S-05 (FR-009, FR-010) i pierwszy dostęp agenta do cudzych danych.

## Current State Analysis

- Status `invited` jest już dopuszczony przez check `offers_status_valid` (`supabase/migrations/20261028140000_create_offers.sql:33`), a w TS istnieje jego lustro `OFFER_STATUSES` (`src/types.ts:14-15`). Nikt nie może jednak zmienić statusu: na `offers` są tylko `grant select` i `grant insert` na 7 kolumn, bez UPDATE (`create_offers.sql:41-45`).
- Tabeli zaproszeń nie ma. Jedyna polityka select na `offers` to `offers_select_own` (`create_offers.sql:47-50`), więc agent nie widzi żadnej oferty.
- `rank_agents_for_offer` zwraca `agent_id` i sama pilnuje właściciela (`o.owner_id = (select auth.uid())`, `create_offers.sql:92`). Nie filtruje po statusie oferty. UI nie renderuje `agentId` (`src/components/owner/RankingList.astro:16`).
- Strona `/owner/offers/[id]` czyta ofertę przez RLS i woła RPC rankingu, a baner `?created=1` jest wzorcem banera sukcesu (`src/pages/owner/offers/[id].astro:23-70`).
- Wzorzec endpointu: `fail(code)` → 302 `?error=<kod>`, sesja i rola sprawdzane w endpoincie, 403 przy złej roli (`src/pages/api/owner/offers.ts:5-30`). Kody i komunikaty z allowlisty żyją w serwisie (`src/lib/services/offers.ts:167-185`).
- `/agent` to placeholder („Tu pojawią się zaproszenia od właścicieli.”, `src/pages/agent/index.astro:12`). Nawigacja agenta ma pozycje Panel i Profil (`src/components/shell/nav.ts:14-15`).
- `OfferSummary.astro` jest bezstanowy i leży w `src/components/owner/`. Nie pokazuje statusu.
- Testy: `supabase/tests/*.sql` w transakcji z rollback i `scripts/smoke.mjs` z sesjami `request` (owner), `agent`, `otherOwner`, `anonymous`. Uruchamia je job `smoke` w CI (`.github/workflows/ci.yml:43-51`).

## Desired End State

- Na `/owner/offers/<id>` w statusie `seeking_agent` każdy agent z top 3 ma przycisk „Zaproś”. Po kliknięciu właściciel wraca na stronę z banerem „Wysłano zaproszenie”, statusem „Zaproszenie wysłane” w podsumowaniu i kartą „Zaproszenie wysłane {data}. Czekamy na odpowiedź agenta.” zamiast rankingu.
- Drugie zaproszenie do tej samej oferty, zaproszenie agenta spoza aktualnego top 3 i zaproszenie do cudzej oferty kończą się odpowiednio komunikatem `offer_locked`, komunikatem `agent_not_ranked` i 404.
- Na `/agent` agent widzi listę swoich zaproszeń: miasto, typ, transakcję, cenę, status i datę, z linkiem do oferty. Przy braku zaproszeń widzi stan pusty. `/agent/offers/<id>` pokazuje ofertę bez danych właściciela albo 404, gdy agent nie ma do niej zaproszenia `pending`/`accepted`.
- Reguły dostępu są pokryte testem `supabase/tests/agent-invitation.sql`, a przepływ HTTP krokami w `scripts/smoke.mjs`.

### Key Discoveries:

- Zapis wrażliwych danych idzie wąskim kanałem: grant kolumnowy dla insertu i funkcja `security definer` z bramką `auth.uid()` (`create_offers.sql:63-102`). Grant `update (status)` pozwoliłby właścicielowi ustawić dowolny status, więc zaproszenie idzie przez funkcję.
- Polityki `offers` → `invitations` i `invitations` → `offers` dałyby „infinite recursion detected in policy”. Rozwiązaniem jest zdenormalizowany `owner_id` w `invitations`, wstawiany przez funkcję definer (research, „RLS dla zaproszeń”).
- Zapis, który nic nie zmienił, traktujemy jako błąd (`src/pages/api/agent/profile.ts:50-58`, lekcja z agent-profile F3). Tu odpowiada temu jawny kod wyniku funkcji.
- `?error=` mapowany wyłącznie przez allowlistę, bez renderowania tekstu z URL (`context/archive/2026-10-27-app-shell/reviews/impl-review.md:45-53`).
- Natywny `<form method="POST">` w `.astro` bez wyspy React: `src/components/shell/AppTopbar.astro:42-46`.
- Pill statusu: `data-status="success|warn|danger|info|accent"`, tło `-soft`, tekst `-fg` (`context/foundation/design-system.md:108`). Obowiązuje lekcja o kontraście ≥4.5:1 (`context/foundation/lessons.md`).

## What We're NOT Doing

- Przyjęcie i odrzucenie zaproszenia, status `in_progress`, wykluczenie odrzuconego agenta z rankingu (S-06).
- Dane kontaktowe którejkolwiek strony (e-mail z `auth.users`). Agent nie widzi właściciela, a właściciel nie widzi, którego agenta zaprosił. Kontakt po przyjęciu rozstrzyga S-06.
- Snapshot zaproszonego agenta (wynik, staż) w zaproszeniu. Ranking jest ukryty, a w jego miejscu jest karta statusu.
- Cofnięcie zaproszenia, limit czasu na odpowiedź (PRD Non-Goals), powiadomienia.
- Okno potwierdzenia przed wysłaniem zaproszenia i stan „wysyłanie…” (wymagałyby wyspy `.tsx`).
- Status na liście `/owner` i edycja oferty (S-04). Kontrakt dla S-04: grant UPDATE nie może obejmować `status`.
- Przywracanie statusu oferty po usunięciu konta agenta (S-07). Kaskada skasuje zaproszenie, ale oferta zostanie w `invited`, co S-07 musi obsłużyć.
- Nowa pozycja w nawigacji agenta.

## Implementation Approach

Najpierw baza z testem SQL, bo RLS i atomowość zaproszenia to główne ryzyko slice'a. Potem ścieżka właściciela (endpoint, przycisk, karta statusu), na końcu widok agenta. Każda faza kończy się zielonym smoke i jednym commitem. Funkcja `invite_agent` zwraca kod wyniku zamiast rzucać wyjątek: endpoint mapuje go na redirect, a test SQL sprawdza go zwykłym porównaniem.

## Critical Implementation Details

- **Kolejność w `invite_agent`**: najpierw `select … for update` na wierszu oferty (zawężonym do `owner_id = auth.uid()`), dopiero potem kontrola statusu i top 3. Dwa równoległe kliknięcia ustawiają się wtedy w kolejce, a drugie widzi już `invited`. Częściowy indeks unikalny jest drugą linią obrony: jego `unique_violation` funkcja zamienia na `offer_locked`.
- **Smoke a lokalni agenci**: każdy przebieg smoke zakłada agenta z tym samym profilem (85 pkt). Remis rozstrzyga `created_at asc`, więc lokalnie starsi smoke-agenci wypychają nowego z top 3 (w lokalnej bazie jest ich już 7). Dlatego smoke-agent dostaje przedział cenowy unikalny dla przebiegu (`priceMin = priceMax = 500000 + Date.now() % 100000`) i staż 60 lat, a oferta `rankedOfferId` ma dokładnie tę cenę. Ma wtedy 100 pkt i wygrywa remisy, bo `experience_years desc` porównuje surowy staż (`create_offers.sql:97`). Starzy smoke-agenci nie trafiają w cenę. Smoke-agent jest więc „Agentem 1”, a jego id smoke bierze z ukrytego `agentId` pierwszego formularza „Zaproś” w HTML strony oferty, bez parsowania ciasteczka sesji.

## Phase 1: Baza — zaproszenia i RLS

### Overview

Tabela `invitations`, funkcja `invite_agent` i polityka, dzięki której agent czyta ofertę z aktywnym zaproszeniem. Wszystko pokryte testem SQL, typy wygenerowane.

### Changes Required:

#### 1. Migracja

**File**: `supabase/migrations/20261028180000_create_invitations.sql`

**Intent**: Utworzyć zaproszenia z RLS bez rekursji i jedyną ścieżkę zapisu zaproszenia oraz zmiany statusu oferty. Agent dostaje odczyt ofert tylko przez aktywne zaproszenie. Nagłówek z komentarzem i blok `-- down:` jak w poprzednich migracjach.

**Contract**:
- `public.invitations`: `id uuid pk default gen_random_uuid()`, `offer_id uuid not null references public.offers(id) on delete cascade`, `agent_id uuid not null references public.profiles(id) on delete cascade`, `owner_id uuid not null references public.profiles(id) on delete cascade` (zdenormalizowany, ustawia go funkcja), `status text not null default 'pending' check (status in ('pending','accepted','rejected'))`, `created_at timestamptz not null default now()`.
- Ograniczenia i indeksy: `unique (offer_id, agent_id)`; częściowy indeks unikalny `invitations_one_active_per_offer` na `(offer_id) where status in ('pending','accepted')` (pokrywa też guardrail „najwyżej jeden przyjęty agent” dla S-06); indeks `(agent_id, created_at desc)` pod listę agenta.
- RLS włączone; `revoke all … from anon, authenticated`; `grant select … to authenticated`; `grant all … to service_role`. Bez insert/update/delete dla `authenticated`, bo zapis idzie wyłącznie przez funkcję.
- Polityki select (nie dotykają `offers`): `invitations_select_own_owner` (`owner_id = (select auth.uid())`), `invitations_select_own_agent` (`agent_id = (select auth.uid())`).
- Polityka na `offers`: `offers_select_invited_agent` (select, `to authenticated`) z warunkiem `exists (select 1 from public.invitations i where i.offer_id = offers.id and i.agent_id = (select auth.uid()) and i.status in ('pending','accepted'))`.
- `public.invite_agent(p_offer_id uuid, p_agent_id uuid) returns text`, `language plpgsql volatile security definer set search_path = ''`. Kody wyniku:
  - `not_found`: brak oferty albo oferta należy do kogoś innego (także gdy woła agent);
  - `offer_locked`: status ≠ `seeking_agent` albo `unique_violation`;
  - `agent_not_ranked`: `p_agent_id` nie występuje w `public.rank_agents_for_offer(p_offer_id)`;
  - `ok`: wstawiono zaproszenie z `owner_id = auth.uid()` i ustawiono `offers.status = 'invited'`.
- Uprawnienia: `revoke execute … from public, anon`; `grant execute … to authenticated`.

#### 2. Test SQL

**File**: `supabase/tests/agent-invitation.sql`

**Intent**: Udowodnić reguły zaproszenia i dostępu w transakcji z rollback, wzorem `supabase/tests/offer-ranking.sql`: użytkownicy w `auth.users`, lokalni agenci wyłączeni przez `cities = '{}'`, oczekiwane błędy w `do $$`, `set local role authenticated` z `request.jwt.claims`.

**Contract**: Przypadki co najmniej:
- właściciel zaprasza agenta z top 3 → `ok`, oferta `invited`, zaproszenie `pending` z poprawnym `owner_id`;
- drugie zaproszenie do tej oferty (inny agent z top 3) → `offer_locked`, wiersz bez zmian;
- agent spoza top 3 (czwarty), agent z innego miasta i losowy uuid → `agent_not_ranked`;
- inny właściciel dla cudzej oferty, nieistniejąca oferta i wywołanie przez agenta → `not_found`;
- zaproszony agent widzi ofertę przez select, a niezaproszony agent widzi 0 wierszy;
- agent z zaproszeniem przestawionym (jako postgres) na `rejected` widzi 0 wierszy oferty, ale dalej widzi swoje zaproszenie;
- właściciel widzi tylko zaproszenia swoich ofert, a agent tylko swoje;
- `authenticated` nie może wstawić, zmienić ani usunąć zaproszenia ani zmienić `offers.status`;
- indeks: drugie `pending` dla oferty → `unique_violation`, a `rejected` + nowe `pending` dla innego agenta przechodzi;
- usunięcie oferty kasuje jej zaproszenia;
- `anon` nie ma `execute` funkcji.

#### 3. Typy bazy

**File**: `src/db/database.types.ts`

**Intent**: Wygenerować typy z tabelą `invitations`, jej relacjami i funkcją `invite_agent`.

**Contract**: `npm run db:types`, bez ręcznych edycji.

### Success Criteria:

#### Automated Verification:

- Migracja stosuje się lokalnie: `npx supabase migration up` (bez kasowania kont); czystą bazę potwierdza job smoke w CI
- Test SQL zaproszeń przechodzi: `docker exec -i supabase_db_10x-astro-starter psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/agent-invitation.sql`
- Poprzednie testy SQL nadal przechodzą: `supabase/tests/agent-profile.sql`, `supabase/tests/offer-ranking.sql`
- Typy są aktualne: `npm run db:types && git diff --exit-code src/db/database.types.ts` po commicie typów
- Typy i lint przechodzą: `npx astro check && npm run lint`

**Implementation Note**: Faza nie ma kroków ręcznych. Commit obejmuje migrację, test, typy i zmianę statusu w roadmapie z `/10x-plan`.

---

## Phase 2: Zaproszenie przez właściciela

### Overview

Endpoint zaproszenia, przycisk „Zaproś” w rankingu, status oferty w podsumowaniu i karta „Zaproszenie wysłane” zamiast rankingu, plus kroki smoke.

### Changes Required:

#### 1. Słowniki, typy i pill statusu

**File**: `src/lib/dictionaries.ts`, `src/types.ts`, `src/components/ui/StatusPill.astro`

**Intent**: Polskie etykiety statusów oferty i zaproszenia w jednym miejscu oraz prosty pill zgodny z design systemem. Pokazuje go podsumowanie oferty (faza 2) i lista agenta (faza 3).

**Contract**:
- `OFFER_STATUS_LABELS: Record<OfferStatus, string>`: Szkic, Szuka agenta, Zaproszenie wysłane, W obsłudze.
- `INVITATION_STATUSES = ["pending","accepted","rejected"] as const` w `src/types.ts` (komentarz o zgodności z checkiem migracji) i `InvitationStatus`.
- `INVITATION_STATUS_LABELS`: Oczekuje na odpowiedź, Przyjęte, Odrzucone.
- `StatusPill.astro`: props `tone: "success"|"warn"|"danger"|"info"|"accent"` i slot z tekstem. Używa istniejących tokenów `-soft`/`-fg`, bez nowych kolorów. Jeśli trzeba dodać token, obowiązuje lekcja o kontraście.

#### 2. Serwis zaproszeń

**File**: `src/lib/services/invitations.ts`

**Intent**: Walidacja formularza zaproszenia oraz kody błędów z komunikatami według wzorca `src/lib/services/offers.ts`. Serwis nie robi zapytań.

**Contract**:
- `parseInviteForm(formData)`: zod `{ offerId: z.uuid(), agentId: z.uuid() }`.
- `INVITE_RESULTS = ["ok","not_found","offer_locked","agent_not_ranked"]`.
- `INVITATION_ERROR_CODES = ["invalid_input","unavailable","unknown","offer_locked","agent_not_ranked"]` z komunikatami: `offer_locked` — „Do tej oferty wysłano już zaproszenie.”, `agent_not_ranked` — „Ranking agentów się zmienił. Wybierz agenta z aktualnej listy.”, pozostałe w stylu istniejących.
- `invitationErrorMessage(code: string | null): string | null`: nieznany kod daje komunikat `unknown`.

#### 3. Endpoint

**File**: `src/pages/api/owner/invitations.ts`

**Intent**: Przyjąć natywny POST z karty rankingu, sprawdzić sesję i rolę, wywołać `invite_agent` i przekierować na stronę oferty z wynikiem.

**Contract**: `POST`:
- brak klienta → `unavailable`;
- brak sesji → 302 `/auth/signin`;
- błąd odczytu roli → `unavailable`, rola ≠ owner → 403;
- błąd parsowania formularza → 302 `/owner/offers/{offerId}?error=invalid_input`, gdy `offerId` jest poprawnym uuid, inaczej 302 `/owner`;
- `rpc("invite_agent")`: `ok` → 302 `/owner/offers/{offerId}?invited=1`; `not_found` → `404 Not Found`; `offer_locked` / `agent_not_ranked` → 302 `?error=<kod>`; błąd RPC albo nieznana wartość → `?error=unknown`.

#### 4. Strona oferty właściciela

**File**: `src/pages/owner/offers/[id].astro`, `src/components/owner/RankingList.astro`, `src/components/owner/InvitationStatusCard.astro` (nowy), `src/components/offers/OfferSummary.astro` (przeniesiony z `src/components/owner/`)

**Intent**:
- Ranking i przyciski są tylko w statusie `seeking_agent`.
- W innym statusie strona nie woła RPC rankingu. Czyta przez RLS aktywne zaproszenie oferty (`status in ('pending','accepted')`) i pokazuje kartę statusu.
- Podsumowanie pokazuje status oferty.
- Baner sukcesu `?invited=1` działa jak `?created=1`, a `?error=` idzie przez `invitationErrorMessage`.

**Contract**:
- `RankingList` dostaje `offerId`. Każda karta ma `<form method="POST" action="/api/owner/invitations">` z ukrytymi `offerId` i `agentId` oraz przycisk `accent` „Zaproś”. Dostępna nazwa przycisku wskazuje agenta, np. `aria-label="Zaproś agenta 2"`.
- `InvitationStatusCard`: props `status: OfferStatus`, `invitedAt: string | null`. Dla `invited` pokazuje tekst „Zaproszenie wysłane {data}. Czekamy na odpowiedź agenta.”, przy braku daty bez daty. Dla innych statusów pokazuje etykietę z `OFFER_STATUS_LABELS`.
- `OfferSummary` dostaje `StatusPill` ze statusem oferty, a import na stronie właściciela zmienia ścieżkę.
- Błąd odczytu zaproszenia daje kartę bez daty, nie 500.

#### 5. Smoke

**File**: `scripts/smoke.mjs`

**Intent**: Pokryć ścieżkę właściciela i granice endpointu po istniejących krokach rankingu, na ofercie `rankedOfferId`.

**Contract**: Kroki:
1. Profil smoke-agenta i oferta `rankedOfferId` z unikalną ceną i stażem 60 lat (zob. Critical Implementation Details); id smoke-agenta to `agentId` z pierwszego formularza „Zaproś” na stronie oferty.
2. Agent → `POST /api/owner/invitations` → 403; anonim → 302 `/auth/signin`.
3. Drugi właściciel na `rankedOfferId` → 404.
4. Brak `agentId` → 302 `…?error=invalid_input`.
5. Losowy uuid agenta → 302 `…?error=agent_not_ranked`.
6. Zaproszenie smoke-agenta → 302 `/owner/offers/{id}?invited=1`.
7. Strona oferty zawiera „Wysłano zaproszenie” i „Zaproszenie wysłane”, a nie zawiera „Zaproś” ani e-maila agenta.
8. Ponowne zaproszenie → 302 `…?error=offer_locked`.

### Success Criteria:

#### Automated Verification:

- Typy i lint przechodzą: `npx astro check && npm run lint`
- Build przechodzi: `npm run build`
- Smoke przechodzi na podglądzie, w tym kroki zaproszenia: `npm run smoke`
- Test SQL zaproszeń nadal przechodzi: `supabase/tests/agent-invitation.sql`

#### Manual Verification:

- Wiersz zaproszenia smoke ma `owner_id` właściciela i `status = 'pending'`, a oferta ma `status = 'invited'` (psql na lokalnej bazie)
- Strona oferty przed i po zaproszeniu: przyciski „Zaproś”, baner, pill statusu, karta statusu; light/dark, 360 px, fokus i klawiatura na przyciskach
- Komunikaty `offer_locked` i `agent_not_ranked` widoczne na stronie oferty po ręcznym wywołaniu URL z `?error=`

**Implementation Note**: Po zielonej weryfikacji automatycznej zatrzymaj się na potwierdzenie kroków ręcznych.

---

## Phase 3: Widok agenta

### Overview

Lista zaproszeń na `/agent` i strona oferty dla agenta z 404 bez aktywnego zaproszenia, plus kroki smoke pod IDOR i role.

### Changes Required:

#### 1. Serwis i typy

**File**: `src/lib/services/invitations.ts`, `src/types.ts`

**Intent**: DTO pozycji listy zaproszeń agenta i mapper z wiersza z osadzoną ofertą.

**Contract**:
- `AgentInvitationItem { id, status: InvitationStatus, createdAt, offer: Pick<Offer, "id"|"city"|"propertyType"|"transaction"|"price"> | null }`. `offer` jest `null`, gdy RLS ukrywa ofertę, czyli po odrzuceniu w S-06.
- `toAgentInvitationItem(row)` zawęża słowniki tak jak `oneOf` w serwisie ofert. Wspólny helper można wydzielić, jeśli jest potrzebny w obu serwisach.
- `AGENT_INVITATIONS_LIMIT = 50`.

#### 2. Panel agenta

**File**: `src/pages/agent/index.astro`, `src/components/agent/InvitationList.astro` (nowy)

**Intent**: Zastąpić placeholder listą zaproszeń agenta (najnowsze pierwsze). Karta profilu zostaje.

**Contract**:
- Zapytanie przez RLS: `invitations.select("id, status, created_at, offers(id, city, property_type, transaction, price)")` sortowane `created_at desc`, z limitem.
- Pozycja listy: miasto, typ, transakcja, cena, `StatusPill` statusu zaproszenia, data i link „Zobacz ofertę” do `/agent/offers/{offer.id}`. Przy `offer === null` link znika, a pozycja pokazuje „Oferta niedostępna”.
- Stan pusty: „Nie masz jeszcze zaproszeń. Właściciele zapraszają agentów z rankingu top 3 — pełny profil daje Ci w nim miejsce.” Błąd zapytania daje `ServerError`.

#### 3. Oferta dla agenta

**File**: `src/pages/agent/offers/[id].astro`

**Intent**: Szczegół oferty, do której agent ma aktywne zaproszenie, według wzorca `/owner/offers/[id].astro`: UUID → 404, odczyt przez RLS → 404 i „Ta oferta nie istnieje albo nie masz do niej zaproszenia.”.

**Contract**:
- Select tych samych kolumn co strona właściciela, bez `owner_id`.
- `OfferSummary` i zdanie „Zaproszono Cię do tej oferty {data}.” z zaproszenia agenta.
- Link powrotu do `/agent`. Bez danych właściciela i bez akcji (S-06).

#### 4. Smoke

**File**: `scripts/smoke.mjs`

**Intent**: Pokryć widok agenta i IDOR po krokach zaproszenia.

**Contract**: Kroki:
1. Agent `/agent` → 200 z „Warszawa” i linkiem `/agent/offers/{rankedOfferId}`.
2. Agent `/agent/offers/{rankedOfferId}` → 200, bez e-maila właściciela.
3. Agent `/agent/offers/{offerId}` (oferta bez zaproszenia) → 404.
4. Agent ze złym uuid → 404.
5. Właściciel na `/agent/offers/…` → przekierowanie strażnika ról (jak istniejący krok odwrotny).
6. Anonim → 302 na logowanie.

### Success Criteria:

#### Automated Verification:

- Typy i lint przechodzą: `npx astro check && npm run lint`
- Build przechodzi: `npm run build`
- Smoke przechodzi na podglądzie, w tym kroki agenta i IDOR: `npm run smoke`
- Testy SQL nadal przechodzą: `supabase/tests/*.sql`

#### Manual Verification:

- Panel agenta z zaproszeniem i bez zaproszeń (nowe konto agenta): lista, pill, stan pusty, link; light/dark, 360 px, fokus i klawiatura
- Strona oferty agenta: podsumowanie bez danych właściciela, 404 dla oferty bez zaproszenia wpisanej ręcznie w URL
- Na produkcji po `db push` i deployu: właściciel zaprasza agenta z top 3, agent widzi zaproszenie i ofertę (konta testowe z uwzględnieniem limitu maili)

**Implementation Note**: Po zielonej weryfikacji automatycznej zatrzymaj się na potwierdzenie kroków ręcznych. Krok produkcyjny wykonaj po merge.

---

## Testing Strategy

### Unit Tests:

- Brak frameworka testowego. Reguły zaproszenia i RLS testuje SQL (`supabase/tests/agent-invitation.sql`): kody wyniku funkcji, atomowa zmiana statusu, widoczność oferty dla agenta (`pending` tak, `rejected` nie), izolacja zaproszeń między właścicielami i agentami, brak zapisu bez funkcji, indeks jednego aktywnego zaproszenia, kaskada.

### Integration Tests:

- Smoke: endpoint zaproszenia (rola, anonim, cudza oferta, zły formularz, agent spoza rankingu, sukces, ponowne zaproszenie), strona oferty po zaproszeniu, panel agenta, oferta agenta (z zaproszeniem, bez zaproszenia, zły uuid, zła rola, anonim).

### Manual Testing Steps:

1. Lokalnie załóż właściciela i 2 agentów przez `POST /api/auth/signup` i uzupełnij profile agentów (to samo miasto).
2. Jako właściciel dodaj ofertę, zaproś agenta 2 i sprawdź baner, pill i kartę statusu.
3. Zaloguj się jako zaproszony agent i sprawdź `/agent` oraz stronę oferty. Zaloguj się jako drugi agent i sprawdź pustą listę oraz 404 na URL oferty.
4. Na produkcji powtórz punkty 2–3 na istniejących kontach testowych.

## Performance Considerations

Polityka agenta na `offers` korzysta z indeksu `unique (offer_id, agent_id)`, a lista agenta z indeksu `(agent_id, created_at desc)`. `invite_agent` liczy ranking raz na kliknięcie. Przy skali MVP to pomijalne.

## Migration Notes

Nowa tabela, polityka i funkcja, bez zmian istniejących danych. Na produkcję przed merge: `npx supabase db push --dry-run` (pokazać wynik i czekać na zgodę) → `npx supabase db push`. Cofnięcie: blok `-- down:` (drop policy `offers_select_invited_agent`, drop function `invite_agent`, drop table `invitations`), a oferty w `invited` trzeba ręcznie przywrócić do `seeking_agent`.

## References

- Research: `context/changes/agent-invitation/research.md`
- PRD: `context/foundation/prd.md` (FR-009, FR-010, FR-011, Access Control)
- Roadmapa: `context/foundation/roadmap.md` (S-05)
- Wzorzec definer i rankingu: `supabase/migrations/20261028140000_create_offers.sql:63-102`
- Wzorzec endpointu: `src/pages/api/owner/offers.ts:5-69`
- Wzorzec strony szczegółu: `src/pages/owner/offers/[id].astro`
- Wzorzec testu SQL: `supabase/tests/offer-ranking.sql`
- Poprzedni plan: `context/archive/2026-10-28-offer-top3-ranking/plan.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Baza — zaproszenia i RLS

#### Automated

- [x] 1.1 Migracja stosuje się lokalnie — 42710f0
- [x] 1.2 Test SQL zaproszeń przechodzi — 42710f0
- [x] 1.3 Poprzednie testy SQL nadal przechodzą — 42710f0
- [x] 1.4 Typy są aktualne — 42710f0
- [x] 1.5 Typy i lint przechodzą — 42710f0

### Phase 2: Zaproszenie przez właściciela

#### Automated

- [x] 2.1 Typy i lint przechodzą — 1546189
- [x] 2.2 Build przechodzi — 1546189
- [x] 2.3 Smoke przechodzi na podglądzie, w tym kroki zaproszenia — 1546189
- [x] 2.4 Test SQL zaproszeń nadal przechodzi — 1546189

#### Manual

- [x] 2.5 Wiersz zaproszenia smoke ma owner_id właściciela i status pending, a oferta status invited — 1546189
- [x] 2.6 Strona oferty przed i po zaproszeniu: przyciski, baner, pill, karta; light/dark, 360 px, fokus — 1546189
- [x] 2.7 Komunikaty offer_locked i agent_not_ranked widoczne na stronie oferty — 1546189

### Phase 3: Widok agenta

#### Automated

- [x] 3.1 Typy i lint przechodzą — 74a1d50
- [x] 3.2 Build przechodzi — 74a1d50
- [x] 3.3 Smoke przechodzi na podglądzie, w tym kroki agenta i IDOR — 74a1d50
- [x] 3.4 Testy SQL nadal przechodzą — 74a1d50

#### Manual

- [x] 3.5 Panel agenta z zaproszeniem i bez: lista, pill, stan pusty; light/dark, 360 px, fokus — 74a1d50
- [x] 3.6 Strona oferty agenta bez danych właściciela i 404 bez zaproszenia — 74a1d50
- [x] 3.7 Na produkcji właściciel zaprasza agenta, a agent widzi zaproszenie i ofertę — 74a1d50
