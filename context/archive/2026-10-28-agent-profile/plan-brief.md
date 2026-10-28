# Profil agenta i wspólny słownik — Plan Brief

> Full plan: `context/changes/agent-profile/plan.md`
> Research: `context/changes/agent-profile/research.md`

## What & Why

Agent uzupełnia profil (miasta, typy nieruchomości, przedział cen, lata doświadczenia), bo bez profili ranking S-03 nie ma czego liczyć (PRD FR-007). Zmiana wprowadza też wspólny słownik 18 miast wojewódzkich i 3 typów, z którego skorzystają formularz oferty i ranking.

## Starting Point

Jest tabela `profiles (id, role, created_at)` z RLS „czytaj swój” i bez prawa edycji; wiersz agenta powstaje przy rejestracji. Panel agenta to jedna karta powitalna, nawigacja ma tylko „Panel”, słownika nie ma.

## Desired End State

Agent wchodzi w „Profil”, zaznacza miasta i typy, wpisuje cenę min/max i lata, zapisuje. Może zapisać profil niepełny; strona mówi wtedy, czego brakuje do rankingu. Baza trzyma `profile_complete`, który S-03 użyje do filtrowania agentów.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Przedział cen | Jeden, niezależny od transakcji | Zgodnie z regułą wyniku w PRD; osobne przedziały w Parked | Research (user) |
| Pełny profil | ≥1 miasto, ≥1 typ, obie ceny z 0 ≤ min ≤ max, lata podane (0 się liczy) | Jednoznaczny warunek dla rankingu | Research (user) |
| Jednostki | PLN całkowite, granice włączne, lata całkowite 0–60 | Proste porównanie w S-03 | Research (user) |
| Miasta | 18 miast wojewódzkich (lista potwierdzona) | Decyzja roadmapy 2026-10-27 | Research (user) |
| Miejsce danych | Kolumny w `profiles` + grant `update` tylko na 5 kolumn | Wiersz istnieje od rejestracji; `role` zostaje niezmienna | Plan |
| Słownik w bazie | ASCII-slugi w `text[]` + `check`; etykiety PL w TS | Wzorzec `ROLES`, bez joinów | Plan |
| Odczyt dla rankingu | Zostaje w S-03 | Dostęp do cudzych danych powstaje z jedynym konsumentem | Plan |
| Zapis niepełnego profilu | Dozwolony, z listą braków | PRD przewiduje niepełne profile; agent nie traci danych | Plan |

## Scope

**In scope:**
- `src/lib/dictionaries.ts` (miasta, typy, etykiety) i typy `City`, `PropertyType`, `AgentProfile`
- migracja: kolumny, ograniczenia, `profile_complete`, grant kolumnowy, polityka `update`
- skrypt SQL `supabase/tests/agent-profile.sql` (ograniczenia, RLS)
- `POST /api/agent/profile` + serwis walidacji
- strona `/agent/profile`, formularz z kafelkami, pozycja „Profil” w nawigacji
- kroki smoke

**Out of scope:**
- odczyt profili przez właścicieli, ranking, formularz oferty (S-03)
- osobne przedziały cen sprzedaż/najem (Parked)
- dodatkowe pola profilu (opis, telefon, zdjęcie)

## Architecture / Approach

Formularz (wyspa React) wysyła natywny `POST` na `/api/agent/profile`. Endpoint sprawdza sesję i rolę, waliduje zod-em ze słownika i robi `update` własnego wiersza `profiles`. RLS i grant kolumnowy pilnują, że agent zmienia tylko swoje 5 kolumn. Baza wymusza słownik i zakresy przez `check` i liczy `profile_complete`. Strona czyta wiersz i pokazuje stan kompletności. Smoke zapisuje pełną listę slugów, więc rozjazd listy w TS i SQL wychodzi w CI.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Słownik i schemat bazy | Słownik TS, migracja, typy DB, skrypt SQL z asercjami | Lista slugów w TS i SQL się rozjedzie |
| 2. Zapis profilu | Serwis walidacji, endpoint, kroki smoke | `formData.getAll` / puste pola liczbowe źle sparsowane |
| 3. Strona profilu i nawigacja | `/agent/profile`, kafelki, status kompletności, „Profil” w nav | 18 kafelków przy 360 px; stany UI i kontrast |

**Prerequisites:** S-01 (done); lokalny Supabase (`npx supabase start`); `psql` lub Docker do skryptu SQL.
**Estimated effort:** ~2 sesje w 3 fazach.

## Open Risks & Assumptions

- Lista slugów istnieje w 3 miejscach (TS, `check`, smoke); zabezpiecza ją krok smoke z pełną listą, nie mechanizm.
- `integer` ogranicza cenę do ~2,1 mld PLN — przyjęte jako wystarczające.
- Podświetlanie „Panel” w nawigacji wymaga zmiany `isActive` dla pozycji domowej; dotyczy też panelu właściciela, gdy dostanie podstrony.

## Success Criteria (Summary)

- Agent zapisuje profil i po odświeżeniu widzi swoje wartości oraz stan „pełny/niepełny” z listą braków.
- `profiles.profile_complete` odpowiada definicji pełnego profilu; skrypt SQL i smoke przechodzą.
- Agent nie może zmienić cudzego profilu ani roli; właściciel nie może zapisać pól agenta.
