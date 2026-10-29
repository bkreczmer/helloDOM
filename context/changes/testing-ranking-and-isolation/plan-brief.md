# Testy rankingu top 3 i izolacji danych — Plan Brief

> Full plan: `context/changes/testing-ranking-and-isolation/plan.md`
> Research: `context/changes/testing-ranking-and-isolation/research.md`

## What & Why

Etap 1 planu testów. Projekt nie ma jeszcze runnera, a dwie najgroźniejsze awarie nie mają testu z perspektywy użytkownika. Pierwsza to zły top 3 dla właściciela (ryzyko #1). Druga to dostęp B do danych A przez REST albo RPC Supabase (ryzyko #2). Trzeba też dowieść, że nowe testy łapią regresję, a nie świecą na zielono mimo błędu (ryzyko #6).

## Starting Point

Ranking liczy jedna funkcja SQL `rank_agents_for_offer`. Izolację trzymają RLS i RPC z bramką `auth.uid()`. Testy SQL podszywają się pod użytkownika (`set local role`), a smoke sprawdza tylko `/api/*`. Nikt nie wysyła prawdziwego JWT drugiego użytkownika do PostgREST.

## Desired End State

`npm run test:integration` (lokalnie i w CI) zakłada prawdziwe konta na lokalnym Supabase. Sprawdza 8 przypadków rankingu z wyrocznią policzoną z PRD i 16 ścieżek dostępu B → A z kontrolą pozytywną. Potem usuwa konta. Cztery celowe zepsucia dają czerwony test. Cookbook w `test-plan.md` opisuje, jak dodać kolejny taki test.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| Runner | Vitest 5.0.5, `environment: node`, bez configu Astro | Pasuje do vite 8 / Node 24, testy wołają tylko supabase-js | Research |
| Sesje | `signUp` z kluczem anon, nigdy `service_role`; sprzątanie przez `delete_own_account` | Test idzie przez tę samą bramkę RLS co aplikacja | Research |
| Remis „wcześniejsza rejestracja” | Sekwencyjna rejestracja prawdziwych kont zamiast ręcznego `created_at` | `created_at` jest naturalnie rosnące i niezmienialne | Research |
| Granice ceny | Włącznie (`price_min`/`price_max` dają +35), dopisek w PRD | Zgodne z kodem i potocznym „od–do”; teraz to reguła produktu | Plan |
| Czystość bazy | Strażnik: oferta-sonda w `opole`/`krakow`/`torun` musi dać pusty ranking | Pozwala sprawdzić niskie wyniki i wynik 0; brudna baza → czytelny błąd | Plan |
| Zakres `/api/*` | Tylko REST/RPC; `/api/*` z cudzym id pokrywa smoke | Bez serwera w teście, ta sama bramka RLS | Plan |
| Limit auth | `sign_in_sign_ups` 30 → 100 w `config.toml` (lokalnie i CI) | ~13 kont + smoke + powtórki break-checku przekraczają 30 / 5 min | Plan |
| Break-check RLS | Dodanie polityki `using (true)` zamiast `drop policy` | `drop` zaostrza dostęp, więc nie zapaliłby testu IDOR | Plan (korekta researchu) |
| Ochrona produkcji | Helper odmawia startu, gdy host to nie localhost | Testy zakładają konta | Plan |

## Scope

**In scope:**
- `vitest.config.ts`, `tests/integration/{helpers,ranking,isolation}.test.ts`, skrypt `test:integration`
- Limit auth w `supabase/config.toml`, dopisek w PRD o granicach ceny
- Krok w CI (job `smoke`), break-check BC1–BC4, §4/§6 w `test-plan.md`

**Out of scope:**
- `/api/*` przez HTTP, komunikat „mniej niż 3” w UI (etap 2 E2E)
- Tie-break `agent_id`, ryzyka #3–#5, zmiany schematu i kodu aplikacji, commitowany skrypt break-check

## Architecture / Approach

Każdy użytkownik testu to osobny klient supabase-js z kluczem anon i własnym JWT. Plik rankingu rejestruje właściciela i pulę 8 agentów (A1–A8). Właściciel zakłada 8 ofert (R1–R8), a test porównuje wynik RPC z tabelą oczekiwanych `agent_id` i `score`. Plik izolacji ma właścicieli A i B, zaproszonego agenta G, niezaproszonego H i anon. Każdy wiersz I1–I16 to zapytanie krzyżowe z kontrolą, że A wciąż widzi swoje dane.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Runner i test rankingu | Vitest, helpery, R1–R8 zielone, limit auth, dopisek PRD | Pozostałości w lokalnej bazie (łagodzi strażnik); restart lokalnego Supabase |
| 2. Test izolacji | I1–I16 zielone z kontrolami pozytywnymi | „Pusta lista = brak dostępu” bez kontroli pozytywnej (łagodzi I1–I4) |
| 3. CI, break-check, docs | Krok CI, BC1–BC4 czerwone → zielone, cookbook | Przywrócenie funkcji po zepsuciu (definicja z migracji) |

**Prerequisites:** lokalny Supabase uruchomiony, puste miasta `opole`, `krakow`, `torun` (stan na 2026-10-29: tak); jednorazowy restart Supabase po zmianie limitu.
**Estimated effort:** ~1 sesja, 3 fazy = 3 commity, potem PR.

## Open Risks & Assumptions

- Nieudany smoke lokalnie zostawia agenta ze wszystkimi miastami. Strażnik zatrzyma wtedy test, a naprawa to `npx supabase db reset`, które kasuje lokalne konta.
- Zakładamy, że `loadEnv` z vite poprawnie łączy `.env` z env procesu w CI. Kryterium 1.5 i krok CI to zweryfikują.

## Success Criteria (Summary)

- Właściciel dostaje dokładnie top 3 z tabeli PRD, także po odrzuceniu i na granicach ceny. Agent z wynikiem 0, spoza miasta albo z niepełnym profilem się nie pojawia.
- Użytkownik B dostaje odmowę albo pustkę na każdej ścieżce REST/RPC do zasobów A, a A widzi swoje dane.
- Każde z czterech celowych zepsuć zapala test na czerwono. CI uruchamia testy przy każdym PR.
