---
date: 2026-10-28T14:44:43+0100
researcher: Claude (Opus 5.5) dla bkreczmer
git_commit: e7d7b9b
branch: main
repository: helloDOM
topic: "S-05 agent-invitation: właściciel zaprasza agenta z top 3, agent widzi swoje zaproszenia i tylko oferty, do których go zaproszono"
tags: [research, invitations, offers, ranking, rls, security-definer, supabase, smoke]
status: complete
last_updated: 2026-10-28
last_updated_by: Claude (Opus 5.5)
last_updated_note: "Pierwsza wersja."
---

# Research: S-05 agent-invitation

**Date**: 2026-10-28T14:44:43+0100
**Researcher**: Claude (Opus 5.5) dla bkreczmer
**Git Commit**: e7d7b9b
**Branch**: main
**Repository**: helloDOM

## Research Question

Co w obecnym kodzie i dokumentach określa, jak zbudować S-05: właściciel zaprasza jednego agenta z top 3 swojej oferty (oferta przechodzi w „zaproszenie wysłane”), a agent widzi swoje zaproszenia i tylko te oferty, do których go zaproszono. (Źródło: `context/foundation/roadmap.md:139-149`, PRD FR-009, FR-010 — `context/foundation/prd.md:93-96`.) Pytanie pomocnicze: co S-05 musi przygotować pod S-06 (przyjęcie/odrzucenie, wykluczenie z rankingu, najwyżej jeden przyjęty agent) i S-07 (usunięcie konta).

## Summary

- **Status oferty jest gotowy.** Check `offers_status_valid` dopuszcza `draft`, `seeking_agent`, `invited`, `in_progress` (`supabase/migrations/20261028140000_create_offers.sql:33`), a lustro w TS to `OFFER_STATUSES` (`src/types.ts:14-15`). S-05 nie zmienia checku; ustawia `invited`.
- **Nikt nie może dziś zmienić statusu oferty.** Na `offers` jest tylko `grant select` i `grant insert` na 7 kolumn, bez UPDATE i bez polityki update (`create_offers.sql:41-45`, komentarz `:6`). Zaproszenie musi więc dodać ścieżkę zapisu statusu — najspójniej z rankingiem jako funkcja `security definer` wykonująca atomowo: kontrola właściciela, `status = 'seeking_agent'`, agent w aktualnym top 3, insert zaproszenia, `status = 'invited'`.
- **Tabeli zaproszeń nie ma.** W `supabase/migrations/` są 4 migracje (profiles, agent profile, offers, check ceny); żadna nie tworzy `invitations` ani polityk dla agenta na `offers`. Jedyna polityka select na `offers` to `offers_select_own` (`create_offers.sql:47-50`), więc agent nie widzi dziś żadnej oferty.
- **Ranking już zwraca `agent_id`**, celowo zostawione dla S-05 (`context/archive/2026-10-28-offer-top3-ranking/reviews/impl-review.md:58-72`, F3 Fix A). UI go nie renderuje (`src/components/owner/RankingList.astro:16`). Funkcja nie ma filtra po statusie oferty ani po zaproszeniach (`create_offers.sql:70-99`); wykluczenie odrzuconych to zakres S-06.
- **Wzorzec warstwy aplikacji jest ustalony:** natywny POST, 302 z `?error=<kod>` z allowlisty, 403 przy złej roli, rola czytana w endpoincie z `profiles` (`src/pages/api/owner/offers.ts:5-30,60-69`); serwis zawiera zod, mappery i komunikaty, ale nie robi zapytań (`src/lib/services/offers.ts`).
- **Agent nie ma jeszcze żadnej strony z danymi.** `/agent` to placeholder z tekstem „Tu pojawią się zaproszenia od właścicieli.” (`src/pages/agent/index.astro:12`), a nawigacja agenta ma 2 pozycje: Panel i Profil (`src/components/shell/nav.ts:14-15`).
- **Dane kontaktowe nie istnieją w `public`.** `profiles` nie ma e-maila ani nazwy; e-mail jest tylko w `auth.users`. Właściciel nie czyta profili agentów (jedyna polityka select to `profiles_select_own`, `supabase/migrations/20261027150939_create_profiles.sql:14-17`). Pokazanie kontaktu którejkolwiek stronie wymaga nowego mechanizmu — to decyzja produktowa (zob. Open Questions).

## Detailed Findings

### Schemat i uprawnienia (stan obecny)

- `offers`: kolumny `id`, `owner_id` (`default auth.uid()`, FK do `profiles(id) on delete cascade`), `city`, `property_type`, `transaction`, `price`, `area_m2`, `rooms`, `description`, `status text not null default 'seeking_agent'`, `created_at` (`create_offers.sql:8-19`). Triggerów na `offers` brak.
- Granty `offers`: `revoke all from anon, authenticated`; `grant select to authenticated`; `grant insert (city, property_type, transaction, price, area_m2, rooms, description)`; `grant all to service_role` (`create_offers.sql:41-45`). `status` i `owner_id` pochodzą z defaultów, więc `draft` nie jest dziś nigdy ustawiany.
- Polityki `offers`: `offers_select_own` (`:47-50`) i `offers_insert_own_owner` z inline sprawdzeniem roli przez `exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'owner')` (`:53-62`).
- `profiles`: `role text check (role in ('owner','agent'))`, pola agenta i generowana `profile_complete` (`20261028100000_add_agent_profile.sql:7-37`). Polityki: `profiles_select_own` i `profiles_update_own_agent` (`add_agent_profile.sql:44-48`).
- Konwencje migracji (obserwowane w 4 plikach): komentarz nagłówkowy, text + check zamiast enumów, jawne `revoke`/`grant` (również column-level), polityki per operacja i rola nazwane `<tabela>_<op>_<zakres>[_<rola>]`, `(select auth.uid())`, funkcje `security definer set search_path = ''` z pełną kwalifikacją `public.`, `revoke execute … from public, anon`, na końcu zakomentowany blok `-- down:`. Helperów typu `is_owner()` nie ma.

### Ranking (`rank_agents_for_offer`)

- Sygnatura `(p_offer_id uuid) returns table (agent_id uuid, score integer, experience_years integer, cities text[])`, `stable security definer set search_path = ''` (`create_offers.sql:70-99`); execute tylko dla `authenticated` (`:101-102`).
- Bramka właściciela w środku funkcji: `o.owner_id = (select auth.uid())` (`:92`); dla cudzej oferty zwraca 0 wierszy. Funkcja wywołana z innej funkcji `security definer` widzi to samo `auth.uid()`, więc nadaje się do sprawdzenia „agent jest w top 3” wewnątrz funkcji zapraszającej (wniosek z semantyki Postgresa; nie sprawdzone na bazie).
- Brak filtra `o.status` i brak wykluczeń (`:88-98`): po wysłaniu zaproszenia ranking dalej się liczy. Czy po zaproszeniu pokazywać ranking i z jakimi przyciskami — decyzja dla planu.
- Wywołanie: `src/pages/owner/offers/[id].astro:41`, mapowanie `toRankedAgent` (`src/lib/services/offers.ts:124-131`), DTO `RankedAgent { agentId, score, experienceYears, cities }` (`src/types.ts:55-60`).

### Strona oferty właściciela i miejsce na „Zaproś”

- `POST /api/owner/offers` kończy się 302 na `/owner/offers/{id}?created=1` (`src/pages/api/owner/offers.ts:69`).
- `/owner/offers/[id]`: walidacja UUID (`parseOfferId`), odczyt oferty przez RLS (404 przy braku wiersza), potem RPC rankingu; błąd RPC → `ServerError` zamiast listy (`src/pages/owner/offers/[id].astro:23-53`). Baner sukcesu `?created=1` (`:62-70`) to wzorzec dla `?invited=1`.
- `RankingList.astro` (bez stanu, `.astro`) dostaje tylko `agents`; karta `<li>` pokazuje „Agent N”, wynik `NN/100`, staż i miasta. Przycisk zaproszenia pasuje do karty jako natywny `<form method="POST">` z ukrytymi `offerId` i `agentId` — tak już działa wylogowanie w `src/components/shell/AppTopbar.astro:42-46`, bez wyspy React. Stan „wysyłanie…” wymagałby `.tsx` z `useNativeSubmitting` (`src/components/hooks/useNativeSubmitting.ts`).
- `OfferSummary.astro` nie pokazuje statusu; lista `/owner` nie selektuje `status`, a `OfferListItem` go nie ma (`src/types.ts:52`). Pokazanie statusu na liście to zakres S-04 (FR-004), na stronie oferty — potrzebne w S-05, żeby właściciel widział „zaproszenie wysłane”.
- Polskich etykiet statusów w `src/` nie ma; są tylko w PRD (`context/foundation/prd.md:36,75`). Naturalne miejsce: `src/lib/dictionaries.ts` obok etykiet miast/typów.

### Wzorzec endpointu

- `src/pages/api/owner/offers.ts:5-30`: `fail(code)` → 302 `?error=<code>`; `createClient` null → `unavailable`; brak `locals.user` → 302 `/auth/signin`; rola z `profiles` (`roleError` → `unavailable`, inna rola → `403 Forbidden`); parsowanie formularza w try/catch → `invalid_input`; błąd DB → `unknown`.
- `src/pages/api/agent/profile.ts:50-58`: update z `.select("id")` i `updated.length === 0` traktowane jako `unknown` (lekcja z agent-profile F3) — dotyczy też wywołań RPC, które mogą nic nie zrobić.
- Kody błędów i allowlista: `OFFER_ERROR_CODES = ["invalid_input","unavailable","unknown"]` + `offerErrorMessage()` (`src/lib/services/offers.ts:167-185`). Zaproszenie potrzebuje własnych kodów dla błędów biznesowych (np. oferta już ma zaproszenie, agent spoza top 3); funkcja SQL musi je zwracać rozróżnialnie (np. własny `errcode`/`raise exception` z komunikatem albo wynik wyliczeniowy).
- Przy zaproszeniu `fail` powinien wracać na `/owner/offers/{offerId}`, ale `offerId` jest znany dopiero po sparsowaniu formularza; przed parsowaniem potrzebny fallback (np. `/owner`).

### Strona agenta i nawigacja

- `route-guard.ts`: `ROLE_PREFIXES = { owner: "/owner", agent: "/agent" }`, `GATED_PATHS` obejmuje `/agent` (`src/lib/route-guard.ts:4-7`); nowe strony agenta muszą leżeć pod `/agent/*`.
- `navFor(role)` w `src/components/shell/nav.ts:12-18` zasila Sidebar, MobileNav i Dock; Dock mieści do 5 pozycji (`:21`). Nowa pozycja agenta (np. „Zaproszenia”) mieści się.
- Wzorzec strony szczegółu do skopiowania: `/owner/offers/[id].astro` (UUID → 404, odczyt przez RLS → 404). Dla agenta odczyt oferty przez RLS z nową polityką automatycznie daje 404 dla oferty bez zaproszenia (IDOR).

### RLS dla zaproszeń — pułapka rekursji

- Agent czyta ofertę dopiero po dodaniu polityki select na `offers` z `exists (select 1 from public.invitations i where i.offer_id = offers.id and i.agent_id = (select auth.uid()))`; polityki permissive sumują się z `offers_select_own`.
- Jeśli polityka właściciela na `invitations` sprawdzi własność przez `offers`, a polityka agenta na `offers` przez `invitations`, Postgres zgłosi „infinite recursion detected in policy”. Dwa wyjścia: (a) `owner_id` zdenormalizowany w `invitations` (wstawiany przez funkcję definer, więc spójny) i polityka właściciela bez dotykania `offers`; (b) helper `security definer` przerywający cykl — nowy wzorzec w repo.

### Testy i CI

- Job `smoke` stawia lokalny Supabase, uruchamia każdy `supabase/tests/*.sql` przez psql (`.github/workflows/ci.yml:43-49`) i sprawdza `npm run db:types && git diff --exit-code src/db/database.types.ts` (`:50-51`). Istniejące testy: `agent-profile.sql`, `offer-ranking.sql` (transakcja z rollback, `do $$` dla oczekiwanych błędów, użytkownicy wstawiani do `auth.users`).
- `scripts/smoke.mjs` ma sesje `request` (owner), `agent`, `otherOwner`, `anonymous`; krok rankingu (`:274-278`) zastrzega, że lokalni agenci deweloperscy mogą wyprzedzić smoke-agenta. Zaproszenie konkretnego smoke-agenta może więc trafić „poza top 3”; bezpieczniej zaprosić agenta z pozycji 1 odczytanego z HTML (ukryte `agentId`) albo dobrać ofertę, którą smoke-agent wygrywa.
- Kroki smoke pod S-05: zaproszenie → 302 `?invited=1`; drugie zaproszenie → `?error=`; agent i anonim na endpoint właściciela → 403 / signin; agent widzi listę zaproszeń i ofertę z zaproszeniem (200), a ofertę bez zaproszenia → 404; drugi właściciel nie zaprasza do cudzej oferty.

## Code References

- `supabase/migrations/20261028140000_create_offers.sql:8-19` — kolumny `offers`, `status` z defaultem `seeking_agent`
- `supabase/migrations/20261028140000_create_offers.sql:33` — `offers_status_valid` (4 statusy, w tym `invited`)
- `supabase/migrations/20261028140000_create_offers.sql:41-62` — granty i polityki `offers` (bez UPDATE)
- `supabase/migrations/20261028140000_create_offers.sql:70-102` — `rank_agents_for_offer`, bramka właściciela `:92`
- `supabase/migrations/20261027150939_create_profiles.sql:14-17` — `profiles_select_own` (jedyny select na profilach)
- `src/types.ts:14-17,52-60` — `OFFER_STATUSES`, `OfferListItem`, `RankedAgent`
- `src/lib/services/offers.ts:124-131,167-185` — `toRankedAgent`, kody błędów i komunikaty
- `src/pages/api/owner/offers.ts:5-30,60-69` — wzorzec endpointu POST
- `src/pages/api/agent/profile.ts:50-58` — 0 wierszy = `unknown`
- `src/pages/owner/offers/[id].astro:23-70` — strona oferty z rankingiem i banerem sukcesu
- `src/components/owner/RankingList.astro:16` — „S-05 may add it for invitations”
- `src/components/shell/AppTopbar.astro:42-46` — natywny formularz POST w `.astro`
- `src/components/shell/nav.ts:12-21` — nawigacja ról, limit Docka
- `src/pages/agent/index.astro:12` — placeholder zaproszeń
- `src/lib/route-guard.ts:4-7` — prefiksy ról
- `scripts/smoke.mjs:274-278` — krok rankingu i zastrzeżenie o lokalnych agentach
- `.github/workflows/ci.yml:43-51` — testy SQL i kontrola typów

## Architecture Insights

- Zapis „wrażliwy” idzie przez wąski kanał: insert przez grant kolumnowy, odczyt cudzych danych przez funkcję `security definer` z własną bramką `auth.uid()`. Zaproszenie (insert + zmiana statusu + walidacja top 3) pasuje do tego wzorca jako jedna funkcja RPC; grant `update (status)` pozwoliłby właścicielowi ustawić dowolny status, np. `in_progress`.
- S-04 (edycja oferty) doda UPDATE na `offers`; grant kolumnowy S-04 nie może obejmować `status`, a polityka update musi wymagać `status in ('draft','seeking_agent')` (PRD FR-005, `prd.md:77`). S-04 i S-05 mogą iść równolegle, więc to kontrakt między nimi.
- Projekt tabeli pod S-06/S-07: status zaproszenia (`pending`/`accepted`/`rejected`), częściowy unikalny indeks „jedno aktywne zaproszenie na ofertę” (`where status in ('pending','accepted')`) pokrywa też guardrail „najwyżej jeden przyjęty agent” (`prd.md:47`); zaproszenia odrzucone zostają w tabeli jako źródło wykluczenia z rankingu (`prd.md:112`); FK `offer_id` i `agent_id` z `on delete cascade`, żeby S-07 nie blokowało się na FK.

## Historical Context (from prior changes)

- `context/archive/2026-10-28-offer-top3-ranking/plan.md:35` — zaproszenia i wykluczenie odrzuconych odłożone do S-05/S-06 (wspierane: nadal brak tabeli).
- `context/archive/2026-10-28-offer-top3-ranking/plan-brief.md:29` — pełny zestaw statusów utworzony z góry, żeby S-04/S-05 nie zmieniały checku (wspierane: `create_offers.sql:33`).
- `context/archive/2026-10-28-offer-top3-ranking/plan-brief.md:22` i `research.md:57` — ranking bez danych osobowych; kontakt „dopiero po zaproszeniu” (częściowe: nigdzie nie ustalono, kto i czyj kontakt widzi ani jak go pobrać).
- `context/archive/2026-10-28-offer-top3-ranking/reviews/impl-review.md:58-72` (F3, Fix A) — `agent_id` zostaje w RPC dla S-05; otwarte: id czy token pozycji (rozstrzyga plan S-05). Ryzyko enumeracji przekazane do test-planu M3 (`follow-ups/review-fixes.md:5-6`).
- `context/archive/2026-10-28-agent-profile/reviews/impl-review.md:55-63` (F3) — zapis bez zwróconych wierszy traktować jako błąd.
- `context/archive/2026-10-27-app-shell/reviews/impl-review.md:45-53` (F2) — nie renderować tekstu z `?error=`; tylko kody z allowlisty.
- `context/archive/2026-10-27-role-based-signup/research.md:63` — nowe tabele nie dostają automatycznych grantów; wszystkie granty jawne.
- `context/foundation/design-system.md:104,107-108` — przycisk `accent` dla CTA, Badge, Status pill z `data-status` (success/warn/danger/info/accent) — kandydat na status oferty i zaproszenia; przy nowych kolorach obowiązuje lekcja o kontraście (`context/foundation/lessons.md`).

## Related Research

- `context/archive/2026-10-28-offer-top3-ranking/research.md`
- `context/archive/2026-10-28-agent-profile/research.md`
- `context/archive/2026-10-27-role-based-signup/research.md`

## Open Questions

Decyzje dla `/10x-plan` (żadna nie jest rozstrzygnięta w dokumentach):

1. **Ścieżka zapisu:** funkcja `security definer` `invite_agent(p_offer_id, p_agent_id)` (rekomendacja: spójna z rankingiem, atomowa, nie daje właścicielowi UPDATE na `status`) vs grant `update (status)` + polityka.
2. **Przekazanie agenta:** `agentId` w ukrytym polu + ponowne sprawdzenie top 3 w funkcji (rekomendacja; `agent_id` i tak jest w RPC) vs token pozycji.
3. **Kontakt po zaproszeniu:** czy w S-05 właściciel widzi e-mail zaproszonego agenta, a agent e-mail właściciela? PRD tego nie wymaga (FR-009/010 mówią o zaproszeniu i widoku oferty; czat to Non-Goal, `prd.md:129`). Najtaniej: bez kontaktu w S-05; ewentualny kontakt po przyjęciu w S-06 przez funkcję definer czytającą `auth.users.email`.
4. **Ranking po zaproszeniu:** ukryć przyciski „Zaproś” / zablokować je przy `status != 'seeking_agent'` i pokazać, którego agenta zaproszono (np. „Agent 2 — zaproszenie wysłane”), czy ukryć ranking.
5. **Model RLS bez rekursji:** `owner_id` zdenormalizowany w `invitations` (rekomendacja) vs helper definer.
6. **Zakres widoku agenta:** osobne `/agent/invitations` + `/agent/offers/[id]`, czy lista zaproszeń na `/agent` i szczegół oferty. W S-05 zaproszenia mają tylko status `pending`; przyjęcie/odrzucenie to S-06.
7. **Unikalność `(offer_id, agent_id)`:** czy po odrzuceniu (S-06) właściciel może ponownie zaprosić tego samego agenta — PRD mówi, że agent wypada z rankingu (`prd.md:97,112`), więc ponowne zaproszenie i tak nie jest możliwe przez UI; unikalny indeks to tylko dodatkowa gwarancja.
