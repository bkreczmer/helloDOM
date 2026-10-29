---
date: 2026-10-28T22:58:08+01:00
researcher: Claude (Opus 5.5) z bkreczmer
git_commit: dfd9f01
branch: feat/account-deletion
repository: helloDOM
topic: "S-07 account-deletion: jak usunąć konto z danymi i przywrócić oferty do seeking_agent"
tags: [research, account-deletion, supabase-auth, rls, invitations, offers, S-07]
status: complete
last_updated: 2026-10-28
last_updated_by: Claude (Opus 5.5)
---

# Research: S-07 account-deletion

**Date**: 2026-10-28T22:58:08+01:00
**Researcher**: Claude (Opus 5.5) z bkreczmer
**Git Commit**: dfd9f01 (working tree: tylko nieśledzony `context/changes/account-deletion/`)
**Branch**: feat/account-deletion
**Repository**: helloDOM

## Research Question

Z `context/foundation/roadmap.md:163-174` (S-07) i FR-012 (`context/foundation/prd.md:69`): jak w obecnym kodzie usunąć konto użytkownika razem ze wszystkimi jego danymi (NFR `prd.md:103`), tak żeby oferta agenta, który usuwa konto, wróciła do `seeking_agent` — także przy ręcznym usunięciu konta w panelu Supabase — i czy do tego potrzebny jest klucz `service_role` w Workerze (otwarte unknown, `roadmap.md:172`).

## Summary

1. **Klucz `service_role` nie jest potrzebny.** W lokalnej bazie rola `postgres` (właściciel funkcji z migracji) ma `DELETE` na `auth.users` (właściciel tabeli: `supabase_auth_admin`). Funkcja `security definer` z `delete from auth.users where id = auth.uid()`, wywołana jako `authenticated`, usunęła w transakcji z `rollback` dwóch agentów: zniknęły ich wiersze w `auth.users`, `profiles`, `invitations` i `auth.sessions` (wynik niżej). Ta ścieżka pasuje do istniejącej konwencji RPC (`invite_agent`, `respond_to_invitation`) i do decyzji „tylko anon key w Workerze” (`context/foundation/infrastructure.md:79`). Luka: uprawnienie `postgres` do `auth.users` sprawdzone tylko lokalnie, nie na produkcji.
2. **Kaskady już usuwają dane konta.** `auth.users → profiles` (`supabase/migrations/20261027150939_create_profiles.sql:6`), `profiles → offers.owner_id` (`20261028140000_create_offers.sql:10`), `profiles → invitations.agent_id/owner_id` i `offers → invitations.offer_id` (`20261028180000_create_invitations.sql:12-14`) — wszystkie `on delete cascade`. W bazie nie ma innych tabel z FK do `profiles` ani tabel aplikacji z FK do `auth.users` poza `profiles` (zapytanie do `pg_constraint`, niżej). `storage.objects` jest pusty, aplikacja nie używa Storage.
3. **Brakuje tylko przywrócenia statusu oferty.** Kaskada kasuje zaproszenie `pending`/`accepted` usuniętego agenta, a oferta zostaje w `invited`/`in_progress` — potwierdzone w teście (po usunięciu dwóch agentów: 1 oferta `invited` i 1 `in_progress` bez aktywnego zaproszenia). To jest F1 z impl-review agent-invitation.
4. **Trigger `after delete on public.invitations` rozwiązuje to dla obu ścieżek** (RPC i panel). Prototyp: gdy `old.status in ('pending','accepted')`, `update offers set status='seeking_agent' where id=old.offer_id and status in ('invited','in_progress')`. W teście po usunięciu agentów zwykłym `delete from auth.users` (jak w panelu) zostało 0 osieroconych ofert; usunięcie właściciela z 21 ofertami przeszło bez błędu (oferty i zaproszenia skasowane kaskadą, `update` trafia w 0 wierszy). Zastrzeżenie „trigger musi pominąć kaskadę usunięcia samej oferty” z F1 Fix B (`impl-review.md:58`) jest więc w tej sprawdzonej ścieżce spełnione bez dodatkowego warunku.
5. **Sesja po usunięciu**: middleware woła `supabase.auth.getUser()` (`src/middleware.ts:11-13`), czyli serwer Auth, więc usunięty użytkownik dostaje `user = null` i redirect na `/auth/signin` na ścieżkach chronionych. Ciasteczka trzeba jednak wyczyścić w endpoincie (`signOut`) — wniosek, nie sprawdzony runtime'owo.
6. **UI**: nie ma strony konta/ustawień dla żadnej roli; właściciel nie ma strony profilu. Formularz wylogowania jest w `src/components/shell/AppTopbar.astro:42-46`.

## Detailed Findings

### Baza: kaskady i uprawnienia (sprawdzone lokalnie, `docker exec supabase_db_10x-astro-starter psql`)

- `role_table_grants` dla `auth.users`: `postgres` ma `DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE`; `authenticated` i `service_role` nie mają wpisów w tym zapytaniu; `tableowner = supabase_auth_admin`.
- FK do `auth.users` lub `public.profiles` (pełny wynik zapytania, 14 wierszy): tabele `auth.*` (identities, sessions, mfa_factors, one_time_tokens, oauth_*, webauthn_*, mfa_recovery_code_sets — `cascade`; `scim_users` — `no action`), `profiles → auth.users` (cascade), `offers.owner_id → profiles` (cascade), `invitations.agent_id`, `invitations.owner_id → profiles` (cascade). `auth.refresh_tokens` kaskaduje przez `auth.sessions` (`refresh_tokens_session_id_fkey`).
- Jedyny trigger nie-wewnętrzny na `auth.users`/`profiles`/`offers`/`invitations`: `on_auth_user_created` (`20261027150939_create_profiles.sql:40-43`).
- Stan lokalny przed testem: 12 par `pending/invited`, 7 `accepted/in_progress`, 7 `rejected/seeking_agent`; 0 ofert `invited`/`in_progress` bez aktywnego zaproszenia; 118 kont w `auth.users`.

**Test 1 (rollback)** — tymczasowa funkcja `security definer` `delete from auth.users where id = (select auth.uid())`, `grant execute to authenticated`, wywołana po `set local role authenticated` i `request.jwt.claims.sub` = agent z `accepted`, potem agent z `pending`:

| Po usunięciu dwóch agentów | Wynik |
| --- | --- |
| wiersze w `auth.users` | 0 |
| wiersze w `profiles` | 0 |
| wiersze w `invitations` (`agent_id`) | 0 |
| wiersze w `auth.sessions` | 0 |
| oferty `in_progress` bez aktywnego zaproszenia | 1 |
| oferty `invited` bez aktywnego zaproszenia | 1 |

**Test 2 (rollback)** — prototyp triggera `after delete on public.invitations for each row` (opis w Summary pkt 4), potem `delete from auth.users` jako `postgres` (jak panel):

| Krok | Wynik |
| --- | --- |
| usunięcie 2 agentów (accepted + pending) | 0 ofert `invited`/`in_progress` bez aktywnego zaproszenia |
| usunięcie właściciela z ofertą `in_progress` | bez błędu; ofert właściciela 21 → 0, zaproszeń z jego `owner_id` → 0 |

Nie sprawdzono: zachowania triggera przy przyszłym usuwaniu oferty przez właściciela (S-04, `delete` na `offers` dziś niedozwolony: `20261028140000_create_offers.sql:6`), choć ta ścieżka to ta sama kaskada `offers → invitations` co w teście właściciela.

### Uprawnienia na produkcji (luka)

- Lokalny stack to Postgres 17.11. Czy produkcyjny `postgres` ma `DELETE` na `auth.users`, nie sprawdzono. Sprawdzenie przed planem/implementacją, w SQL Editorze projektu: `select has_table_privilege('postgres', 'auth.users', 'DELETE');`. Jeśli `false`, zostaje wariant z `service_role` (Admin API `auth.admin.deleteUser`), który wymaga decyzji z `roadmap.md:172`.

### Klient Supabase i sekrety

- Jedyna fabryka klienta: `src/lib/supabase.ts:6-22` (`createServerClient` z `SUPABASE_URL`, `SUPABASE_KEY` z `astro:env/server`); schemat env w `astro.config.mjs:17-23` (`SUPABASE_URL`, `SUPABASE_KEY`, `SITE_URL`).
- Grep `service_role|SERVICE_ROLE|auth.admin|deleteUser|secret_key|SUPABASE_SECRET` w `src/`, `scripts/`, `.github/`, `.env.example`, `wrangler.jsonc`, `supabase/`, `astro.config.mjs`, `CLAUDE.md`, `AGENTS.md`: brak klienta admina; trafienia to tylko `grant all ... to service_role` w migracjach i zakomentowane `secret_key` w `supabase/config.toml`.
- CI smoke wyciąga z `supabase status` tylko `API_URL` i `ANON_KEY` (`.github/workflows/ci.yml:39-42, 52-56`); deploy dostaje tylko `CLOUDFLARE_*` (`ci.yml:81-84`).

### Wzorzec endpointu i RPC

- Kanoniczny endpoint: `src/pages/api/owner/invitations.ts:6-66` — `formData()` w try/catch, `fail(code)` → `?error=<code>`, brak klienta → `unavailable`, brak `locals.user` → `/auth/signin`, rola z `profiles` (`unavailable`/403), zod (`invalid_input`), `rpc()` + guard wyniku (`unknown`), `switch` na kodzie.
- Serwis: `src/lib/services/invitations.ts` — schemat zod (`:11-23`), `INVITE_RESULTS` + `isInviteResult` (`:25-32`), kody błędów i polskie komunikaty (`:34-60`).
- RPC: `security definer`, `set search_path = ''`, `revoke execute ... from public, anon; grant execute ... to authenticated`, kody wyników zamiast wyjątków, blok `-- down:` (`20261028200000_invitation_response.sql:75-125`).
- Wylogowanie: `src/pages/api/auth/signout.ts:4-10` — `supabase.auth.signOut()` i 302 na `/`; ciasteczka czyści `setAll` z `src/lib/supabase.ts:15-19`.
- Wniosek (niesprawdzony): po usunięciu `auth.users` domyślny `signOut()` (scope `global`) woła endpoint `/logout` dla już nieistniejącego użytkownika; czy `@supabase/ssr` mimo błędu czyści ciasteczka, trzeba sprawdzić w implementacji (bezpieczniej `signOut({ scope: "local" })`).

### Middleware i komunikaty

- `src/middleware.ts:11-17` — `getUser()` przy każdym żądaniu; `:39-42` — brak profilu → `signOut()` + `?error=no_profile`.
- Komunikaty po redirect: flagi `?created=1`, `?invited=1` itd. czytane z `Astro.url.searchParams` (np. `src/pages/owner/offers/[id].astro:91-116`), błędy przez `src/components/auth/ServerError.tsx:7-18`, kody auth w `src/lib/services/auth-errors.ts:1-31`. Brak systemu toastów.

### Miejsce w UI

- Strony: owner — `src/pages/owner/index.astro`, `owner/offers/new.astro`, `owner/offers/[id].astro`; agent — `agent/index.astro`, `agent/profile.astro`, `agent/offers/[id].astro`. Brak strony konta/ustawień.
- `src/lib/route-guard.ts:4,7` — prefiksy `/owner`, `/agent`; `GATED_PATHS = ["/dashboard", "/owner", "/agent"]`. CLAUDE.md: nowa strona w powłoce musi być pod `/owner/*` albo `/agent/*`.
- Nawigacja: `src/components/shell/nav.ts:12-18` (agent: Panel + Profil; owner: Panel + Nowa oferta), `DOCK_MAX_ITEMS = 5` (`:21`).
- Wariant przycisku `destructive` na `--rs-danger` zarezerwowany dla „Usuń konto” (`context/archive/2026-10-27-app-shell/reviews/plan-review.md:77`).

### Testy

- SQL: `supabase/tests/{agent-invitation,agent-profile,invitation-response,offer-ranking}.sql`, uruchamiane w CI przez psql jako `postgres` (`ci.yml:43-49`); jedna transakcja z rollback, użytkownicy wstawiani do `auth.users`, prefiksy UUID per test (`0003`/`0004` agent-invitation, `0006` invitation-response — wg `context/archive/2026-10-28-invitation-response/plan.md:93`).
- Smoke: `scripts/smoke.mjs` zakłada 3 konta na przebieg (`:7-10, :125, :203, :311`) i ich nie usuwa (komentarz `:47-49`). Usuwanie konta w smoke może posprzątać po sobie.

## Code References

- `supabase/migrations/20261027150939_create_profiles.sql:6` — `profiles.id → auth.users on delete cascade`
- `supabase/migrations/20261028140000_create_offers.sql:6,10,41-45` — brak delete grantu; `owner_id → profiles cascade`; granty
- `supabase/migrations/20261028180000_create_invitations.sql:12-14,23-24` — trzy kaskady; indeks jednego aktywnego zaproszenia
- `supabase/migrations/20261028200000_invitation_response.sql:75-125` — wzorzec RPC z kodami wyników
- `src/middleware.ts:11-17,39-42` — `getUser()`, obsługa braku profilu
- `src/lib/supabase.ts:6-22` — jedyny klient (anon key)
- `src/pages/api/owner/invitations.ts:6-66` — wzorzec endpointu
- `src/pages/api/auth/signout.ts:4-10` — wylogowanie
- `src/components/shell/AppTopbar.astro:42-46` — formularz wylogowania w powłoce
- `src/lib/route-guard.ts:4,7` — prefiksy chronione
- `scripts/smoke.mjs:47-49` — smoke nie sprząta kont

## Architecture Insights

- Wszystkie zapisy domenowe idą przez funkcje `security definer` z kodami wyników; `authenticated` nie ma `insert/update/delete` na `invitations` i `profiles` (poza kolumnowym `update` agenta). RPC `delete_own_account()` (nazwa robocza) wpisuje się w ten wzorzec bez nowego sekretu.
- Reguła „oferta wraca do `seeking_agent`, gdy znika jej aktywne zaproszenie” jest niezmiennikiem danych, nie akcją użytkownika — trigger na `invitations` trzyma ją niezależnie od ścieżki usunięcia (RPC, panel, przyszłe S-04), czego wymaga `roadmap.md:173`.
- Kolejność w RPC nie ma znaczenia dla poprawności (trigger działa w tej samej transakcji), ale przy współbieżnym `invite_agent`/`respond_to_invitation` blokady wierszy `offers` mogą się przeplatać — w testach nie sprawdzano współbieżności.

## Historical Context (from prior changes)

- `context/archive/2026-10-28-agent-invitation/reviews/impl-review.md:43-60` — F1: usunięcie agenta zostawia ofertę w `invited`; wybrano Fix A (wymóg dopisany do S-07), Fix B (trigger) odrzucony wtedy z powodu kosztu migracji; zastrzeżenie o kaskadzie usunięcia oferty (`:58`) — w teście bez skutku.
- `context/archive/2026-10-28-invitation-response/plan-brief.md:40,63` — sprzątanie po usunięciu konta to S-07; po usunięciu agenta jego odrzucone zaproszenia znikają kaskadą (bez znaczenia, bo agenta już nie ma).
- `context/archive/2026-10-27-role-based-signup/plan.md:49,52` — usuwanie konta odłożone do osobnego slice'a, tylko `on delete cascade`; konta testowe usuwa ręcznie użytkownik.
- `context/archive/2026-10-28-offer-top3-ranking/research.md:56` — `service_role` w Workerze nieakceptowany dla rankingu; dodatkowy sekret to osobna decyzja S-07.
- `context/foundation/infrastructure.md:79,83` — Worker tylko z anon key; każde usuwanie danych na produkcji zatwierdza człowiek.
- `context/foundation/roadmap.md:51,132-141` — S-04 (edycja/usuwanie ofert) `proposed`, może iść równolegle.

## Related Research

- `context/archive/2026-10-28-agent-invitation/research.md`
- `context/archive/2026-10-28-invitation-response/` (plan, plan-brief, reviews)

## Open Questions (do decyzji w `/10x-plan`)

1. **Mechanizm usunięcia**: RPC `security definer` usuwające z `auth.users` (bez nowego sekretu; rekomendowane) vs Admin API z `service_role` jako sekretem Workera. Warunek rekomendacji: `has_table_privilege('postgres','auth.users','DELETE')` = `true` na produkcji.
2. **Przywrócenie oferty**: trigger na `invitations` (obejmuje też panel — wymóg `roadmap.md:173`) vs `update` w samym RPC (nie obejmuje panelu).
3. **Potwierdzenie w UI**: inline „Tak, usuń konto” jak w invitation-response, czy dodatkowo wpisanie hasła/e-maila.
4. **Miejsce przycisku**: osobne strony `/owner/account` i `/agent/account`, sekcja na `/agent/profile` + nowa strona dla właściciela, czy formularz w topbarze.
5. **Osierocone oferty na produkcji** z wcześniejszych ręcznych usunięć (blind spot F1): jednorazowy `update` w migracji czy tylko sprawdzenie zapytaniem.
