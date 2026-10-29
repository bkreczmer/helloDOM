# Test E2E ścieżki krytycznej (rollout Phase 2) — Plan Brief

> Full plan: `context/changes/testing-critical-path-e2e/plan.md`
> Research: `context/changes/testing-critical-path-e2e/research.md`

## What & Why

Jeden test Playwright (Chromium) przechodzi ścieżkę właściciel → oferta → top 3 → zaproszenie → odrzucenie → ponowne zaproszenie → przyjęcie. Pokrywa ryzyka #1 (zły top 3 / kolejność), #2 (IDOR przez UI) i #3 (cykl statusów) z `test-plan.md`. Phase 1 sprawdziła ranking i RLS na poziomie SQL/PostgREST. Nic nie sprawdza jednak styku: pozycji w HTML i `agentId` za przyciskiem, klienta Supabase na stronie SSR ani stanu bazy po natywnych formularzach z odpowiedzią 302.

## Starting Point

W repo nie ma jeszcze Playwrighta. Smoke sprawdza w HTML tylko „Agent 1 / 100/100” dla jednego agenta. Ranking liczy jedno RPC, strony polegają na RLS, a akcje to formularze z 302 i `?error=`. Job `smoke` w CI ma lokalny Supabase i zbudowaną aplikację.

## Desired End State

`npm run test:e2e` uruchamia seed i `critical-path.spec.ts`: dwa `test()` na wspólnym seedzie 10 kont. Wyrocznia top 3 jest policzona ręcznie z PRD, izolacja sprawdzona z kontrolami pozytywnymi, a stan bazy odczytany sesją właściciela po każdej akcji. Job `smoke` uruchamia E2E na każdym PR i przy porażce wgrywa raport z trace. Test-plan, `CLAUDE.md` i `README.md` opisują warstwę E2E.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Zakres ścieżki | Z odrzuceniem przez P przed zaproszeniem T1 | Jedno konto więcej pokrywa FR-011 w UI, wykluczenie odrzuconego (#1) i powrót do `seeking_agent` (#3) | Plan |
| Filtr wyniku 0 i „mniej niż 3” | Osobny `test()` w tym samym pliku (oferta Zielona Góra) | Czytelna porażka bez duplikowania kont; komunikat był jawnie odłożony do Phase 2 | Plan |
| Infrastruktura | Faza 1 przez `/10x-e2e-setup` | Zgodne z test-plan; skill daje config, seed i `test-stack.md` | Plan |
| Wyrocznia | Stałe z PRD: P 100, T1 85, T2 85 (remis po rejestracji), F 65; I, O nigdy | Wyrocznia z PRD, nie z kodu; remis faktycznie zachodzi w danych | Research |
| Tożsamość agenta | Ukryte `input[name=agentId]` vs `user.id` z rejestracji | Ranking jest celowo anonimowy; nie dodajemy danych osobowych do UI | Research |
| Odczyt stanu | supabase-js, klucz anon, sesja właściciela | Zgodne z RLS i §6.2; bez `service_role` i psql | Research |
| Seeding | Konta i profile przez HTTP API z `Origin`; oferta w UI | Wzorzec smoke; tworzenie oferty to część ścieżki | Research |
| Miejsce w CI | Job `smoke`, krok przed smoke | `webServer` musi być jedynym procesem na 4321 | Plan |

## Scope

**In scope:**
- `@playwright/test`, config, seed, `test-stack.md` (faza 1)
- `tests/e2e/critical-path.spec.ts` i helpery, celowe uszkodzenia (faza 2)
- Krok E2E i cache Chromium w `ci.yml`; aktualizacja test-plan, CLAUDE.md i README (faza 3)

**Out of scope:**
- Tabela przypadków brzegowych rankingu (zostaje w Phase 1)
- Wyścig dwóch przyjęć, usunięcie konta w ścieżce
- Przeglądarki inne niż Chromium, testy na produkcji
- `data-testid` i zmiany kodu produkcyjnego, schematu i RLS

## Architecture / Approach

Osobny `browser.newContext()` na każdego użytkownika. Rejestracja przez `context.request.post` daje ciasteczka sesji w tym kontekście. Spec biegnie w `describe.serial`: `beforeAll` zakłada konta sekwencyjnie po sondzie pustych miast (`lublin`, `rzeszow`, `zielona-gora`), a `afterAll` usuwa je przez `/api/account/delete`. Każda akcja w UI kończy się asercją UI i odczytem bazy (`offers.status`, liczba `accepted`, niezmieniona cena po próbie edycji).

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Infrastruktura Playwright (`/10x-e2e-setup`) | Zależność, config, Chromium, zielony seed, `test-stack.md` | Skill wybierze seed kolidujący z miastami E2E albo zostawi serwer na 4321 |
| 2. Test ścieżki krytycznej (`/10x-e2e`) | `critical-path.spec.ts` (2 testy) + 5 celowych uszkodzeń | Flakiness na hydratacji wysp React; limit 100 rejestracji/5 min przy powtórkach |
| 3. CI i dokumentacja (`/10x-implement`) | Krok E2E w jobie `smoke`, artefakt raportu, docs | Konflikt portu z preview smoke; czas instalacji Chromium |

**Prerequisites:** lokalny Supabase (`npx supabase start`), wolny port 4321 przy uruchamianiu testów, gałąź `test/testing-critical-path-e2e`.
**Estimated effort:** ~3 sesje, po jednej na fazę; najdłuższa faza 2.

## Open Risks & Assumptions

- Zakładamy, że POST z `APIRequestContext` bez `Origin` dostałby 403 (domyślne `checkOrigin`). Wysyłamy nagłówek zawsze, więc wynik nie zależy od tego założenia.
- Sonda pustych miast nie widzi agenta z wynikiem 0. Pozostałość może dać fałszywą czerwień, nigdy fałszywą zieleń.
- Podwójny build w CI (smoke + `webServer`) wydłuża job. Akceptowalne, opcjonalnie do optymalizacji w fazie 3.
- Uszkodzenie #1 „filtr 0” może wymagać `npx supabase db reset`, co kasuje lokalne konta; trzeba uprzedzić użytkownika.

## Success Criteria (Summary)

- Właściciel w przeglądarce widzi dokładnie oczekiwanych agentów w kolejności z PRD, a test czerwienieje przy odwróceniu kolejności, złym `agentId` i wycieku agenta z wynikiem 0.
- Drugi właściciel i niezaproszony agent dostają 404 bez danych oferty, a test czerwienieje przy wyłączonej polityce RLS.
- Po odrzuceniu i przyjęciu baza ma status zgodny z PRD i dokładnie jednego przyjętego agenta; job `smoke` na PR jest zielony.
