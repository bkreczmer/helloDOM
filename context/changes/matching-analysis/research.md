---
date: 2026-10-29T18:45:00+01:00
researcher: Claude (Opus 5.5) for bkreczmer
git_commit: c257f0c
branch: docs/architect-m4
repository: bkreczmer/helloDOM
topic: "Przepływ dopasowania: oferta → ranking top 3 → zaproszenie → odpowiedź agenta (M4L3)"
tags: [research, matching, ranking, invitations, offers, m4l3]
status: complete
last_updated: 2026-10-29
last_updated_by: Claude (Opus 5.5)
---

# Research: przepływ dopasowania (M4L3)

**Research question:** jak działa proces dopasowania (oferta właściciela → ranking top 3 → zaproszenie → odpowiedź agenta → status oferty), ze szczególnym uwzględnieniem obszarów z `context/map/repo-map.md`:

- strefy ryzyka _invitations_ i _access_;
- obserwowane: `src/lib/services/offers.ts` jako centrum zależności i SQL rankingu rozproszony po migracjach.

Tylko analiza stanu obecnego. Metoda: trzech równoległych badaczy (ślad end-to-end, luki w testach, zasięg zmian), potem weryfikacja twierdzeń strukturalnych ast-grepem 0.51.0 (sekcja „Weryfikacja ast-grep”).

## 1. Przegląd funkcjonalności

**Wejście:**

- właściciel wysyła natywny formularz oferty (`src/components/owner/OfferForm.tsx:96,175`) na `POST /api/owner/offers` (7 pól: `city`, `propertyType`, `transaction`, `price`, `areaM2`, `rooms`, `description`);
- przycisk „Zaproś” w rankingu wysyła ukryte `offerId` i `agentId` (`src/components/owner/RankingList.astro:53-55`);
- agent po dwuetapowym potwierdzeniu wysyła `offerId` i `response` (`src/components/agent/InvitationResponse.tsx:94-95`).

**Gdzie zmienia się stan:** wyłącznie w Postgresie. Użytkownik `authenticated` nie ma prawa zapisu do `invitations` ani do `offers.status` (`supabase/migrations/20261028180000_create_invitations.sql:31-32`, `20261028140000_create_offers.sql:43-44`). Każde przejście idzie przez funkcję RPC albo trigger:

| tabela.kolumna                       | zmiana                                                                                 | plik:linia                                                                               |
| ------------------------------------ | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `offers.status`                      | (nowa) → `seeking_agent`                                                               | DEFAULT `20261028140000_create_offers.sql:18`; insert `src/pages/api/owner/offers.ts:48` |
| `invitations.status`                 | (nowe) → `pending`                                                                     | `20261028180000_create_invitations.sql:15,100`                                           |
| `offers.status`                      | `seeking_agent` → `invited`                                                            | `20261028180000_create_invitations.sql:106`                                              |
| `invitations.status`, `responded_at` | `pending` → `accepted` / `rejected`, `now()`                                           | `20261028200000_invitation_response.sql:111,115`                                         |
| `offers.status`                      | `invited` → `in_progress` / `seeking_agent`                                            | `20261028200000_invitation_response.sql:113,117`                                         |
| `offers.status`                      | `invited`/`in_progress` → `seeking_agent` (trigger po usunięciu aktywnego zaproszenia) | `20261028220000_account_deletion.sql:19-22`                                              |

**Co wraca:** każde wywołanie kończy się przekierowaniem 302:

- sukces: `?created=1` / `?invited=1` / `?accepted=1` / `/agent?rejected=1`;
- błąd biznesowy: `?error=<kod>` (`offer_locked`, `agent_not_ranked`, `already_responded`, `invalid_input`, `unknown`);
- cudza albo nieistniejąca oferta: 404.

Strona oferty właściciela liczy ranking przez `rpc("rank_agents_for_offer")` tylko w statusie `seeking_agent` (`src/pages/owner/offers/[id].astro:62`). Błąd RPC daje 503 i linię logu (`:64-66,121-122`).

**Logika:** reguła wyniku żyje wyłącznie w SQL. Wynik = typ 35 + cena 35 (granice włącznie) + 3 pkt za rok stażu, maksymalnie za 10 lat. Do rankingu wchodzą tylko agenci z miastem oferty i pełnym profilem, bez tych, którzy odrzucili zaproszenie do tej oferty. Wynik musi być większy od 0, lista jest ograniczona do 3, a remisy rozstrzyga kolejno staż, `created_at` i `agent_id` (`20261028200000_invitation_response.sql:21-54`).

`invite_agent` przelicza ranking jeszcze raz w momencie zaproszenia (`20261028180000_create_invitations.sql:92-97`), więc sprawdza **bieżący** top 3, a nie ten, który właściciel widział na stronie. Oba RPC blokują wiersz oferty `FOR UPDATE` w tej samej kolejności (oferta → zaproszenie).

```mermaid
sequenceDiagram
  actor O as Właściciel
  actor A as Agent
  participant MW as middleware.ts
  participant API as /api/*
  participant PG as Postgres (RLS/RPC)
  O->>API: POST /api/owner/offers (7 pól)
  API->>PG: select profiles.role; insert offers
  PG-->>API: id (status=seeking_agent)
  API-->>O: 302 /owner/offers/{id}?created=1
  O->>MW: GET /owner/offers/{id}
  MW->>PG: getUser + profiles (rola owner)
  MW->>PG: select offers (RLS) + rpc rank_agents_for_offer
  PG-->>O: top 3 (RankingList, formularze „Zaproś”)
  O->>API: POST /api/owner/invitations (offerId, agentId)
  API->>PG: rpc invite_agent (lock, top 3 na nowo, insert, offers→invited)
  PG-->>API: ok | not_found | offer_locked | agent_not_ranked
  API-->>O: 302 ?invited=1 / ?error= / 404
  A->>MW: GET /agent/offers/{id}
  MW->>PG: select offers (offers_select_invited_agent), invitations
  A->>API: POST /api/agent/invitations (offerId, response)
  API->>PG: rpc respond_to_invitation (lock oferta → zaproszenie)
  PG-->>API: ok | not_found | already_responded | invalid_response
  API-->>A: 302 ?accepted=1 / /agent?rejected=1 / ?error=
  Note over PG: DELETE aktywnego zaproszenia → trigger → offers→seeking_agent
```

### Dowody (wybrane)

- Ścieżka krok po kroku (z `file:line`): middleware `src/middleware.ts:16-68` → endpointy `src/pages/api/owner/{offers,invitations}.ts`, `src/pages/api/agent/invitations.ts` → RPC w migracjach 180000 i 200000 → trigger 220000.
- `/api/*` nie jest bramkowane rolą w middleware (`src/lib/route-guard.ts:7`). Każdy endpoint sam czyta `profiles.role` i zwraca 403.
- Wszystkie wywołania Supabase (`.from`/`.rpc`) siedzą w stronach, endpointach i middleware. Serwisy w `src/lib/services/` są czyste (zob. weryfikacja ast-grep, twierdzenie 2).

## 2. Dług techniczny

| #    | Ryzyko                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Dowód                                                 | Rodzaj                           |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | -------------------------------- |
| TD-1 | **Kontrakty bez kompilatora między SQL a TS.** Kody wyników RPC są utrzymywane ręcznie w dwóch miejscach: `INVITE_RESULTS` / `RESPOND_RESULTS` (`src/lib/services/invitations.ts:26,80`, komentarz `:77-78` „keep both lists in sync”) i wartości `return` w SQL (`20261028180000_create_invitations.sql:84,88,96,103,108`; `20261028200000_invitation_response.sql:84,93,103,107,120`). Nowy kod w SQL endpoint zamieni po cichu na `unknown`, a `isInviteResult` / `isRespondResult` nie mają testów jednostkowych. To samo dotyczy słowników `CITIES` / `PROPERTY_TYPES` / `TRANSACTIONS` (`src/lib/dictionaries.ts`) i CHECK-ów w migracjach. | ast-grep (twierdzenie 3) + grep                       | kruche sprzężenie, luka testowa  |
| TD-2 | **Reguła wyniku i maszyna stanów rozproszone po migracjach.** `rank_agents_for_offer` zdefiniowano w `20261028140000_create_offers.sql:70`, a nadpisano `create or replace` w `20261028200000_invitation_response.sql:21`. Przejścia `offers.status` są w 4 migracjach (180000, 200000, 220000, 20261029100000), a predykat „aktywne zaproszenie” `status in ('pending','accepted')` występuje w 5 miejscach SQL. Nagłówek testu `supabase/tests/offer-ranking.sql:1` wskazuje starą migrację. Żadne pojedyncze miejsce nie pokazuje pełnego zbioru przejść.                                                                                      | grep (twierdzenia 7–8)                                | rozproszona logika, blast radius |
| TD-3 | **Luki testowe na ścieżkach awarii i współbieżności.** Gałęzie `unavailable` / `unknown` endpointów i stany 503 stron nie mają testu automatycznego. Wyścig dwóch równoległych `invite_agent` jest symulowany ręcznym insertem (`supabase/tests/agent-invitation.sql:279-290`), nie prawdziwą współbieżnością. Ostatni remis (`agent_id`) i `offer_locked` dla `draft` są niepokryte.                                                                                                                                                                                                                                                             | raport badacza testów (sekcja „Dowody”)               | luka testowa                     |
| TD-4 | **Sprzężenia niewidoczne w grafie importów.** Najsilniej współzmieniające się pary nie mają krawędzi importu: `scripts/smoke.mjs` ↔ `src/types.ts` (6 commitów, pewność 0,75), `smoke.mjs` ↔ `src/pages/owner/offers/[id].astro` (5, 0,83). Formularze i endpointy łączą tylko nazwy pól (`offerId`, `agentId`, `response`), a `src/db/database.types.ts` jest powiązany z migracjami przez generator (CI: `npm run db:types` + `git diff --exit-code`). Graf statyczny zaniża zasięg zmian.                                                                                                                                                      | git co-change + `context/map/evidence/3-structure.md` | blast radius                     |

### Jeśli zmieniasz X, musisz zmienić też Y

| Zmieniasz                                           | Musisz też zmienić                                                                                                                                                                                                          |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Kod wyniku `invite_agent` / `respond_to_invitation` | `INVITE_RESULTS` / `RESPOND_RESULTS`, `switch` w `src/pages/api/{owner,agent}/invitations.ts`, mapy komunikatów, testy SQL, `scripts/smoke.mjs`                                                                             |
| Kolumny zwracane przez `rank_agents_for_offer`      | migracja `drop` + `create` (`create or replace` nie zmieni `returns table`), `npm run db:types`, `RankedAgent` (`src/types.ts:87`), `toRankedAgent` (`src/lib/services/offers.ts:149`), `RankingList.astro`, testy rankingu |
| Regułę wyniku                                       | nowa migracja z blokiem `-- down:`, `supabase/tests/offer-ranking.sql`, `tests/integration/ranking.test.ts` (R1–R8), E2E `tests/e2e/critical-path.spec.ts`                                                                  |
| Nazwę pola formularza                               | komponent (`RankingList.astro:54-55` / `InvitationResponse.tsx:94-95`), schemat w `src/lib/services/invitations.ts`, `scripts/smoke.mjs`                                                                                    |
| Status oferty albo zaproszenia                      | `OFFER_STATUSES` / `INVITATION_STATUSES` (`src/types.ts`), etykiety (`src/lib/dictionaries.ts:68,76`), polityki i indeks z listą statusów, trigger, `isOfferEditable`                                                       |

## 3. Weryfikacja ast-grep (prompt m4l3-2)

ast-grep 0.51.0 (`npx -y -p @ast-grep/cli ast-grep run -l ts`). Ograniczenie: ast-grep nie parsuje plików `.astro` ani SQL, więc tam każde zero i każdą liczbę potwierdza `grep`.

| #   | Twierdzenie                                                                            | Wzorzec                                          | Wynik                                                                                                                                                                                                                 | Werdykt                                                                                       |
| --- | -------------------------------------------------------------------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 1   | Przepływ ma 3 wywołania RPC: ranking na stronie, zaproszenie i odpowiedź w endpointach | `$C.rpc($$$ARGS)` (ts) + `grep "\.rpc("` (astro) | ts: `api/owner/invitations.ts:52` (`invite_agent`), `api/agent/invitations.ts:53` (`respond_to_invitation`), `api/account/delete.ts:44` (poza przepływem); astro: `owner/offers/[id].astro` (`rank_agents_for_offer`) | **potwierdzone** (4 RPC w aplikacji, 3 w przepływie)                                          |
| 2   | Serwisy w `src/lib/services/` nie wołają Supabase                                      | `$C.from($$$A)` w `src/lib/services`             | 1 trafienie: `offers.ts:58` = `Array.from(value).length` (długość opisu); `grep '\.from("'` w services: 0                                                                                                             | **doprecyzowane** — 0 wywołań Supabase; jedyne trafienie to `Array.from`                      |
| 3   | Strażnicy kontraktu RPC są wołani tylko w endpointach zaproszeń                        | `isInviteResult($X)`, `isRespondResult($X)`      | `api/owner/invitations.ts:53`, `api/agent/invitations.ts:57` — po jednym                                                                                                                                              | **potwierdzone**                                                                              |
| 4   | Oba endpointy rozgałęziają się `switch`-em po wyniku RPC                               | `switch (data) { $$$ }`                          | `api/owner/invitations.ts:57-67`, `api/agent/invitations.ts:61-76`                                                                                                                                                    | **potwierdzone**                                                                              |
| 5   | Każda gałąź błędu w endpointach zaproszeń loguje                                       | `reportError($$$A)`                              | 5 wywołań w `api/owner/invitations.ts`, 6 w `api/agent/invitations.ts`                                                                                                                                                | **potwierdzone**                                                                              |
| 6   | `createClient` jest wołany w każdej stronie i endpoincie z dostępem do danych          | `createClient($$$A)` (ts) + grep (astro)         | 12 plików ts (middleware, 10 endpointów, callback) + 6 stron `.astro` = 18 (+ definicja w `src/lib/supabase.ts:6`)                                                                                                    | **potwierdzone** (18 miejsc wywołania; zasila TD-4 i notatkę ACL)                             |
| 7   | Predykat „aktywne zaproszenie” jest powtórzony w SQL                                   | grep `'pending', 'accepted'` (SQL)               | 5 wystąpień: `create_invitations.sql:17,24,55`, `account_deletion.sql:18,44`                                                                                                                                          | **doprecyzowane** — 5 w SQL (1 to CHECK dopuszczalnych wartości); w TS predykat nie występuje |
| 8   | `rank_agents_for_offer` ma dwie definicje                                              | grep `function public.rank_agents_for_offer`     | `create_offers.sql:70` (create), `invitation_response.sql:21` (create or replace); `:130` to blok `-- down:`                                                                                                          | **potwierdzone**                                                                              |
| 9   | Ukryte `agentId` istnieje tylko w rankingu                                             | grep `name="agentId"`                            | `RankingList.astro:55`                                                                                                                                                                                                | **potwierdzone**                                                                              |

Pierwsza próba weryfikacji dała same zera, bo polecenie było przekazane w zmiennej powłoki zsh i ast-grep nie uruchomił się wcale. Wyniki powyżej pochodzą z powtórzenia w bashu. To dobry przykład, dlaczego prompt każe każde zero potwierdzić grepem.

## 4. Interpretacja i białe plamy

**Interpretacja:**

- Przepływ jest bezpieczny transakcyjnie: blokady, funkcje RPC i brak grantów zapisu. Ryzyko leży w kontraktach utrzymywanych ręcznie (TD-1) i w rozproszeniu reguły po migracjach (TD-2), a nie w samej logice.
- Strefa ryzyka _invitations_ z mapy potwierdza się jako najwięcej punktów styku na jedną zmianę. Obserwowany hub `services/offers.ts` jest centrum mapowań, ale nie logiki biznesowej.

**Białe plamy:**

- Nie uruchamiano runtime'u w tym badaniu. Ścieżki awarii zweryfikowano wcześniej ręcznie w `context/archive/2026-10-29-refactor-error-reporting/plan.md` (Addendum).
- Nie sprawdzono, czy `src/db/database.types.ts` odpowiada ostatniej wersji `rank_agents_for_offer`. CI pilnuje tego przez `git diff --exit-code`.
- Statystyka co-change opiera się na małych licznościach (1–6 commitów), a historia ma 3 dni.

## Historical Context

- `context/archive/2026-10-28-offer-top3-ranking/` — powstanie reguły wyniku i rankingu.
- `context/archive/2026-10-28-agent-invitation/`, `context/archive/2026-10-28-invitation-response/` — zaproszenia i odpowiedź (indeks jednego aktywnego zaproszenia, wykluczenie odrzuconych).
- `context/archive/2026-10-28-account-deletion/` — trigger przywracający ofertę.

## Related Research

- `context/map/repo-map.md` — strefy ryzyka i powiązania.
- `context/domain/domain-distillation.md` — niezmienniki R-01…R-17.
