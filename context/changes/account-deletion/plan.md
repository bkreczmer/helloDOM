# Account deletion (S-07) Implementation Plan

## Overview

Użytkownik (właściciel albo agent) usuwa swoje konto razem ze wszystkimi danymi (FR-012, NFR `prd.md:103`). Gdy znika agent z aktywnym zaproszeniem (`pending` albo `accepted`), oferta wraca do `seeking_agent`. Tak samo ma być po ręcznym usunięciu konta w panelu Supabase (`roadmap.md:173`, F1 z impl-review agent-invitation).

## Current State Analysis

- Kaskady już usuwają dane konta: `auth.users → profiles` (`supabase/migrations/20261027150939_create_profiles.sql:6`), `profiles → offers.owner_id` (`20261028140000_create_offers.sql:10`), `profiles → invitations.agent_id/owner_id` oraz `offers → invitations.offer_id` (`20261028180000_create_invitations.sql:12-14`). Żadna inna tabela aplikacji nie ma FK do `profiles` ani do `auth.users`, a Storage jest pusty (research, pkt 2).
- Brakuje przywrócenia statusu oferty. Kaskada kasuje zaproszenie agenta, a oferta zostaje w `invited`/`in_progress`. Lokalny test w transakcji z rollbackiem zostawił 1 ofertę `invited` i 1 `in_progress` bez aktywnego zaproszenia.
- Rola `postgres` (właściciel funkcji z migracji) ma lokalnie `DELETE` na `auth.users`. Prototyp RPC `security definer` usunął konto wywołany jako `authenticated`. Na produkcji tego jeszcze nie sprawdzono.
- Nie ma strony konta dla żadnej roli. Nawigacja: `src/components/shell/nav.ts:12-18`. Wylogowanie: `src/pages/api/auth/signout.ts:4-10`. Wzorzec potwierdzenia inline: `src/components/agent/InvitationResponse.tsx`.

## Desired End State

- Zalogowany użytkownik obu ról wchodzi w „Konto” w nawigacji (`/owner/account` albo `/agent/account`), klika „Usuń konto”, widzi skutki i potwierdza „Tak, usuń konto”. Konto i wszystkie jego dane znikają, sesja zostaje wyczyszczona, a użytkownik ląduje na `/?deleted=1` z komunikatem „Konto zostało usunięte”.
- Po usunięciu agenta każda oferta, której aktywne zaproszenie zniknęło, ma status `seeking_agent`. Dotyczy to usunięcia w aplikacji, w panelu Supabase i w przyszłym usuwaniu ofert (S-04).
- Na produkcji nie ma ofert `invited`/`in_progress` bez aktywnego zaproszenia.
- Weryfikacja: `supabase/tests/account-deletion.sql` w CI, kroki usunięcia konta w `npm run smoke`, zapytanie kontrolne na produkcji.

### Key Discoveries:

- Wzorzec RPC z kodami wyników, `set search_path = ''`, `revoke ... from public, anon` i blokiem `-- down:`: `supabase/migrations/20261028200000_invitation_response.sql:75-125`.
- Wzorzec endpointu (`fail(code)`, `unavailable`, sprawdzenie `locals.user`, rola z `profiles`, guard wyniku `rpc()`): `src/pages/api/owner/invitations.ts:6-66`.
- Kody i komunikaty błędów w serwisie: `src/lib/services/invitations.ts:25-60`.
- Testy SQL w CI: każdy plik z `supabase/tests/*.sql` (`.github/workflows/ci.yml:43-49`). Zajęte prefiksy UUID to `0000`–`0006`, więc ten test dostaje `0007`.
- `src/middleware.ts:11-17` woła `getUser()` (serwer Auth), więc usunięty użytkownik ma `user = null`. Ciasteczka trzeba jednak wyczyścić w endpoincie.
- Wariant przycisku `destructive` jest zarezerwowany dla „Usuń konto” (`context/archive/2026-10-27-app-shell/reviews/plan-review.md:77`).
- `DOCK_MAX_ITEMS = 5` (`nav.ts:21`), więc trzecia pozycja w nawigacji się mieści.

## What We're NOT Doing

- Klucz `service_role` ani Admin API w Workerze: zostaje tylko anon key (`infrastructure.md:79`).
- Ponowne wpisywanie hasła lub e-maila przy potwierdzeniu: wystarczy potwierdzenie inline.
- Okres karencji, miękkie usuwanie ani przywracanie konta.
- Powiadomienie właściciela, że agent usunął konto (oferta po prostu wraca do „Szuka agenta”).
- Usuwanie ofert przez właściciela (S-04). Trigger je obsłuży, ale nie budujemy tu tej funkcji.
- Inne ustawienia konta (zmiana e-maila, hasła) na nowych stronach.
- Testy współbieżności (`delete_own_account` równolegle z `invite_agent`/`respond_to_invitation`).
- Czyszczenie logów platformy Supabase (`auth.audit_log_entries`, logi API i Auth). NFR „po usunięciu konta w produkcie nie zostają żadne dane” (`prd.md:103`) dotyczy danych produktu: tabel aplikacji i `auth.users` z kaskadami. Logi platformy wygasają według retencji Supabase, a grzebanie w schemacie `auth`, którym zarządza Supabase, to ryzyko bez korzyści dla MVP. To świadoma decyzja do raportu architekta.

## Implementation Approach

Niezmiennik „oferta wraca do `seeking_agent`, gdy znika jej aktywne zaproszenie” trzymamy w bazie: trigger `after delete on public.invitations` działa niezależnie od tego, kto usuwa (RPC, panel, kaskada usunięcia oferty). Samo usunięcie konta to RPC `security definer` w istniejącym wzorcu, wołane kluczem anon z endpointu. Ta sama migracja jednorazowo naprawia oferty osierocone wcześniej na produkcji. UI to dwie cienkie strony konta ze wspólnym komponentem potwierdzenia.

## Critical Implementation Details

- **Warunek wstępny na produkcji**: przed uruchomieniem `/10x-implement` (a nie po fazie 1) użytkownik uruchamia w SQL Editorze projektu `select has_table_privilege('postgres', 'auth.users', 'DELETE');`. Wynik wpisujemy tutaj, a krok 1.6 odhaczamy przy commicie fazy 1. Jeśli wynik to `false`, nie zaczynamy implementacji i wracamy do decyzji o mechanizmie (Admin API z `service_role`). Wynik: `true` (2026-10-28).
- **Kolejność w endpoincie**: najpierw RPC, potem `supabase.auth.signOut({ scope: "local" })`. Zakres `local` nie woła `/logout` serwera Auth dla nieistniejącego już użytkownika, tylko czyści ciasteczka przez `setAll` (`src/lib/supabase.ts:15-19`). Błąd `signOut` nie może zmienić wyniku: konto jest już usunięte, więc i tak przekierowujemy na `/?deleted=1`.
- **Trigger przy kaskadzie usunięcia oferty**: gdy kaskada kasuje ofertę razem z zaproszeniem, `update` w triggerze trafia w 0 wierszy. Sprawdzono to lokalnie na właścicielu z 21 ofertami, więc dodatkowy warunek nie jest potrzebny.

## Phase 1: Baza – trigger, naprawa, RPC

### Overview

Migracja zamyka F1 dla każdej ścieżki usunięcia i dodaje RPC do samodzielnego usunięcia konta. Test SQL to potwierdza.

### Changes Required:

#### 1. Migracja

**File**: `supabase/migrations/<YYYYMMDDHHmmss>_account_deletion.sql` (znacznik czasu późniejszy niż `20261028200000`)

**Intent**: Trigger przywraca `seeking_agent` ofercie, której aktywne zaproszenie zostało usunięte. Jednorazowy `update` naprawia oferty osierocone wcześniej. RPC pozwala zalogowanemu użytkownikowi usunąć własne konto.

**Contract**:
- Funkcja triggera `public.restore_offer_on_invitation_delete()` (`security definer`, `set search_path = ''`, `returns trigger`). Gdy `old.status in ('pending', 'accepted')`, ustawia `status = 'seeking_agent'` na ofercie `old.offer_id`, ale tylko jeśli jej status to `invited` albo `in_progress`. Trigger `after delete on public.invitations for each row`. `revoke execute ... from public, anon, authenticated` (funkcji triggera nikt nie woła bezpośrednio).
- Jednorazowa naprawa: `update public.offers o set status = 'seeking_agent' where o.status in ('invited', 'in_progress') and not exists (select 1 from public.invitations i where i.offer_id = o.id and i.status in ('pending', 'accepted'))`. Jest idempotentna; komentarz w migracji mówi, że `-- down:` jej nie cofa.
- `public.delete_own_account() returns text`, `volatile`, `security definer`, `set search_path = ''`: `delete from auth.users where id = (select auth.uid())`. Zwraca `'ok'` albo `'not_found'` (brak `auth.uid()` lub brak wiersza). `revoke execute ... from public, anon; grant execute ... to authenticated`.
- Blok `-- down:` usuwa funkcję RPC, trigger i funkcję triggera.

#### 2. Typy bazy

**File**: `src/db/database.types.ts`

**Intent**: Wygenerować typy z nowym RPC (CI sprawdza ich aktualność).

**Contract**: `npm run db:types` po `npx supabase migration up` (albo `db reset`, po uprzedzeniu użytkownika, że kasuje lokalne konta). `delete_own_account` pojawia się w `Functions`.

#### 3. Test SQL

**File**: `supabase/tests/account-deletion.sql`

**Intent**: W jednej transakcji z rollbackiem udowodnić niezmiennik i uprawnienia, w stylu `supabase/tests/invitation-response.sql`, z prefiksem UUID `0007`.

**Contract**: Przypadki (każdy jako `do` blok z `raise exception` przy niezgodności):
- agent z zaproszeniem `accepted` woła `delete_own_account()` jako `authenticated` → wynik `'ok'`; brak wierszy w `auth.users`, `profiles`, `invitations` dla tego agenta; oferta ma `seeking_agent`;
- agent z zaproszeniem `pending`: to samo, oferta `invited` → `seeking_agent`;
- agent z zaproszeniem `rejected` na ofercie, która ma inne zaproszenie `pending`: po usunięciu oferta zostaje `invited` (trigger nie rusza ofert z innym aktywnym zaproszeniem ani nieaktywnych zaproszeń);
- usunięcie agenta zwykłym `delete from auth.users` jako `postgres` (ścieżka panelu) → oferta `seeking_agent`;
- właściciel woła `delete_own_account()` → jego oferty i zaproszenia (także `owner_id`) znikają, bez błędu;
- `delete_own_account()` bez `request.jwt.claims` (brak `auth.uid()`) → `'not_found'`, nic nie usunięte;
- `anon` nie ma `execute` na `delete_own_account` (`has_function_privilege`), `authenticated` ma;
- naprawa: oferta ustawiona ręcznie na `in_progress` bez zaproszenia, po ponownym wykonaniu `update` z migracji → `seeking_agent` (sprawdza samo zapytanie naprawcze).

### Success Criteria:

#### Automated Verification:

- Migracja stosuje się lokalnie bez błędu: `npx supabase migration up`
- Test SQL przechodzi: `docker exec -i supabase_db_10x-astro-starter psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/account-deletion.sql`
- Pozostałe testy SQL przechodzą: pętla po `supabase/tests/*.sql` jak w CI
- Typy są aktualne: `npm run db:types` i `git diff --exit-code src/db/database.types.ts` po commicie
- Lint i typy: `npm run lint` i `npx astro check`

#### Manual Verification:

- Na produkcji `select has_table_privilege('postgres', 'auth.users', 'DELETE');` zwraca `true` (SQL Editor, uruchamia użytkownik przed implementacją)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Endpoint i UI

### Overview

Użytkownik obu ról może usunąć konto z poziomu aplikacji.

### Changes Required:

#### 1. Serwis

**File**: `src/lib/services/account.ts`

**Intent**: Zamknięty zbiór wyników RPC i kodów błędów z polskimi komunikatami, jak w `src/lib/services/invitations.ts`.

**Contract**: `DELETE_ACCOUNT_RESULTS = ["ok", "not_found"]` + `isDeleteAccountResult`. `ACCOUNT_ERROR_CODES = ["unavailable", "unknown"]` + `accountErrorMessage(code: string | null): string | null` (nieznany kod → komunikat `unknown`).

#### 2. Endpoint

**File**: `src/pages/api/account/delete.ts`

**Intent**: `POST` usuwa konto zalogowanego użytkownika dowolnej roli, czyści sesję i przekierowuje na stronę główną.

**Contract**: `POST`, formularz bez pól. Kolejność kroków:
- brak `locals.user` → redirect `/auth/signin`;
- brak klienta, błąd odczytu roli z `profiles` albo brak wiersza profilu (`data === null`, jak rozdział błąd/brak wiersza w `src/pages/api/owner/invitations.ts:35-38`) → redirect `/dashboard?error=unavailable` (bez roli nie znamy strony konta; `/dashboard` przekieruje dalej, a komunikatu nie pokazujemy);
- po odczycie roli każdy błąd wraca na `${homeFor(role)}/account?error=<code>`: `unknown` przy błędzie `rpc("delete_own_account")` albo wyniku spoza `DELETE_ACCOUNT_RESULTS`;
- `'ok'` i `'not_found'` (konta już nie ma) → `signOut({ scope: "local" })` w try/catch, potem redirect `/?deleted=1`.

#### 3. Komponent potwierdzenia

**File**: `src/components/account/DeleteAccount.tsx`

**Intent**: Przycisk `destructive` „Usuń konto” otwiera inline tekst skutków i przyciski „Tak, usuń konto” / „Anuluj”, z tą samą obsługą fokusu i `useNativeSubmitting` co `InvitationResponse.tsx`. Formularz wysyła natywny `POST` na `/api/account/delete`.

**Contract**: Props `{ role: Role }`, od którego zależy tekst skutków. Właściciel: „Usuniemy Twoje konto, wszystkie oferty i zaproszenia. Tego nie da się cofnąć.” Agent: „Usuniemy Twoje konto, profil i zaproszenia. Oferty, które obsługujesz, wrócą do statusu „Szuka agenta”. Tego nie da się cofnąć.” Komponent `.tsx`, bo ma stan (CLAUDE.md).

#### 4. Strony konta

**Files**: `src/pages/owner/account.astro`, `src/pages/agent/account.astro`

**Intent**: Strona „Konto” w `AppLayout` z kartą: e-mail użytkownika, rola i sekcja „Usuń konto” z `DeleteAccount` (`client:load`) oraz `ServerError` dla `?error=`.

**Contract**: Tytuł „Konto”. Middleware zapewnia rolę na prefiksie. Obie strony są cienkie, a wspólna treść siedzi w komponencie (opcjonalnie wspólny `src/components/account/AccountCard.astro`, jeśli duplikacja przekroczy kilka linii).

#### 5. Nawigacja

**File**: `src/components/shell/nav.ts`

**Intent**: Pozycja „Konto” (ikona `Settings` albo `UserCog` z `lucide-react`) dla obu ról, ostatnia na liście.

**Contract**: `navFor(role)` zwraca 3 elementy dla każdej roli; `href = ${homeFor(role)}/account`. Agent ma już „Profil” (`UserRound`), więc ikona musi się od niego różnić.

#### 6. Komunikat po usunięciu

**File**: `src/pages/index.astro`

**Intent**: Przy `?deleted=1` pokazać nad sekcją hero komunikat „Konto zostało usunięte razem z Twoimi danymi.” (`role="status"`, styl jak istniejące komunikaty sukcesu, np. `?saved` na `/agent/profile`).

**Contract**: Flaga z `Astro.url.searchParams`. Nie pokazujemy jej, gdy `locals.user` istnieje.

### Success Criteria:

#### Automated Verification:

- Lint, typy i build: `npm run lint`, `npx astro check`, `npm run build`
- `curl` na lokalnym serwerze: `POST /api/account/delete` bez sesji → 302 na `/auth/signin`
- `curl` z sesją agenta z przyjętym zaproszeniem (konto zakładane przez `POST /api/auth/signup`): `POST /api/account/delete` → 302 na `/?deleted=1`, `Set-Cookie` czyści ciasteczka `sb-*`; potem `psql`: brak użytkownika w `auth.users`, oferta `seeking_agent`
- `curl` z sesją właściciela: `GET /owner/account` → 200 z „Usuń konto”; `GET /agent/account` → redirect (zła rola)
- Smoke na działającym serwerze nadal przechodzi: `npm run smoke`

#### Manual Verification:

- `/owner/account` i `/agent/account`: wygląd w light/dark i przy 360 px, „Konto” aktywne w sidebarze/docku
- Klawiatura: „Usuń konto” → fokus na „Tak, usuń konto”; „Anuluj” → fokus wraca na „Usuń konto”; stan wysyłania (DevTools throttling) blokuje przyciski
- Po potwierdzeniu: `/` z komunikatem o usunięciu, Back na `/owner` przekierowuje na logowanie, ponowne logowanie tymi danymi daje „Nieprawidłowy e-mail lub hasło”

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Smoke i produkcja

### Overview

Smoke dowodzi z perspektywy użytkownika, że usunięcie konta działa i przywraca ofertę. Przy okazji sprząta konta, które sam zakłada. Potem wdrożenie migracji i sprawdzenie na produkcji.

### Changes Required:

#### 1. Kroki w smoke

**File**: `scripts/smoke.mjs`

**Intent**: Na końcu przebiegu agent z przyjętym zaproszeniem usuwa konto: oferta wraca na stronie właściciela do „Szuka agenta”. Potem usuwają konta pozostali użytkownicy smoke'a i każde logowanie po usunięciu kończy się `invalid_credentials`.

**Contract**: Nowe kroki (format `check(name, response, expected)` jak dotąd):
- agent z `accepted`: `POST /api/account/delete` → 302 `/?deleted=1`;
- `GET /owner/offers/<acceptedOfferId>` jako właściciel → body zawiera etykietę statusu „Szuka agenta” i formularz zaproszenia, nie zawiera e-maila usuniętego agenta;
- pozostali agenci smoke'a, drugi właściciel i właściciel: `POST /api/account/delete` → 302 `/?deleted=1`;
- `POST /api/auth/signin` dowolnym z usuniętych kont → 302 z `error=invalid_credentials`;
- `GET /` z `?deleted=1` → body zawiera komunikat o usunięciu.
Zaktualizować komentarz `scripts/smoke.mjs:47-49` o pozostawianych kontach.

#### 2. Wdrożenie i weryfikacja na produkcji

**Intent**: Migracja na produkcję przed merge, zgodnie z README.

**Contract**: `npx supabase db push --dry-run` (pokazać wynik i poczekać na zgodę) → `npx supabase db push` → merge PR → deploy. Przed `db push` zapytanie kontrolne liczy osierocone oferty (`select count(*) from offers o where status in ('invited','in_progress') and not exists (...)`), a po nim liczba ma wynosić 0.

### Success Criteria:

#### Automated Verification:

- Smoke lokalnie przechodzi z nowymi krokami: `npm run smoke`
- CI zielone na PR (ci, smoke z testami SQL): `gh pr checks`
- Po deployu produkcja odpowiada: job `deploy` zielony (`gh run list --branch main`)

#### Manual Verification:

- `npx supabase db push --dry-run` pokazuje tylko migrację `account_deletion` (wynik pokazany użytkownikowi przed `db push`)
- Na produkcji po `db push`: zapytanie o osierocone oferty zwraca 0
- Na produkcji: nowe konto testowe agenta z przyjętym zaproszeniem usuwa konto w UI → oferta właściciela ma „Szuka agenta”; konto testowe właściciela usuwa konto → `/` z komunikatem, logowanie nieudane (uwaga: limit ~2 maili/h przy rejestracji)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

- Brak frameworka testów jednostkowych (CLAUDE.md). Logikę danych pokrywa test SQL.

### Integration Tests:

- `supabase/tests/account-deletion.sql`: trigger dla `pending` i `accepted`, brak efektu dla `rejected` i dla ofert z innym aktywnym zaproszeniem, ścieżka panelu (`postgres`), usunięcie właściciela, brak `auth.uid()`, uprawnienia funkcji, zapytanie naprawcze.
- `npm run smoke`: pełna ścieżka użytkownika (agent usuwa konto → oferta „Szuka agenta” u właściciela → logowanie usuniętych kont nieudane).

### Manual Testing Steps:

1. Zaloguj się jako agent z przyjętym zaproszeniem, wejdź w „Konto”, usuń konto i potwierdź.
2. Zaloguj się jako właściciel tej oferty: status „Szuka agenta”, ranking i zaproszenie są dostępne.
3. Usuń konto właściciela: `/` z komunikatem, a logowanie tymi danymi się nie udaje.

## Performance Considerations

Trigger wykonuje jeden `update` po kluczu głównym na każde usunięte zaproszenie. Przy usunięciu właściciela z wieloma ofertami to N pustych `update` w jednej transakcji, czyli dla MVP pomijalnie.

## Migration Notes

- Migracja jest wdrażana ręcznie przed merge (README, „Migracje bazy na produkcji”).
- Jednorazowa naprawa zmienia dane produkcyjne i `-- down:` jej nie cofa. Jest idempotentna i dotyczy tylko ofert, które według niezmiennika i tak są błędne.
- Wycofanie: `npx wrangler rollback` cofa kod. SQL z bloku `-- down:` (drop RPC, trigger i funkcji triggera) uruchamia się ręcznie w SQL Editorze.

## References

- Research: `context/changes/account-deletion/research.md`
- Roadmapa: `context/foundation/roadmap.md` (S-07), PRD: `context/foundation/prd.md:69,103`
- F1: `context/archive/2026-10-28-agent-invitation/reviews/impl-review.md:43-60`
- Wzorzec RPC: `supabase/migrations/20261028200000_invitation_response.sql:75-125`
- Wzorzec endpointu: `src/pages/api/owner/invitations.ts:6-66`
- Wzorzec potwierdzenia: `src/components/agent/InvitationResponse.tsx`
- Wzorzec testu SQL: `supabase/tests/invitation-response.sql`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Baza – trigger, naprawa, RPC

#### Automated

- [x] 1.1 Migracja stosuje się lokalnie bez błędu
- [x] 1.2 Test SQL account-deletion przechodzi
- [x] 1.3 Pozostałe testy SQL przechodzą
- [x] 1.4 Typy bazy są aktualne
- [x] 1.5 Lint i astro check przechodzą

#### Manual

- [x] 1.6 Produkcyjny postgres ma DELETE na auth.users

### Phase 2: Endpoint i UI

#### Automated

- [ ] 2.1 Lint, typy i build przechodzą
- [ ] 2.2 POST /api/account/delete bez sesji przekierowuje na logowanie
- [ ] 2.3 Usunięcie agenta przez endpoint czyści sesję i przywraca ofertę
- [ ] 2.4 Strony konta dostępne tylko dla właściwej roli
- [ ] 2.5 Smoke przechodzi bez zmian

#### Manual

- [ ] 2.6 Strony konta: wygląd, motywy, 360 px, aktywna nawigacja
- [ ] 2.7 Potwierdzenie: fokus, klawiatura, stan wysyłania
- [ ] 2.8 Po usunięciu: komunikat na /, brak dostępu, logowanie nieudane

### Phase 3: Smoke i produkcja

#### Automated

- [ ] 3.1 Smoke z krokami usunięcia konta przechodzi lokalnie
- [ ] 3.2 CI zielone na PR
- [ ] 3.3 Deploy na main zielony

#### Manual

- [ ] 3.4 db push --dry-run pokazuje tylko migrację account_deletion
- [ ] 3.5 Brak osieroconych ofert na produkcji po db push
- [ ] 3.6 Usunięcie konta agenta i właściciela działa na produkcji
