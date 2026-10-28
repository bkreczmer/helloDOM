# Odpowiedź na zaproszenie — Implementation Plan

## Overview

Agent przyjmuje zaproszenie (zaproszenie `accepted`, oferta `in_progress`) albo je odrzuca (zaproszenie `rejected`, oferta wraca do `seeking_agent`, a ten agent na stałe wypada z rankingu tej oferty). Właściciel widzi wynik: kartę „W obsłudze” z datą przyjęcia albo informację o odrzuceniu nad nowym rankingiem. S-06, FR-011; domyka drugie główne kryterium sukcesu PRD.

## Current State Analysis

- `invitations.status` dopuszcza już `pending | accepted | rejected`, a `offers.status` dopuszcza `in_progress` (`supabase/migrations/20261028140000_create_offers.sql:33`, `20261028180000_create_invitations.sql:16`).
- `authenticated` ma na `invitations` i `offers` tylko `select` (plus insert kolumnowy na `offers`). Każda zmiana statusu musi więc iść przez funkcję `security definer`, tak jak `invite_agent` (`20261028180000_create_invitations.sql:75-121`).
- Częściowy unikalny indeks `invitations_one_active_per_offer` (`:22-23`) gwarantuje najwyżej jedno aktywne (`pending`/`accepted`) zaproszenie na ofertę. To pokrywa regułę „najwyżej jeden przyjęty agent” (PRD Guardrails).
- `rank_agents_for_offer` (`20261028140000_create_offers.sql:68-98`) nie wie o zaproszeniach. Odrzucony agent wróciłby do top 3, a `unique (offer_id, agent_id)` sprawiłby, że ponowne zaproszenie skończy się mylącym `offer_locked` (impl-review agent-invitation F3).
- `offers_select_invited_agent` (`20261028180000_create_invitations.sql:47-57`) dopuszcza ofertę tylko przy `pending`/`accepted`. Po odrzuceniu agent automatycznie traci do niej dostęp. Na `/agent` wiersz pokazuje wtedy „Oferta niedostępna” (`src/components/agent/InvitationList.astro:39-41`), a `/agent/offers/[id]` zwraca 404.
- Brak daty odpowiedzi: `invitations` ma tylko `created_at`.
- `/agent/offers/[id]` pokazuje kartę „Zaproszenie” bez akcji (`src/pages/agent/offers/[id].astro:72-88`). Strona właściciela przy statusie ≠ `seeking_agent` pokazuje `InvitationStatusCard` z ogólnym tekstem dla `in_progress` (`src/components/owner/InvitationStatusCard.astro:26-28`).
- Wzorce do ponownego użycia:
  - `useNativeSubmitting` (`src/components/hooks/useNativeSubmitting.ts`) i `SubmitButton` (`src/components/auth/SubmitButton.tsx`) dla stanu wysyłania natywnego POST;
  - warianty `accent` i `destructive` w `src/components/ui/button.tsx:14-19`;
  - allowlista `?error=` w `src/lib/services/invitations.ts:37-62`;
  - endpoint `src/pages/api/owner/invitations.ts` (sesja, rola, `rpc`, mapowanie kodu na redirect).

## Desired End State

- Agent na `/agent/offers/[id]` z zaproszeniem `pending` widzi „Przyjmij” i „Odrzuć”. Każdy z tych przycisków najpierw pokazuje inline potwierdzenie i dopiero „Tak, …” wysyła formularz.
- Po przyjęciu agent wraca na stronę oferty z banerem „Przyjęto zaproszenie”. Karta pokazuje „Przyjęto zaproszenie {data}. Oferta jest w obsłudze.” i nie ma już przycisków.
- Po odrzuceniu agent trafia na `/agent` z banerem „Odrzucono zaproszenie”. Wiersz ma status „Odrzucone” i „Oferta niedostępna”, a strona oferty daje 404.
- Druga odpowiedź (np. z drugiej karty przeglądarki) kończy się komunikatem „Na to zaproszenie już odpowiedziano.”.
- Właściciel oferty `in_progress` widzi kartę „W obsłudze”: „Agent przyjął zaproszenie {data}.”
- Właściciel oferty, która wróciła do `seeking_agent`, widzi nad rankingiem informację „Agent odrzucił zaproszenie {data}. Wybierz kolejnego agenta z rankingu.”. Ranking nie zawiera odrzucającego agenta i można zaprosić kolejnego.
- Weryfikacja: test SQL `supabase/tests/invitation-response.sql`, kroki smoke, ręczne sprawdzenie wyspy (fokus, klawiatura, 360 px, light/dark).

### Key Discoveries:

- `invite_agent` blokuje wiersz oferty `for update` przed kontrolami (`20261028180000_create_invitations.sql:87-91`). Nowa funkcja blokuje w tej samej kolejności (oferta, potem zaproszenie), żeby uniknąć zakleszczenia.
- `invite_agent` sprawdza obecność agenta w `rank_agents_for_offer`. Wykluczenie odrzuconych w rankingu sprawia więc, że ponowne zaproszenie odrzuconego agenta zwraca `agent_not_ranked`. Samego `invite_agent` nie trzeba zmieniać.
- Polityki `invitations` nie mogą czytać `offers` (rekursja polityk, komentarz `:4-6`). Nowa funkcja jest `security definer`, więc polityk nie zmienia.
- Lekcja „odhaczaj krok ręczny po zobaczeniu stanu”: stan wysyłania przy natywnym POST działa tylko przez `onSubmit` + `useNativeSubmitting`, a nie przez `useFormStatus`.

## What We're NOT Doing

- Kontakt między stronami (e-mail) po przyjęciu: trafia do `## Parked` w roadmapie (decyzja planu).
- Cofnięcie przyjęcia, zmiana zdania po odrzuceniu, cofnięcie zaproszenia przez właściciela.
- Przyciski odpowiedzi na liście `/agent`: tylko na stronie oferty.
- Historia zaproszeń oferty u właściciela (poza informacją o ostatnim odrzuceniu).
- Status oferty na liście `/owner` i edycja oferty (S-04); przywracanie `seeking_agent` po usunięciu konta (S-07).
- Grant kolumnowy ukrywający `owner_id` przed agentem (impl-review agent-invitation F4, zaakceptowane).
- Limit czasu na odpowiedź i powiadomienia (PRD Non-Goals).

## Implementation Approach

Jedna funkcja SQL `respond_to_invitation(p_offer_id, p_response)` jest jedyną ścieżką zapisu odpowiedzi. W jednej transakcji ustawia status zaproszenia, `responded_at` i status oferty, a wynik zwraca jako kod. Ranking dostaje warunek wykluczający odrzuconych. Endpoint agenta powiela strukturę endpointu właściciela. UI agenta to jedna wyspa `.tsx` z dwoma formularzami i stanem potwierdzenia. UI właściciela czyta `responded_at` przez istniejącą politykę `invitations_select_own_owner`.

## Critical Implementation Details

- **State sequencing**: w `respond_to_invitation` najpierw `select … from offers … for update`, potem `select … from invitations … for update`. Ta kolejność jest taka sama jak w `invite_agent`, więc współbieżne zaproszenie i odpowiedź nie zakleszczą się. Druga równoległa odpowiedź tego samego agenta czeka na blokadę i widzi status ≠ `pending`, czyli `already_responded`.
- **User experience spec**: po kliknięciu „Przyjmij”/„Odrzuć” fokus przechodzi na przycisk potwierdzenia, a „Anuluj” zwraca go na przycisk wyjściowy. W stanie potwierdzenia widać tylko jeden formularz.

## Phase 1: Baza — odpowiedź i ranking bez odrzuconych

### Overview

Migracja z kolumną `responded_at`, funkcją `respond_to_invitation` i nową wersją `rank_agents_for_offer`, do tego test SQL i wygenerowane typy.

### Changes Required:

#### 1. Migracja

**File**: `supabase/migrations/20261028200000_invitation_response.sql`

**Intent**: Dać agentowi atomową, jedyną ścieżkę odpowiedzi na własne zaproszenie i usunąć odrzuconych agentów z rankingu oferty (PRD Business Logic).

**Contract**:
- `alter table public.invitations add column responded_at timestamptz;` plus check `invitations_responded_at_matches_status`: `(status = 'pending') = (responded_at is null)`. Brak grantów zapisu dla `authenticated` (bez zmian).
- `create or replace function public.rank_agents_for_offer(p_offer_id uuid)` z tą samą sygnaturą, zwracanym typem, rankingiem i bramką właściciela. Dochodzi warunek `and not exists (select 1 from public.invitations i where i.offer_id = o.id and i.agent_id = p.id and i.status = 'rejected')`. Komentarz nad funkcją dopisuje regułę wykluczenia. Granty `execute` bez zmian (powtórzyć `revoke`/`grant` po `create or replace`).
- `public.respond_to_invitation(p_offer_id uuid, p_response text) returns text`, `plpgsql volatile security definer set search_path = ''`. Kody wyniku:
  - `invalid_response`: `p_response` nie jest `accept` ani `reject`;
  - `not_found`: brak zaproszenia `(p_offer_id, auth.uid())`, co obejmuje też brak oferty, cudzą ofertę i wywołanie przez właściciela;
  - `already_responded`: zaproszenie nie jest `pending` albo oferta nie jest `invited`;
  - `ok`: przy `accept` zaproszenie przechodzi w `accepted`, oferta w `in_progress`; przy `reject` zaproszenie przechodzi w `rejected`, oferta w `seeking_agent`; w obu przypadkach `responded_at = now()`.
- Kolejność blokad opisana w Critical Implementation Details. `revoke execute … from public, anon; grant execute … to authenticated;`.
- Blok `-- down:`:
  - `drop function respond_to_invitation`;
  - odtworzenie poprzedniej definicji `rank_agents_for_offer` (z odwołaniem do `20261028140000_create_offers.sql`);
  - `drop constraint`, `drop column responded_at`;
  - uwaga, że oferty `in_progress` zostają.

#### 2. Test SQL

**File**: `supabase/tests/invitation-response.sql`

**Intent**: Udowodnić kody wyniku, atomowe zmiany statusów, wykluczenie z rankingu i reguły dostępu w jednej transakcji z `rollback`, według wzorca `supabase/tests/agent-invitation.sql`.

**Contract**: Własne UUID z prefiksem `00000000-0000-0000-0005-…` (`0003`/`0004` zajmuje `agent-invitation.sql`) i ten sam reset lokalnych agentów (`update profiles set cities = '{}' where role = 'agent'`). Przypadki:
- agent A (top 1) odrzuca:
  - `ok`, zaproszenie ma `rejected` i `responded_at`, oferta wraca do `seeking_agent`;
  - `rank_agents_for_offer` nie zwraca A, a dawny czwarty agent wchodzi do top 3;
  - `invite_agent(offer, A)` zwraca `agent_not_ranked`;
  - A nie widzi oferty przez RLS;
  - właściciel zaprasza agenta B i dostaje `ok`;
- druga odpowiedź A (już `rejected`) daje `already_responded`, nie `not_found`;
- agent B przyjmuje:
  - `ok`, zaproszenie `accepted`, oferta `in_progress`;
  - B nadal widzi ofertę;
  - `invite_agent` na tej ofercie zwraca `offer_locked`;
- druga odpowiedź B (`reject`) zwraca `already_responded`, a stan się nie zmienia;
- agent C bez zaproszenia i właściciel dostają `not_found`; `p_response = 'maybe'` zwraca `invalid_response`;
- `update public.invitations set status = 'accepted'` jako `authenticated` kończy się błędem uprawnień;
- check `responded_at`/status odrzuca `pending` z `responded_at`;
- `anon` nie ma `execute` na `respond_to_invitation`.

#### 3. Istniejący test zaproszeń

**File**: `supabase/tests/agent-invitation.sql`

**Intent**: Dostosować zapisy postgresa do nowego checku `invitations_responded_at_matches_status`, żeby test nadal sprawdzał to, co sprawdzał.

**Contract**: `responded_at = now()` w `update … set status = 'rejected'` (`:232`) oraz w insertach ze statusem `accepted` (`:262`) i `rejected` (`:273`). Inserty dalej kończą się `unique_violation`, a nie `check_violation`.

#### 4. Typy bazy

**File**: `src/db/database.types.ts`

**Intent**: Typy z kolumną `responded_at` i funkcją `respond_to_invitation`; CI sprawdza zgodność.

**Contract**: `npm run db:types` po `npx supabase migration up`; plik commitowany.

### Success Criteria:

#### Automated Verification:

- Migracja aplikuje się lokalnie: `npx supabase migration up`
- Wszystkie testy SQL przechodzą: `for f in supabase/tests/*.sql; do docker exec -i supabase_db_10x-astro-starter psql -U postgres -v ON_ERROR_STOP=1 < "$f"; done`
- Typy aktualne: `npm run db:types && git diff --exit-code src/db/database.types.ts` (po commicie)
- `npx astro check` i `npm run lint` bez błędów

---

## Phase 2: Odpowiedź agenta

### Overview

Endpoint odpowiedzi, wyspa „Przyjmij / Odrzuć” z potwierdzeniem na stronie oferty agenta, banery wyniku i kroki smoke agenta.

### Changes Required:

#### 1. Serwis zaproszeń

**File**: `src/lib/services/invitations.ts`

**Intent**: Walidacja formularza odpowiedzi i kody błędów agenta z polskimi komunikatami, według istniejącego wzorca zaproszeń. Serwis nie wykonuje zapytań.

**Contract**:
- `respondSchema = z.object({ offerId: z.uuid(), response: z.enum(["accept", "reject"]) })`, `parseRespondForm(formData)`.
- `RESPOND_RESULTS = ["ok", "not_found", "already_responded", "invalid_response"]` + `isRespondResult`; komentarz o zgodności z funkcją SQL.
- `RESPONSE_ERROR_CODES = ["invalid_input", "unavailable", "unknown", "already_responded"]` + `invitationResponseErrorMessage(code)`. Komunikaty:
  - `already_responded`: „Na to zaproszenie już odpowiedziano.”;
  - `unavailable`: „Odpowiadanie na zaproszenia jest chwilowo niedostępne. Spróbuj ponownie za chwilę.”;
  - `unknown`: „Nie udało się zapisać odpowiedzi. Spróbuj ponownie.”;
  - `invalid_input`: „Nie udało się odczytać odpowiedzi. Spróbuj ponownie.”;
  - nieznany kod daje komunikat `unknown`.

#### 2. Endpoint

**File**: `src/pages/api/agent/invitations.ts`

**Intent**: Przyjąć natywny POST z wyspy, sprawdzić sesję i rolę agenta, wywołać `respond_to_invitation` i przekierować z wynikiem. Struktura jak w `src/pages/api/owner/invitations.ts`.

**Contract**: `POST`:
- `formData()` w `try/catch`. Błąd wraca na `/agent/offers/{offerId}?error=<kod>`, gdy `offerId` jest poprawnym uuid, inaczej na `/agent`.
- Brak klienta → `unavailable`; brak sesji → 302 `/auth/signin`; błąd odczytu roli → `unavailable`; rola ≠ `agent` → 403.
- Błąd parsowania → `invalid_input`.
- `rpc("respond_to_invitation")`:
  - `ok` + `accept` → 302 `/agent/offers/{offerId}?accepted=1`;
  - `ok` + `reject` → 302 `/agent?rejected=1`;
  - `not_found` → `404 Not Found`;
  - `already_responded` → 302 `/agent?error=already_responded` (po odrzuceniu strona oferty daje 404, więc komunikat pokazuje panel);
  - `invalid_response`, błąd RPC albo nieznana wartość → `?error=unknown`.

#### 3. Wyspa odpowiedzi

**File**: `src/components/agent/InvitationResponse.tsx` (nowy)

**Intent**: Dwie akcje z potwierdzeniem inline, bo obie są nieodwracalne. To wyspa `.tsx`, bo ma stan (konwencja z CLAUDE.md).

**Contract**:
- Props: `offerId: string`.
- Stan `step: "idle" | "accept" | "reject"`; stan wysyłania przez `useNativeSubmitting` w `onSubmit`.
- Stan `idle`: krótki tekst „Przyjmij zaproszenie, żeby zająć się ofertą, albo je odrzuć.” oraz przyciski „Przyjmij” (`accent`) i „Odrzuć” (`destructive`).
- Stan `accept`: tekst „Przyjąć zaproszenie? Oferta przejdzie w obsługę i nie da się tego cofnąć.”, formularz POST `/api/agent/invitations` z ukrytymi `offerId` i `response=accept`, przyciski „Tak, przyjmij” (submit, pending „Zapisywanie…”) i „Anuluj” (`ghost`).
- Stan `reject`: analogicznie, tekst „Odrzucić zaproszenie? Oferta zniknie z Twojego panelu, a Ty z jej rankingu.”, przycisk „Tak, odrzuć” (`destructive`).
- Fokus według Critical Implementation Details. Przyciski zawijają się przy 360 px. Klasy łączone przez `cn()`.
- Przyciski submit to `SubmitButton` (`src/components/auth/SubmitButton.tsx`) z dwoma nowymi opcjonalnymi propsami: `variant` (domyślnie `"accent"`) i `className` (domyślnie `"w-full"`, łączony przez `cn()`). Formularze auth bez zmian.

#### 4. Strona oferty agenta

**File**: `src/pages/agent/offers/[id].astro`

**Intent**: Pokazać stan zaproszenia i akcje tylko przy `pending`, a po przyjęciu potwierdzenie z datą.

**Contract**:
- Odczyt zaproszenia rozszerzony do `select("status, created_at, responded_at")` (nadal `.in("status", ["pending","accepted"])`).
- Karta „Zaproszenie”:
  - przy `pending`: dotychczasowy tekst o dacie zaproszenia plus `<InvitationResponse client:load offerId=… />`;
  - przy `accepted`: „Przyjęto zaproszenie {formatOfferDate(responded_at)}. Oferta jest w obsłudze.”;
  - błąd odczytu: bez akcji, z dotychczasowym tekstem.
- Baner sukcesu `?accepted=1`: „Przyjęto zaproszenie”, w tym samym stylu co banery na stronie właściciela. `<ServerError message={invitationResponseErrorMessage(?error)} />`.

#### 5. Panel agenta

**File**: `src/pages/agent/index.astro`

**Intent**: Potwierdzić odrzucenie po przekierowaniu.

**Contract**: `?rejected=1` daje baner sukcesu „Odrzucono zaproszenie” nad listą. `?error=` daje `ServerError` z `invitationResponseErrorMessage`: dla `already_responded` i dla błędu bez poprawnego `offerId`.

#### 6. Smoke

**File**: `scripts/smoke.mjs`

**Intent**: Sprawdzić odpowiedź agenta end-to-end na zbudowanej aplikacji.

**Contract**: Nowe kroki po istniejących krokach widoku agenta, a przed końcowym blokiem signout (oferta A = już zaproszona oferta smoke):
- właściciel → POST `/api/agent/invitations` daje 403;
- agent → POST z losowym uuid oferty daje 404;
- agent → `response=reject` dla A daje 302 `/agent?rejected=1`; potem GET `/agent/offers/{A}` daje 404, a `/agent?rejected=1` zawiera „Odrzucono zaproszenie” i „Odrzucone”;
- agent → ponowny `reject` dla A daje 302 `/agent?error=already_responded`, a GET tej strony zawiera „Na to zaproszenie już odpowiedziano.”;
- właściciel zapisuje ofertę B z tą samą unikalną ceną przebiegu i zaprasza agenta smoke (id z formularza „Zaproś”, jak w S-05);
- agent → `response=accept` dla B daje 302 `/agent/offers/{B}?accepted=1`; strona zawiera „Przyjęto zaproszenie” i nie zawiera `name="response"`.

### Success Criteria:

#### Automated Verification:

- `npx astro check`, `npm run lint` i `npm run build` bez błędów
- Smoke przechodzi na lokalnym serwerze: `BASE_URL=http://localhost:4321 npm run smoke`
- Testy SQL nadal przechodzą (pętla z fazy 1)

#### Manual Verification:

- `/agent/offers/{id}` z zaproszeniem `pending`: „Przyjmij” → potwierdzenie z fokusem na „Tak, przyjmij”, „Anuluj” wraca do stanu wyjściowego z fokusem na „Przyjmij”; to samo dla „Odrzuć”
- Całość obsługiwana samą klawiaturą (Tab, Enter, Space); widoczny fokus na każdym przycisku
- Stan wysyłania widoczny (spinner, disabled) przy throttlingu „Slow 3G” w DevTools
- Przy 360 px bez poziomego przewijania; light i dark: kontrast przycisków `destructive` i tekstu potwierdzenia ≥4.5:1
- Po przyjęciu: baner i karta „Przyjęto zaproszenie {data}”; po odrzuceniu: baner na `/agent` i wiersz „Oferta niedostępna”

---

## Phase 3: Widok właściciela

### Overview

Właściciel widzi wynik odpowiedzi: kartę „W obsłudze” z datą przyjęcia albo informację o odrzuceniu nad rankingiem. Do tego kroki smoke właściciela i wpis kontaktu do Parked w roadmapie.

### Changes Required:

#### 1. Karta statusu

**File**: `src/components/owner/InvitationStatusCard.astro`

**Intent**: Dla `in_progress` pokazać, kiedy agent przyjął zaproszenie.

**Contract**: Nowy prop `respondedAt: string | null`. Przy `in_progress`: „Agent przyjął zaproszenie {data}.”, a bez daty: „Agent przyjął zaproszenie.”. Gałąź `invited` bez zmian. Agent nadal anonimowy.

#### 2. Strona oferty właściciela

**File**: `src/pages/owner/offers/[id].astro`

**Intent**: Przekazać datę przyjęcia oraz pokazać informację o ostatnim odrzuceniu, gdy oferta wróciła do szukania agenta.

**Contract**:
- Gałąź „≠ `seeking_agent`”: `select("created_at, responded_at")` i przekazanie `respondedAt` do karty.
- Gałąź `seeking_agent`: dodatkowy odczyt przez RLS `invitations.select("responded_at").eq("offer_id", …).eq("status", "rejected").order("responded_at", { ascending: false }).limit(1).maybeSingle()`. Błąd odczytu tylko pomija informację.
- Gdy jest wynik, nad `RankingList` pojawia się informacja (`role="status"`, ton info jak w `StatusPill`: `bg-rs-surface-2 text-rs-fg` z ramką `border-rs-line`, ikona `Info`, bo tokenów `info-soft`/`info-fg` nie ma, zob. `src/components/ui/StatusPill.astro:6`): „Agent odrzucił zaproszenie {data}. Wybierz kolejnego agenta z rankingu.”. Bez nowych tokenów.

#### 3. Smoke

**File**: `scripts/smoke.mjs`

**Intent**: Sprawdzić widok właściciela po obu odpowiedziach.

**Contract**: Kroki po krokach fazy 2, nadal przed blokiem signout:
- właściciel GET `/owner/offers/{A}` zawiera „Agent odrzucił zaproszenie” i nie zawiera id agenta smoke (bez sprawdzania „Zaproś”: w CI agent smoke jest jedynym agentem, więc ranking po odrzuceniu jest pusty);
- właściciel POST `/api/owner/invitations` z A i id agenta smoke daje 302 `?error=agent_not_ranked`;
- właściciel GET `/owner/offers/{B}` zawiera „W obsłudze” i „Agent przyjął zaproszenie”, bez formularza „Zaproś”.

#### 4. Roadmapa

**File**: `context/foundation/roadmap.md`

**Intent**: Zapisać odłożoną decyzję o kontakcie.

**Contract**: W `## Parked` dochodzi „**Kontakt właściciel–agent po przyjęciu zaproszenia** — Why parked: PRD go nie wymaga; S-06 zmienia tylko statusy, a ujawnienie e-maila drugiej strony to nowa ścieżka do danych osobowych i testy RLS (decyzja 2026-10-28, S-06 invitation-response).”

### Success Criteria:

#### Automated Verification:

- `npx astro check`, `npm run lint` i `npm run build` bez błędów
- Smoke przechodzi na lokalnym serwerze: `BASE_URL=http://localhost:4321 npm run smoke`
- CI na PR zielone (`gh pr checks`)

#### Manual Verification:

- Oferta po odrzuceniu: informacja z datą nad rankingiem, w rankingu nie ma odrzucającego agenta, czytelna w light i dark, bez poziomego przewijania przy 360 px
- Oferta po przyjęciu: karta „W obsłudze” z datą, bez rankingu i bez „Zaproś”
- Produkcja po `db push` i merge: pełny przepływ zaproszenie → odrzucenie → zaproszenie kolejnego → przyjęcie na https://hellodom.hellodom.workers.dev

---

## Testing Strategy

### Unit Tests:

- Brak frameworka testów jednostkowych (CLAUDE.md); logika żyje w SQL i jest testowana w `supabase/tests/invitation-response.sql`.

### Integration Tests:

- Test SQL: kody wyniku, atomowość, wykluczenie z rankingu, RLS po odrzuceniu i przyjęciu, brak grantów zapisu, check `responded_at`.
- Smoke: role, 404 dla obcej oferty, odrzucenie, podwójna odpowiedź, przyjęcie, widok właściciela, `agent_not_ranked` dla odrzucającego agenta.

### Manual Testing Steps:

1. Załóż lokalnie właściciela i dwóch agentów (`POST /api/auth/signup`), uzupełnij profile, zapisz ofertę i zaproś agenta 1.
2. Jako agent 1 odrzuć zaproszenie przez potwierdzenie i sprawdź baner, wiersz „Oferta niedostępna” i 404 oferty.
3. Jako właściciel sprawdź informację o odrzuceniu i ranking bez agenta 1, potem zaproś agenta 2.
4. Jako agent 2 przyjmij zaproszenie i sprawdź kartę „Przyjęto zaproszenie {data}”. Jako właściciel sprawdź „W obsłudze”.
5. Klawiatura, fokus, 360 px, light i dark dla wyspy i informacji o odrzuceniu.

## Performance Considerations

Wykluczenie w rankingu to `not exists` na `invitations` po `(offer_id, agent_id)`, a unikalny indeks `invitations_offer_id_agent_id_key` go pokrywa. Strona właściciela robi jeden dodatkowy odczyt po `offer_id` (mała tabela). Bez nowych indeksów.

## Migration Notes

- Kolumna `responded_at` jest nullable, a istniejące zaproszenia są `pending`, więc check jest spełniony bez backfillu. Gdyby na produkcji było zaproszenie w innym statusie, `db push --dry-run` tego nie wykaże: przed `db push` sprawdź w SQL Editorze `select status, count(*) from invitations group by status`.
- Kolejność: `npx supabase db push --dry-run` → zgoda → `npx supabase db push` → merge do `main` zaraz potem.
- Rollback: blok `-- down:` przywraca poprzedni ranking i usuwa funkcję oraz kolumnę. Oferty `in_progress` zostają (opis w bloku).

## References

- Poprzedni slice: `context/archive/2026-10-28-agent-invitation/plan.md`, `reviews/impl-review.md` (F3, F4)
- Wzorzec funkcji: `supabase/migrations/20261028180000_create_invitations.sql:75-121`
- Ranking: `supabase/migrations/20261028140000_create_offers.sql:68-98`
- Wzorzec endpointu: `src/pages/api/owner/invitations.ts`
- Wzorzec testu SQL: `supabase/tests/agent-invitation.sql`
- PRD: FR-011, Guardrails, Business Logic (`context/foundation/prd.md`)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Baza — odpowiedź i ranking bez odrzuconych

#### Automated

- [x] 1.1 Migracja aplikuje się lokalnie: `npx supabase migration up` — d929026
- [x] 1.2 Wszystkie testy SQL przechodzą — d929026
- [x] 1.3 Typy aktualne: `npm run db:types && git diff --exit-code src/db/database.types.ts` — d929026
- [x] 1.4 `npx astro check` i `npm run lint` bez błędów — d929026

### Phase 2: Odpowiedź agenta

#### Automated

- [x] 2.1 `npx astro check`, `npm run lint` i `npm run build` bez błędów — b4651b2
- [x] 2.2 Smoke przechodzi na lokalnym serwerze — b4651b2
- [x] 2.3 Testy SQL nadal przechodzą — b4651b2

#### Manual

- [x] 2.4 Potwierdzenie inline i fokus dla „Przyjmij” i „Odrzuć” — b4651b2
- [x] 2.5 Całość obsługiwana samą klawiaturą z widocznym fokusem — b4651b2
- [x] 2.6 Stan wysyłania widoczny przy throttlingu — b4651b2
- [x] 2.7 360 px bez przewijania; light i dark z kontrastem ≥4.5:1 — b4651b2
- [x] 2.8 Banery i karty po przyjęciu i odrzuceniu — b4651b2

### Phase 3: Widok właściciela

#### Automated

- [x] 3.1 `npx astro check`, `npm run lint` i `npm run build` bez błędów
- [x] 3.2 Smoke przechodzi na lokalnym serwerze
- [ ] 3.3 CI na PR zielone

#### Manual

- [x] 3.4 Informacja o odrzuceniu nad rankingiem bez odrzucającego agenta, light/dark, 360 px
- [x] 3.5 Karta „W obsłudze” z datą, bez rankingu i „Zaproś”
- [ ] 3.6 Pełny przepływ na produkcji po `db push` i merge
