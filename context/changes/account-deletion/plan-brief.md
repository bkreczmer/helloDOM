# Account deletion (S-07) — Plan Brief

> Full plan: `context/changes/account-deletion/plan.md`
> Research: `context/changes/account-deletion/research.md`

## What & Why

Użytkownik usuwa konto razem ze wszystkimi swoimi danymi (FR-012, NFR „po usunięciu konta nie zostają żadne dane”). Gdy usuwa je agent z przyjętą albo oczekującą ofertą, oferta wraca do „Szuka agenta”. Dziś kaskada kasuje zaproszenie, ale oferta zostaje w `invited`/`in_progress` bez wyjścia (F1 z impl-review agent-invitation), także po ręcznym usunięciu konta w panelu Supabase.

## Starting Point

Kaskady `on delete cascade` już usuwają profil, oferty i zaproszenia konta. Brakuje przywrócenia statusu oferty, sposobu na samodzielne usunięcie konta w aplikacji (Worker ma tylko anon key) i strony konta dla obu ról.

## Desired End State

W nawigacji obu ról jest „Konto”. Na tej stronie przycisk „Usuń konto” z potwierdzeniem inline usuwa konto i dane, czyści sesję i prowadzi na `/` z komunikatem. Każda oferta, której aktywne zaproszenie znika z dowolnego powodu, wraca do `seeking_agent`, a na produkcji nie zostaje żadna osierocona oferta.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Mechanizm usunięcia | RPC `delete_own_account()` `security definer` usuwa `auth.users where id = auth.uid()` | Bez sekretu `service_role` w Workerze, ten sam wzorzec co pozostałe RPC; sprawdzone lokalnie | Research / Plan |
| Przywrócenie oferty | Trigger `after delete on invitations` (`pending`/`accepted` → oferta `seeking_agent`) | Jedyna opcja, która obejmuje panel Supabase i przyszłe S-04 | Research |
| Osierocone oferty na produkcji | Jednorazowy idempotentny `update` w tej samej migracji | Deterministyczne, widoczne w `db push --dry-run`, bez ręcznego kroku | Plan |
| Miejsce w UI | Strony `/owner/account` i `/agent/account`, pozycja „Konto” w nawigacji | Symetrycznie dla ról, zgodnie z regułą prefiksów | Plan |
| Potwierdzenie | Inline „Tak, usuń konto” / „Anuluj” (wzorzec `InvitationResponse`) | Gotowy wzorzec fokusu i wysyłania, najmniej pracy przed terminem | Plan |
| Sesja po usunięciu | `signOut({ scope: "local" })` po RPC, redirect `/?deleted=1` | Nie woła serwera Auth dla nieistniejącego użytkownika, czyści ciasteczka | Research / Plan |

## Scope

**In scope:**
- Migracja: trigger, naprawa osieroconych ofert, RPC z grantami i `-- down:`
- Test SQL `supabase/tests/account-deletion.sql`, typy bazy
- Serwis `account.ts`, endpoint `POST /api/account/delete`, komponent `DeleteAccount.tsx`
- Strony konta obu ról, pozycja w nawigacji, komunikat na `/`
- Kroki usunięcia konta w smoke (i sprzątanie kont smoke'a), wdrożenie migracji i sprawdzenie na produkcji

**Out of scope:**
- `service_role` / Admin API, potwierdzenie hasłem lub e-mailem
- Karencja, miękkie usuwanie, przywracanie konta, powiadomienia
- Usuwanie ofert przez właściciela (S-04), inne ustawienia konta, testy współbieżności

## Architecture / Approach

Niezmiennik danych jest w bazie: trigger na `invitations` działa niezależnie od tego, kto usuwa (RPC, panel, kaskada oferty). Endpoint woła RPC kluczem anon, czyści sesję i przekierowuje. Strony konta są cienkie i używają wspólnego komponentu `.tsx` z potwierdzeniem.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Baza – trigger, naprawa, RPC | F1 zamknięte dla każdej ścieżki, RPC usunięcia, test SQL | Brak `DELETE` na `auth.users` dla produkcyjnego `postgres` |
| 2. Endpoint i UI | Usunięcie konta z aplikacji dla obu ról | Ciasteczka po usunięciu (`signOut` lokalny) |
| 3. Smoke i produkcja | Test ścieżki użytkownika, migracja na produkcji, weryfikacja | Limit ~2 maili/h przy zakładaniu kont testowych na produkcji |

**Prerequisites:** na produkcji `select has_table_privilege('postgres', 'auth.users', 'DELETE');` = `true` (SQL Editor, przed fazą 1).
**Estimated effort:** ~1–2 sesje, 3 fazy (3 commity).

## Open Risks & Assumptions

- Uprawnienie produkcyjne niesprawdzone. Przy `false` wracamy do decyzji o Admin API z `service_role`.
- Jednorazowa naprawa zmienia dane produkcyjne i `-- down:` jej nie cofa (idempotentna, dotyczy tylko ofert błędnych według niezmiennika).
- Współbieżność usunięcia konta z `invite_agent`/`respond_to_invitation` nie jest testowana.

## Success Criteria (Summary)

- Agent usuwa konto, a właściciel widzi swoją ofertę jako „Szuka agenta” i może zaprosić kogoś innego.
- Usuniętym kontem nie da się zalogować, a w bazie nie zostaje żaden wiersz tego konta.
- Na produkcji zapytanie o osierocone oferty zwraca 0.
