---
date: 2026-10-29T08:50:05+01:00
researcher: Claude (Opus 5.5) z bkreczmer
git_commit: bf8aea1
branch: main
repository: helloDOM
topic: "S-04 owner-offer-management: lista ofert ze statusem, edycja w draft/seeking_agent, usuwanie"
tags: [research, offers, rls, owner, S-04, FR-004, FR-005, FR-006]
status: complete
last_updated: 2026-10-29
last_updated_by: Claude (Opus 5.5)
---

# Research: S-04 owner-offer-management

**Date**: 2026-10-29T08:50:05+01:00
**Researcher**: Claude (Opus 5.5) z bkreczmer
**Git Commit**: bf8aea1 (working tree: tylko nieśledzony `context/changes/owner-offer-management/`)
**Branch**: main
**Repository**: helloDOM

## Research Question

Z `context/foundation/roadmap.md` (S-04) i PRD FR-004/005/006 (`context/foundation/prd.md:75-79`): co w obecnym kodzie trzeba dodać lub zmienić, żeby właściciel (1) widział listę swoich ofert ze statusem, (2) edytował ofertę w statusie „szkic” albo „szuka agenta” i (3) usuwał ofertę — z zachowaniem RLS z PRD Guardrails i reguł statusów z S-05/S-06/S-07.

## Summary

1. **Lista już jest, bez statusu.** `/owner` pobiera oferty (`src/pages/owner/index.astro:18-22`, limit 50 z `src/lib/services/offers.ts:15`), ale select nie zawiera `status`, a `OfferListItem` go nie ma (`src/types.ts:59-60`). FR-004 to dodanie `status` do selectu, typu, mappera i `StatusPill` w wierszu. Tony pilli są dziś lokalne w `src/components/offers/OfferSummary.astro:15` — do przeniesienia, żeby lista ich nie duplikowała.
2. **Baza nie pozwala dziś ani na update, ani na delete.** `authenticated` ma tylko `select` i kolumnowy `insert` (`supabase/migrations/20261028140000_create_offers.sql:41-45`); komentarz `:6` „No update or delete grants yet (S-04)”. Polityki na `offers` to tylko `offers_select_own`, `offers_insert_own_owner` (`create_offers.sql:47-62`) i `offers_select_invited_agent` (`20261028180000_create_invitations.sql:47-57`). Potrzebna migracja.
3. **Kontrakt z wcześniejszych zmian:** grant UPDATE nie może obejmować `status`, a polityka update musi wymagać `status in ('draft','seeking_agent')` (`context/archive/2026-10-28-agent-invitation/research.md:109`, `plan-brief.md:64`). Test `supabase/tests/agent-invitation.sql:208-211` oczekuje `insufficient_privilege` przy `update offers set status` jako właściciel — kolumnowy grant bez `status` go nie łamie.
4. **Sprawdzone w lokalnej bazie** (transakcja z `rollback`, tymczasowe `grant update (price)`, `grant delete` i polityki `using owner_id = auth.uid() [and status in ('draft','seeking_agent')]`), jako właściciel przez RLS: update oferty `in_progress` → `UPDATE 0` bez błędu; update oferty `seeking_agent` → `UPDATE 1`; delete oferty `in_progress` z zaproszeniem `accepted` → `DELETE 1`, zaproszenie usunięte kaskadą, trigger `restore_offer_on_invitation_delete` (`20261028220000_account_deletion.sql:11-34`) bez błędu. Wniosek: zablokowana edycja nie zgłasza błędu, więc endpoint musi sprawdzić liczbę zmienionych wierszy (`.select()` po update) i rozróżnić `not_found` od `offer_locked`.
5. **`draft` jest nieosiągalny.** Domyślny status to `seeking_agent` (`create_offers.sql:18`), `status` nie ma grantu insert (`:43-44`), a żadna funkcja nie ustawia `draft` (grep po `supabase/migrations` i `src`). Decyzja S-03: od razu `seeking_agent`, `draft` „na później” (`context/archive/2026-10-28-offer-top3-ranking/plan-brief.md:23`, `plan.md:34`). Bez nowej ścieżki FR-005 w praktyce oznacza edycję tylko w `seeking_agent`.
6. **Warstwa aplikacji do rozbudowy:** `src/pages/api/owner/offers.ts` ma tylko `POST` (create); serwis nie ma funkcji update/delete; `OfferForm.tsx` ma zahardkodowany `action` (`:161`), etykietę przycisku (`:317-319`) i puste stany startowe (`:87-93`). Usuwanie ma gotowy wzorzec w `src/components/account/DeleteAccount.tsx` + `src/pages/api/account/delete.ts` (inline potwierdzenie, natywny POST, redirect).
7. **Ranking nie wymaga przeliczania po edycji** — liczy się przy każdym renderze `src/pages/owner/offers/[id].astro:48` przez RPC `rank_agents_for_offer`, który wyklucza odrzucających agentów po `offer_id` (`20261028200000_invitation_response.sql:46-49`), więc edycja nie przywraca ich do rankingu.

## Detailed Findings

### Baza: tabela, statusy, granty, polityki

- Kolumny i CHECK-i: `create_offers.sql:8-33`; status to `text` + CHECK `offers_status_valid` z 4 wartościami (`:33`), nie enum Postgresa; w typach `string` (`src/db/database.types.ts`, tabela `offers`), lista w TS `OFFER_STATUSES` (`src/types.ts:15`).
- Kto ustawia status (grep po migracjach i `src`): `seeking_agent` — default (`create_offers.sql:18`), reject w `respond_to_invitation` (`20261028200000_invitation_response.sql:117`), trigger restore (`20261028220000_account_deletion.sql:19-22`); `invited` — `invite_agent` (`20261028180000_create_invitations.sql:106`); `in_progress` — accept (`invitation_response.sql:113`); `draft` — nic.
- Indeks `(owner_id, created_at desc)` (`create_offers.sql:36`) pasuje do listy właściciela.
- Nowa polityka na `offers` nie powinna czytać `invitations` (rekurencja RLS, `20261028180000_create_invitations.sql:4-6`); czytanie `profiles` jest dopuszczalne (wzorzec `offers_insert_own_owner`).

### Baza: współbieżność i kaskady

- `invite_agent` i `respond_to_invitation` blokują wiersz oferty `for update` przed zmianą statusu (`create_invitations.sql:77-81`, `invitation_response.sql`). Wniosek (nie sprawdzony testem współbieżnym): bezpośredni UPDATE właściciela czeka na blokadę i w READ COMMITTED ponownie ocenia warunek USING na nowej wersji wiersza — jeśli oferta zdążyła przejść w `invited`, update obejmie 0 wierszy, co jest tym samym przypadkiem co w punkcie 4 Summary.
- `invitations.offer_id ... on delete cascade` (`create_invitations.sql:12`) to jedyny FK do `offers` (`src/db/database.types.ts`, `invitations_offer_id_fkey`). Usunięcie oferty kasuje wszystkie jej zaproszenia (pending/accepted/rejected); agent traci dostęp, bo `offers_select_invited_agent` zależy od zaproszenia. Kaskadę jako `postgres` testuje już `agent-invitation.sql:295-303`; jako właściciel przez RLS — sprawdzone w tym badaniu (Summary 4).
- Baza dziś nie ogranicza usuwania ofert `invited`/`in_progress` — to wybór produktowy (Open Questions).

### Aplikacja: lista `/owner`

- Zapytanie bez filtra `owner_id`, zawęża je RLS `offers_select_own` (`index.astro:18-22`). Wiersz listy `index.astro:51-72`, pusty stan `:45-48`, błąd `:43-44`.
- Mapper `toOfferListItem` (`src/lib/services/offers.ts:114-124`); etykiety `OFFER_STATUS_LABELS` (`src/lib/dictionaries.ts:68-73`).

### Aplikacja: strona oferty i API

- `[id].astro`: `parseOfferId` → select `.maybeSingle()` (`:27-42`), 404 dla `missing` (`:87-89`); `seeking_agent` → ranking (`:46-66`, `:120-132`), inne statusy → `InvitationStatusCard` (`:67-82`, `:133-135`). Brak akcji Edytuj/Usuń.
- `api/owner/offers.ts`: `fail(code)` → redirect `?error=` (`:6`), brak sesji → `/auth/signin` (`:14-16`), rola z `profiles`, zła rola → 403 (`:20-30`), `invalid_input` (`:33-41`), sukces → `/owner/offers/{id}?created=1` (`:67`). Natywny POST + 302, bez JSON.
- Wzorzec endpointu z id oferty: `api/owner/invitations.ts:15-17` (błąd wraca na stronę oferty przy poprawnym uuid, inaczej na `/owner`), RPC z wynikiem `ok|not_found|offer_locked` (`:49-61`).
- `offerErrorMessage` / `OFFER_ERROR_CODES` (`offers.ts:170-188`) mówią o „zapisie oferty” — usuwanie i blokada edycji potrzebują własnych kodów/tekstów.

### Aplikacja: formularz, usuwanie, nawigacja, smoke

- `OfferForm.tsx`: props tylko `limits`, `serverError` (`:60-71`); do edycji potrzebne `initialValues` (metraż jako string z przecinkiem), `action`, `submitLabel`, ukryte `offerId`. `ChoiceCards.tsx` jest kontrolowany (`:14-22`).
- `DeleteAccount.tsx`: przycisk `destructive` → inline potwierdzenie z formularzem POST (`:49-91`), fokus (`:29-47`), `useNativeSubmitting`. Wariant `destructive` przycisku zachowano w app-shell właśnie dla „Usuń ofertę” (`context/archive/2026-10-27-app-shell/reviews/plan-review.md:77`).
- `nav.ts:12-19`: owner ma Panel (`/owner`), Nowa oferta, Konto; `isActive` po prefiksie (`:27-29`) — osobna strona `/owner/offers` podświetlałaby się też na `/owner/offers/new`. Lista może zostać na Panelu.
- Gating: `/owner/*` przez `src/lib/route-guard.ts:4-7` — nowa strona `/owner/offers/[id]/edit` jest chroniona automatycznie; `/api/*` sprawdza sesję i rolę samo.
- Smoke `scripts/smoke.mjs`: oferta tworzona `:162-170`, lista `:308-311`, 404 cudzej oferty `:313-326`, `offer_locked` `:377-380`. `offerId` jest używany dalej (`:393-394`), więc do testu usuwania potrzebna osobna oferta.
- Testy SQL: wzorzec `begin` / `set local role authenticated` / `request.jwt.claims` / `do $$ ... raise exception` / `rollback` (`supabase/tests/account-deletion.sql:1-53`); `get diagnostics n = row_count` dla 0 wierszy przez RLS (`agent-profile.sql:96-120`). CI uruchamia każdy `supabase/tests/*.sql` (`.github/workflows/ci.yml:43-49`) i sprawdza aktualność typów (`ci.yml:50`); same granty/polityki nie zmieniają `database.types.ts`, nowa funkcja RPC — tak.

## Code References

- `supabase/migrations/20261028140000_create_offers.sql:6,18,33,41-62` — komentarz S-04, default statusu, CHECK, granty, polityki
- `supabase/migrations/20261028220000_account_deletion.sql:11-34` — trigger przywracający `seeking_agent`
- `supabase/migrations/20261028180000_create_invitations.sql:12,47-57,77-110` — kaskada, polityka agenta, `invite_agent`
- `supabase/tests/agent-invitation.sql:208-211,295-303` — test zakazu update statusu i kaskady
- `src/pages/owner/index.astro:18-22,51-72` — lista
- `src/pages/owner/offers/[id].astro:27-135` — strona oferty
- `src/pages/api/owner/offers.ts:6-67` — create endpoint
- `src/pages/api/owner/invitations.ts:15-17,49-61` — wzorzec błędów z id oferty
- `src/lib/services/offers.ts:15,26-67,114-124,170-188` — limit, schemat, mapper, kody błędów
- `src/components/owner/OfferForm.tsx:60-93,161,317-319` — props, stany, action, etykieta
- `src/components/account/DeleteAccount.tsx:29-91` — wzorzec akcji destrukcyjnej
- `src/components/offers/OfferSummary.astro:15` — lokalne `STATUS_TONES`
- `src/components/shell/nav.ts:12-29` — nawigacja właściciela

## Architecture Insights

- Zapisy domenowe ze zmianą statusu idą przez `security definer` RPC z wynikami-kodami (`invite_agent`, `respond_to_invitation`, `delete_own_account`); proste zapisy własnych danych (insert oferty, profil agenta) — przez kolumnowe granty + RLS. Edycja pól oferty i usunięcie nie zmieniają statusu, więc pasują do drugiego wzorca; RPC jest alternatywą, jeśli plan chce jednego kodu `offer_locked` zamiast liczenia wierszy.
- Formularze: natywny POST + redirect 302 z `?error=kod` mapowanym przez allowlistę w serwisie.

## Historical Context (from prior changes)

- `context/archive/2026-10-28-offer-top3-ranking/plan.md:33-34` — edycja, usuwanie i lista ze statusem przeniesione do S-04; `draft` dopuszczony w CHECK, ale nieużywany. Nadal aktualne.
- `context/archive/2026-10-28-offer-top3-ranking/plan.md:316` (Addendum F2) — limit 50 na `/owner`, stronicowanie w S-04. Aktualne (`offers.ts:15`).
- `context/archive/2026-10-28-offer-top3-ranking/follow-ups/review-fixes.md` — otwarte F4: brak `console.error` i 200 przy błędzie w `owner/index.astro`, `[id].astro`, `api/owner/offers.ts` (S-04 dotyka tych plików; odroczone do M3).
- `context/archive/2026-10-28-invitation-response/reviews/impl-review.md:73-74` (F5, SKIPPED) — `api/owner/invitations.ts:17` przy złym `offerId` wraca na `/owner` bez komunikatu; „zostawić na S-04”. Kod nadal taki (`invitations.ts:17`).
- `context/changes/account-deletion/plan.md:17,37` — trigger restore ma obsłużyć przyszłe usuwanie ofert z S-04. Potwierdzone (Summary 4); migracja jest na `main` (commit `48ab761`).

## Related Research

- `context/archive/2026-10-28-agent-invitation/research.md`
- `context/archive/2026-10-28-offer-top3-ranking/research.md`
- `context/changes/account-deletion/research.md`

## Open Questions

Decyzje produktowe dla `/10x-plan` (owner: user):

1. **Status „szkic”.** (a) Pominąć: edycja tylko w `seeking_agent`, `draft` zostaje w CHECK nieużywany — zgodne z decyzją S-03 i celem `speed`; (b) dodać zapis jako szkic + akcję „opublikuj” — nowa ścieżka statusu, więcej UI i testów. Rekomendacja badania: (a), z zapisem odstępstwa od FR-004/005 w planie.
2. **Usuwanie ofert `invited`/`in_progress`.** Baza na to pozwala, a agent traci ofertę bez powiadomienia. Opcje: pozwolić na każdy status (FR-006 bez warunku) albo ograniczyć delete do `draft`/`seeking_agent`.
3. **Mechanizm zapisu:** kolumnowy grant + polityki (sprawdzone wyżej) czy RPC `update_offer`/`delete_offer` z kodami `ok|not_found|offer_locked`.
4. **Stronicowanie/filtry listy** (Addendum F2 S-03): czy w S-04, czy zostaje limit 50.
