# Owner offer management (S-04) Implementation Plan

## Overview

Właściciel widzi na `/owner` listę swoich ofert ze statusem (FR-004), edytuje ofertę, dopóki szuka ona agenta (FR-005), i usuwa ofertę w każdym statusie (FR-006). Zapisy idą przez kolumnowy grant + RLS, tak jak insert oferty w S-03.

## Current State Analysis

- Lista na `/owner` już istnieje, ale bez statusu: select `src/pages/owner/index.astro:18-22` nie pobiera `status`, a `OfferListItem` (`src/types.ts:59-60`) i `toOfferListItem` (`src/lib/services/offers.ts:114-124`) go nie mają. Tony pilli statusu są lokalne w `src/components/offers/OfferSummary.astro:15-20`.
- Baza nie pozwala na update ani delete: `authenticated` ma tylko `select` i kolumnowy `insert` (`supabase/migrations/20261028140000_create_offers.sql:41-45`, komentarz `:6`). Polityki na `offers`: `offers_select_own`, `offers_insert_own_owner` (`create_offers.sql:47-62`), `offers_select_invited_agent` (`20261028180000_create_invitations.sql:47-57`).
- Badanie sprawdziło w transakcji z rollbackiem, że grant kolumnowy + polityka `owner_id = auth.uid() and status in ('draft','seeking_agent')` działa. Update oferty `in_progress` daje `UPDATE 0` bez błędu, więc endpoint sam musi odróżnić „nie ma” od „zablokowana”. Delete oferty `in_progress` kasuje zaproszenia kaskadą, a trigger `restore_offer_on_invitation_delete` (`20261028220000_account_deletion.sql:11-34`) przechodzi bez błędu (research, Summary 4).
- Status `draft` jest nieosiągalny: default `seeking_agent` (`create_offers.sql:18`), `status` bez grantu insert, żadna funkcja go nie ustawia (research, Summary 5).
- `OfferForm.tsx` ma zahardkodowany `action` (`:161`), etykietę przycisku (`:317-319`) i puste stany startowe (`:87-93`). Strona oferty `src/pages/owner/offers/[id].astro` nie ma akcji Edytuj/Usuń; `?error=` mapuje tylko `invitationErrorMessage` (`:93`).

## Desired End State

- Każdy wiersz listy na `/owner` ma pill statusu („Szkic”, „Szuka agenta”, „Zaproszenie wysłane”, „W obsłudze”) w kolorze zgodnym z podsumowaniem oferty.
- Na stronie oferty właściciel widzi kartę „Zarządzanie ofertą”. Dla `seeking_agent`/`draft` są tam „Edytuj” (link do `/owner/offers/<id>/edit`) i „Usuń ofertę”. Dla `invited`/`in_progress` zamiast „Edytuj” jest informacja, że edycja jest zablokowana po wysłaniu zaproszenia, a „Usuń ofertę” pozostaje.
- `/owner/offers/<id>/edit` pokazuje formularz wypełniony danymi oferty. „Zapisz zmiany” zapisuje i wraca na stronę oferty z komunikatem „Zapisano zmiany”; ranking liczy się od nowa przy renderze.
- Edycja oferty zablokowanej (bezpośrednio lub przez wyścig z zaproszeniem) kończy się powrotem na stronę oferty z komunikatem o blokadzie. Cudza lub nieistniejąca oferta → 404, agent → 403.
- „Usuń ofertę” otwiera potwierdzenie inline; dla `invited`/`in_progress` tekst mówi, że agent straci dostęp do oferty. Po potwierdzeniu właściciel ląduje na `/owner?deleted=1` z komunikatem „Usunięto ofertę”, a zaproszenia oferty znikają kaskadą.
- Weryfikacja: `supabase/tests/owner-offer-management.sql` w CI, nowe kroki w `npm run smoke`, sprawdzenie na produkcji.

### Key Discoveries:

- Wzorzec endpointu z ukrytym `offerId`, 404 dla `not_found`, `fail(code)` z powrotem na stronę oferty: `src/pages/api/owner/invitations.ts:6-66`.
- Wzorzec akcji destrukcyjnej z potwierdzeniem inline, fokusem i `useNativeSubmitting`: `src/components/account/DeleteAccount.tsx:23-91`. Wariant `destructive` zarezerwowano m.in. dla „Usuń ofertę” (`context/archive/2026-10-27-app-shell/reviews/plan-review.md:77`).
- Testy SQL: `begin` / `set local role authenticated` / `request.jwt.claims` / `get diagnostics n = row_count` / `rollback` (`supabase/tests/agent-profile.sql:96-120`, `account-deletion.sql:1-53`). Zajęte prefiksy UUID `0001`–`0007`, ten test dostaje `0008`.
- Same granty i polityki nie zmieniają `src/db/database.types.ts` (CI sprawdza aktualność typów, `.github/workflows/ci.yml:50`).
- `OfferSummary.astro` widzi też agent (`/agent/offers/[id]`), więc akcje właściciela nie mogą trafić do tego komponentu.
- `/owner/*` jest chronione przez `src/lib/route-guard.ts:4-7`, więc `/owner/offers/[id]/edit` nie wymaga zmian w guardzie.

## What We're NOT Doing

- **Status „szkic”** (odstępstwo od FR-004/FR-005): nie dodajemy zapisu jako szkic ani akcji „Opublikuj”. Oferty nadal powstają jako `seeking_agent` (decyzja S-03). Polityka update i UI dopuszczają `draft`, ale w praktyce edycja dotyczy `seeking_agent`.
- Powiadomienia agenta o usunięciu oferty: oferta po prostu znika z jego listy (zgodnie z rozstrzygnięciem Socratesa przy FR-006).
- Stronicowanie i filtry listy: zostaje limit 50 (`OWNER_OFFERS_LIMIT`).
- RPC `update_offer`/`delete_offer`: zapis przez grant + RLS.
- Logowanie błędów (`console.error`) i statusy HTTP przy błędach odczytu (F4 z review S-03): odroczone do M3.
- F5 z impl-review invitation-response (`api/owner/invitations.ts:17`, zły `offerId` → `/owner` bez komunikatu): bez zmian; formularz zawsze wysyła poprawny uuid.

## Implementation Approach

Najpierw baza z testem SQL, który dowodzi reguł dostępu niezależnie od UI. Potem lista i edycja (wspólny `OfferForm`, nowa strona i endpoint), potem usuwanie, na końcu wdrożenie. Każda faza z UI dokłada kroki do smoke'a. Endpointy trzymają się wzorca natywnego POST + 302 z `?error=kod` mapowanym przez allowlistę.

## Critical Implementation Details

- **Update zmieniający 0 wierszy.** RLS nie zgłasza błędu przy zablokowanej ofercie. Endpoint robi update z `.select("id")`; przy 0 wierszach doczytuje ofertę przez RLS: brak wiersza → 404, wiersz jest → `edit_locked`. Ten sam przypadek obsługuje wyścig z `invite_agent`, który blokuje wiersz `for update` (research, „współbieżność”).
- **Kolejność mapowania `?error=` na stronie oferty.** `invitationErrorMessage` zamienia każdy nieznany kod na swój komunikat `unknown`, więc najpierw trzeba sprawdzić kody akcji na ofercie (`edit_locked`, `delete_failed`), a dopiero potem kody zaproszeń.

## Phase 1: Baza – granty, polityki, test SQL

### Overview

Właściciel może zmienić pola swojej oferty, dopóki ma ona status `draft`/`seeking_agent`, i usunąć swoją ofertę w każdym statusie. Nikt inny nie może ani jednego, ani drugiego.

### Changes Required:

#### 1. Migracja

**File**: `supabase/migrations/20261029100000_owner_offer_management.sql`

**Intent**: Otworzyć update pól oferty i delete wyłącznie dla właściciela, bez możliwości zmiany `status`, `owner_id`, `id`, `created_at`.

**Contract**:
- `grant update (city, property_type, transaction, price, area_m2, rooms, description) on public.offers to authenticated;`
- `grant delete on public.offers to authenticated;`
- polityka `offers_update_own_editable` (`for update to authenticated`): `using` i `with check` = `owner_id = (select auth.uid()) and status in ('draft', 'seeking_agent')`;
- polityka `offers_delete_own` (`for delete to authenticated`): `using (owner_id = (select auth.uid()))`;
- komentarz nagłówka: dlaczego `status` nie ma grantu (zmienia się tylko przez RPC zaproszeń), że polityki nie czytają `invitations` (rekurencja RLS) i że delete kasuje zaproszenia kaskadą, a trigger z `account_deletion` to obsługuje;
- blok `-- down:` z `drop policy` i `revoke update, delete`.

#### 2. Test SQL

**File**: `supabase/tests/owner-offer-management.sql`

**Intent**: Dowód reguł dostępu w CI, z perspektywy ról `authenticated` (właściciel, drugi właściciel, agent) i `anon`.

**Contract**: Wzorzec `begin … rollback` i `do $$ … raise exception $$` z istniejących testów, UUID z prefiksem `00000000-0000-0000-0008`. Przypadki:
- właściciel zmienia cenę oferty `seeking_agent` → 1 wiersz, nowa wartość zapisana;
- właściciel zmienia cenę oferty `invited` i `in_progress` → 0 wierszy, wartość bez zmian;
- właściciel `update offers set status = …` i `set owner_id = …` → `insufficient_privilege`;
- drugi właściciel i agent: update i delete cudzej oferty → 0 wierszy;
- właściciel usuwa ofertę `in_progress` z zaproszeniem `accepted` i odrzuconym zaproszeniem → 1 wiersz, zaproszenia oferty znikają, brak błędu triggera;
- `anon`: delete → `insufficient_privilege`.

### Success Criteria:

#### Automated Verification:

- Migracja aplikuje się na czystej bazie: `npx supabase db reset` (uprzedzić użytkownika: kasuje lokalne konta)
- Test SQL przechodzi: `docker exec` z `psql -v ON_ERROR_STOP=1 -f supabase/tests/owner-offer-management.sql` (tak jak w `ci.yml:43-49`)
- Pozostałe testy SQL przechodzą: każdy plik z `supabase/tests/*.sql`
- Typy bez zmian: `npm run db:types && git diff --exit-code src/db/database.types.ts`

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Lista ze statusem i edycja

### Overview

FR-004 i FR-005 w UI: status na liście, strona edycji oferty, endpoint update, akcje na stronie oferty.

### Changes Required:

#### 1. Wspólne tony statusów

**File**: `src/lib/dictionaries.ts`, `src/components/offers/OfferSummary.astro`

**Intent**: Jedno źródło kolorów pilli statusu oferty dla podsumowania i listy.

**Contract**: `export const OFFER_STATUS_TONES: Record<OfferStatus, StatusTone>` obok `OFFER_STATUS_LABELS` (te same wartości co dziś `OfferSummary.astro:15-20`); `OfferSummary` importuje je zamiast lokalnej stałej.

#### 2. Lista na `/owner`

**File**: `src/types.ts`, `src/lib/services/offers.ts`, `src/pages/owner/index.astro`

**Intent**: Wiersz listy pokazuje status oferty.

**Contract**: `OfferListItem` dostaje `status`; `OfferListRow` i `toOfferListItem` mapują `status` przez `oneOf(OFFER_STATUSES, …)`; select w `index.astro` dodaje `status`; w wierszu `StatusPill` z `OFFER_STATUS_TONES`/`OFFER_STATUS_LABELS`, czytelny przy 360 px (pill może zejść pod tytuł, nie może ściskać ceny). Komentarz przy `OWNER_OFFERS_LIMIT` (`offers.ts:14`) mówi, że limit zostaje decyzją S-04.

#### 3. Kody błędów akcji na ofercie

**File**: `src/lib/services/offers.ts`

**Intent**: Komunikaty dla blokady edycji i nieudanego usunięcia, pokazywane na stronie oferty.

**Contract**: `OFFER_ACTION_ERROR_CODES = ["edit_locked", "delete_failed"] as const`, typ `OfferActionErrorCode`, `offerActionErrorMessage(code: string | null): string | null` zwraca `null` dla kodu spoza listy (nie mapuje na `unknown`). Teksty: `edit_locked` — „Tej oferty nie można już edytować, bo wysłano zaproszenie do agenta.”; `delete_failed` — „Nie udało się usunąć oferty. Spróbuj ponownie.” Przy okazji `parseOfferForm` pozostaje bez zmian; endpoint update czyta `offerId` osobno przez `parseOfferId`.

#### 4. `OfferForm` w trybie edycji

**File**: `src/components/owner/OfferForm.tsx`

**Intent**: Ten sam formularz do tworzenia i edycji.

**Contract**: Nowe opcjonalne propsy: `action` (domyślnie `/api/owner/offers`), `submitLabel` (domyślnie „Zapisz i pokaż agentów”), `offerId` (gdy podany — ukryte pole `offerId`), `initialValues?: { city; propertyType; transaction; price: string; areaM2: string; rooms: string; description: string }` jako stany startowe. Strona przekazuje metraż z przecinkiem dziesiętnym (`54.5` → `"54,5"`), `null` jako `""`. Bez zmian w walidacji.

#### 5. Strona edycji

**File**: `src/pages/owner/offers/[id]/edit.astro`

**Intent**: Formularz wypełniony danymi oferty właściciela.

**Contract**: Odczyt przez RLS jak w `[id].astro:27-42` (`parseOfferId`, `.maybeSingle()`). Brak oferty → 404 z kartą „Nie znaleziono oferty” jak w `[id].astro`; błąd odczytu → `ServerError`; status poza `draft`/`seeking_agent` → redirect `/owner/offers/<id>?error=edit_locked`. Tytuł „Edycja oferty”, link „Wróć do oferty”, `OfferForm client:load` z `action="/api/owner/offers/update"`, `submitLabel="Zapisz zmiany"`, `offerId`, `initialValues`, `serverError={offerErrorMessage(?error)}`.

#### 6. Endpoint update

**File**: `src/pages/api/owner/offers/update.ts`

**Intent**: Zapis zmian oferty właściciela.

**Contract**: `POST`, kolejność jak w `api/owner/invitations.ts`: `formData()` w `try/catch`; brak klienta → `unavailable`; brak sesji → `/auth/signin`; rola ≠ owner → 403; dopiero potem `offerId` przez `parseOfferId` — brak lub zły → 404 (anonim zawsze trafia na logowanie, jak w `invitations.ts:14-27`); `parseOfferForm` nieudany → `/owner/offers/<id>/edit?error=invalid_input`. Update tylko pól z grantu, `.eq("id", offerId).select("id")`: błąd → `…/edit?error=unknown`; 1 wiersz → `/owner/offers/<id>?updated=1`; 0 wierszy → doczytanie oferty (patrz Critical Implementation Details): brak → 404, jest → `/owner/offers/<id>?error=edit_locked`. Błąd profilu lub doczytania → `…/edit?error=unavailable`.

#### 7. Akcje na stronie oferty

**File**: `src/pages/owner/offers/[id].astro`

**Intent**: Właściciel dochodzi do edycji (i w fazie 3 do usuwania) ze strony oferty i widzi wynik akcji.

**Contract**: Pod `OfferSummary` karta „Zarządzanie ofertą”: dla `draft`/`seeking_agent` link „Edytuj” (`buttonVariants`, ikona `Pencil`) do `/owner/offers/<id>/edit`; dla `invited`/`in_progress` tekst „Edycja jest zablokowana, bo wysłano zaproszenie do agenta.” Komunikat `?updated=1` → „Zapisano zmiany” (ten sam blok co `created`). `?error=` → `offerActionErrorMessage(code) ?? invitationErrorMessage(code)`.

#### 8. Smoke

**File**: `scripts/smoke.mjs`

**Intent**: Edycja i jej granice z perspektywy użytkownika.

**Contract**: Właściciel tworzy osobną ofertę `managedOfferId` (nie `offerId`, który jest używany dalej) z parametrami pasującymi do smoke agenta (jak `rankedOfferId`, cena `rankedPrice`), bo faza 3 zaprasza na nią agenta. Przedział cen smoke agenta to dokładnie `rankedPrice` (`smoke.mjs:55`), więc edycja zmienia opis, nie cenę. Wszystkie kroki S-04 (fazy 2 i 3) idą po „owner offer page shows the accepted invitation”, a przed „second owner signout” (`smoke.mjs:502`): tylko tam sesje owner/otherOwner/agent są aktywne, a `acceptedOfferId` ma stabilny status `in_progress`. `rankedOfferId` nie nadaje się do blokady, bo po odrzuceniu (`smoke.mjs:408`) wraca do `seeking_agent`. Kroki:
- `/owner` zawiera etykietę „Szuka agenta”;
- `GET /owner/offers/<managedOfferId>/edit` → 200, body zawiera „Zapisz zmiany” i obecną cenę;
- `POST /api/owner/offers/update` ze zmienionym opisem → 302 `/owner/offers/<managedOfferId>?updated=1`; ta strona zawiera „Zapisano zmiany”, nowy opis i ranking ze smoke agentem;
- update z niepoprawną ceną → 302 `/owner/offers/<managedOfferId>/edit?error=invalid_input`;
- drugi właściciel: `GET …/edit` → 404, `POST update` → 404; agent: `POST update` → 403;
- na `acceptedOfferId` (`in_progress`): `POST update` → 302 `/owner/offers/<acceptedOfferId>?error=edit_locked`, `GET …/edit` → 302 tamże, strona oferty zawiera tekst blokady.

### Success Criteria:

#### Automated Verification:

- Lint przechodzi: `npm run lint`
- Typy przechodzą: `npx astro check`
- Build przechodzi: `npm run build`
- Smoke z krokami edycji przechodzi na lokalnym serwerze: `npm run smoke`

#### Manual Verification:

- `/owner`: pill statusu w każdym wierszu, kolory jak w podsumowaniu oferty, light i dark, 360 px bez poziomego przewijania
- `/owner/offers/<id>/edit`: formularz wypełniony (miasto, typ, transakcja, cena, metraż z przecinkiem, pokoje, opis), błędy walidacji jak przy tworzeniu, stan „Zapisywanie…” widoczny (throttling w DevTools)
- Strona oferty: „Edytuj” dla „Szuka agenta”, tekst blokady dla „Zaproszenie wysłane”, komunikat „Zapisano zmiany” po zapisie, fokus i klawiatura działają

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Usuwanie

### Overview

FR-006 w UI: przycisk „Usuń ofertę” z potwierdzeniem zależnym od statusu i endpoint delete.

### Changes Required:

#### 1. Komponent usuwania

**File**: `src/components/owner/DeleteOffer.tsx`

**Intent**: „Usuń ofertę” z potwierdzeniem inline; dla ofert z agentem ostrzeżenie, że agent straci dostęp.

**Contract**: Props `{ offerId: string; status: OfferStatus }`. Wzorzec 1:1 z `DeleteAccount.tsx` (fokus między krokami, `useNativeSubmitting`, `SubmitButton variant="destructive"` z `describedBy`, „Anuluj” jako `ghost`), formularz `POST /api/owner/offers/delete` z ukrytym `offerId`. Teksty potwierdzenia:
- `draft`/`seeking_agent`: „Usuniemy ofertę razem z historią zaproszeń. Tego nie da się cofnąć.”
- `invited`: „Zaproszony agent straci dostęp do oferty, a zaproszenie zniknie. Tego nie da się cofnąć.”
- `in_progress`: „Agent, który obsługuje tę ofertę, straci do niej dostęp. Tego nie da się cofnąć.”
Przyciski: „Usuń ofertę” → „Tak, usuń ofertę”, `pendingText="Usuwanie…"`.

#### 2. Endpoint delete

**File**: `src/pages/api/owner/offers/delete.ts`

**Intent**: Usunięcie oferty właściciela w każdym statusie.

**Contract**: `POST`, sprawdzenia w tej samej kolejności co w endpoincie update (brak sesji → `/auth/signin`, rola ≠ owner → 403, potem `offerId` zły/brak → 404). `delete().eq("id", offerId).select("id")`: błąd klienta, profilu lub zapytania → `/owner/offers/<id>?error=delete_failed`; 0 wierszy → 404; 1 wiersz → `/owner?deleted=1`.

#### 3. Strona oferty i lista

**File**: `src/pages/owner/offers/[id].astro`, `src/pages/owner/index.astro`

**Intent**: Przycisk usuwania w karcie „Zarządzanie ofertą” i komunikat po usunięciu.

**Contract**: `DeleteOffer client:load` w karcie z fazy 2, dla każdego statusu. Na `/owner` `?deleted=1` → blok `role="status"` „Usunięto ofertę” (ten sam wygląd co „Zapisano ofertę”).

#### 4. Smoke

**File**: `scripts/smoke.mjs`

**Intent**: Usuwanie i jego granice z perspektywy użytkownika.

**Contract**: Kroki na `managedOfferId`, po krokach fazy 2 (to samo okno smoke'a, przed `smoke.mjs:502`):
- właściciel zaprasza smoke agenta (`POST /api/owner/invitations`) → 302 `?invited=1`; `POST update` → 302 `/owner/offers/<managedOfferId>?error=edit_locked` (blokada dla `invited`);
- agent: `/agent/offers/<managedOfferId>` → 200 (dostęp przed usunięciem);
- drugi właściciel: `POST /api/owner/offers/delete` → 404; agent → 403;
- `GET /owner/offers/<managedOfferId>` zawiera „Usuń ofertę” i ostrzeżenie o utracie dostępu przez agenta;
- właściciel: `POST delete` → 302 `/owner?deleted=1`; `/owner?deleted=1` zawiera „Usunięto ofertę” i nie zawiera linku do `managedOfferId`; `GET /owner/offers/<managedOfferId>` → 404;
- agent: `/agent/offers/<managedOfferId>` → 404, `/agent` nie zawiera linku do `managedOfferId`.

### Success Criteria:

#### Automated Verification:

- Lint przechodzi: `npm run lint`
- Typy przechodzą: `npx astro check`
- Build przechodzi: `npm run build`
- Smoke z krokami usuwania przechodzi na lokalnym serwerze: `npm run smoke`

#### Manual Verification:

- Potwierdzenie usuwania: tekst zależny od statusu (sprawdzone dla „Szuka agenta” i „Zaproszenie wysłane”), fokus przechodzi na „Tak, usuń ofertę” i wraca na „Usuń ofertę” po „Anuluj”, stan „Usuwanie…” widoczny (throttling)
- Usunięcie oferty z zaproszeniem: oferta znika z listy właściciela, agent widzi ją jako niedostępną (`/agent` bez linku, `/agent/offers/<id>` → 404)
- Light/dark i 360 px karty „Zarządzanie ofertą”

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 4: Produkcja

### Overview

Migracja na produkcję przed merge, deploy przez merge do `main`, sprawdzenie na produkcji.

### Changes Required:

#### 1. Wdrożenie

**Intent**: Schemat na produkcji zgodny z kodem w chwili deployu (README, „Migracje bazy na produkcji”).

**Contract**: PR z gałęzi zmiany → zielone CI → `npx supabase db push --dry-run` (pokazać wynik, poczekać na zgodę) → `npx supabase db push` → merge → job `deploy`. Po merge `git switch main && git pull`, usunięcie gałęzi, `git status -sb` bez `ahead`.

### Success Criteria:

#### Automated Verification:

- CI zielone na PR (ci, smoke z testami SQL): `gh pr checks`
- Deploy zielony po merge: `gh run list --branch main`
- Produkcja odpowiada: `curl -sI https://hellodom.hellodom.workers.dev/` → 200

#### Manual Verification:

- `npx supabase db push --dry-run` pokazuje tylko `20261029100000_owner_offer_management.sql` (wynik pokazany użytkownikowi przed `db push`)
- Na produkcji, istniejącym kontem testowym właściciela (bez nowej rejestracji — limit ~2 maili/h): lista ze statusem, edycja oferty „Szuka agenta” z komunikatem „Zapisano zmiany”, usunięcie oferty z komunikatem „Usunięto ofertę”

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

- Brak frameworka testów jednostkowych (CLAUDE.md, „Testing”). Reguły dostępu sprawdza test SQL, zachowanie endpointów — smoke.

### Integration Tests:

- `supabase/tests/owner-offer-management.sql`: update w zależności od statusu, zakaz zmiany `status`/`owner_id`, brak dostępu dla innych ról, kaskada przy delete oferty `in_progress`.
- `scripts/smoke.mjs`: edycja (sukces, walidacja, blokada, 404, 403), usuwanie oferty z zaproszeniem (sukces, agent traci dostęp, 404, 403), status na liście.

### Manual Testing Steps:

1. `/owner` → pill statusu w każdym wierszu, light/dark, 360 px.
2. Oferta „Szuka agenta” → „Edytuj” → zmiana ceny → „Zapisano zmiany”, nowa cena i ranking.
3. Oferta po zaproszeniu → tekst blokady, ręczne wejście na `/edit` wraca z komunikatem o blokadzie.
4. „Usuń ofertę” na ofercie z zaproszeniem → ostrzeżenie o agencie → „Usunięto ofertę”, agent nie widzi oferty.

## Performance Considerations

Bez zmian: lista nadal korzysta z indeksu `(owner_id, created_at desc)` i limitu 50; update/delete po kluczu głównym. Endpoint update w przypadku blokady robi jedno dodatkowe zapytanie.

## Migration Notes

Migracja dodaje tylko granty i polityki, bez zmian danych. Wycofanie: SQL z bloku `-- down:` w SQL Editorze produkcji; `npx wrangler rollback` cofa tylko kod Workera.

## References

- Research: `context/changes/owner-offer-management/research.md`
- PRD: `context/foundation/prd.md` (FR-004, FR-005, FR-006)
- Roadmapa: `context/foundation/roadmap.md` (S-04)
- Wzorzec endpointu: `src/pages/api/owner/invitations.ts:6-66`
- Wzorzec usuwania: `src/components/account/DeleteAccount.tsx`, `src/pages/api/account/delete.ts`
- Decyzja o `draft`: `context/archive/2026-10-28-offer-top3-ranking/plan.md:33-34`

## Addendum — odstępstwa od implementacji (impl-review 2026-10-29)

- `DeleteOffer.tsx`: oprócz tekstów potwierdzenia jest `HINT_TEXT` zależny od statusu, widoczny przed kliknięciem „Usuń ofertę”. Strona renderowana na serwerze od razu mówi, co zabiera usunięcie; smoke sprawdza ten tekst („Po usunięciu zaproszony agent straci dostęp do oferty.”), bo tekst potwierdzenia pojawia się dopiero po kliknięciu.
- Konwersja oferty na `initialValues` formularza (metraż z przecinkiem, `null` → `""`) to `toOfferFormValues` w `src/lib/services/offers.ts`, a nie kod strony; typ jest nazwany `OfferFormValues` w `src/types.ts`.
- `isOfferEditable(status)` w `src/lib/services/offers.ts`: jedno źródło reguły `draft`/`seeking_agent` dla `edit.astro` i `[id].astro`.
- `edit.astro` przekierowuje zablokowaną ofertę przez `Astro.response.status = 302` i nagłówek `Location` zamiast `return Astro.redirect()`: `return` na najwyższym poziomie frontmattera wywraca `@typescript-eslint/no-misused-promises` (ten sam obejście co `src/pages/dashboard.ts`).
- Test SQL ma przypadki ponad plan: anon update, `has_column_privilege` dla `id`/`owner_id`/`status`/`created_at`, oferta drugiego właściciela, która przetrwa delete, oraz (po impl-review, F1) oferta `draft` edytowalna i cena oferty `in_progress` bez zmian.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Baza – granty, polityki, test SQL

#### Automated

- [x] 1.1 Migracja aplikuje się na czystej bazie: `npx supabase db reset` — 6ba94dd
- [x] 1.2 Test SQL przechodzi: `supabase/tests/owner-offer-management.sql` — 6ba94dd
- [x] 1.3 Pozostałe testy SQL przechodzą — 6ba94dd
- [x] 1.4 Typy bez zmian: `npm run db:types && git diff --exit-code src/db/database.types.ts` — 6ba94dd

### Phase 2: Lista ze statusem i edycja

#### Automated

- [x] 2.1 Lint przechodzi: `npm run lint` — 9b11709
- [x] 2.2 Typy przechodzą: `npx astro check` — 9b11709
- [x] 2.3 Build przechodzi: `npm run build` — 9b11709
- [x] 2.4 Smoke z krokami edycji przechodzi: `npm run smoke` — 9b11709

#### Manual

- [x] 2.5 `/owner`: pill statusu w każdym wierszu, light i dark, 360 px — 9b11709
- [x] 2.6 `/owner/offers/<id>/edit`: formularz wypełniony, walidacja, stan „Zapisywanie…” — 9b11709
- [x] 2.7 Strona oferty: „Edytuj” / tekst blokady, „Zapisano zmiany”, fokus i klawiatura — 9b11709

### Phase 3: Usuwanie

#### Automated

- [x] 3.1 Lint przechodzi: `npm run lint` — 689f73b
- [x] 3.2 Typy przechodzą: `npx astro check` — 689f73b
- [x] 3.3 Build przechodzi: `npm run build` — 689f73b
- [x] 3.4 Smoke z krokami usuwania przechodzi: `npm run smoke` — 689f73b

#### Manual

- [x] 3.5 Potwierdzenie usuwania: tekst zależny od statusu, fokus, stan „Usuwanie…” — 689f73b
- [x] 3.6 Usunięcie oferty z zaproszeniem: znika u właściciela i agenta — 689f73b
- [x] 3.7 Light/dark i 360 px karty „Zarządzanie ofertą” — 689f73b

### Phase 4: Produkcja

#### Automated

- [x] 4.1 CI zielone na PR: `gh pr checks`
- [x] 4.2 Deploy zielony po merge: `gh run list --branch main`
- [x] 4.3 Produkcja odpowiada: `curl -sI https://hellodom.hellodom.workers.dev/`

#### Manual

- [x] 4.4 `db push --dry-run` pokazuje tylko migrację `owner_offer_management`
- [x] 4.5 Na produkcji: lista ze statusem, edycja i usunięcie oferty
