# Oferta i ranking top 3 — Plan Brief

> Full plan: `context/changes/offer-top3-ranking/plan.md`
> Research: `context/changes/offer-top3-ranking/research.md`

## What & Why

Właściciel dodaje ofertę i od razu widzi do 3 najlepiej dopasowanych agentów z wynikiem 0–100 (US-01, FR-003, FR-008). To gwiazda przewodnia MVP: błąd w regule wyniku podważa cały produkt, więc reguła ma jedno źródło prawdy i własny test.

## Starting Point

Profile agentów z polami dopasowania i `profile_complete` istnieją (S-02). Nie ma tabeli ofert, a RLS nie pozwala właścicielowi czytać profili agentów. `/owner` to placeholder.

## Desired End State

Na `/owner` właściciel ma przycisk „Dodaj ofertę” i listę swoich ofert. Po zapisie formularza trafia na `/owner/offers/<id>`, gdzie widzi do 3 anonimowych agentów („Agent 1/2/3”, wynik, staż, miasta) albo komunikat, gdy dopasowanych jest mniej niż 3. Cudza oferta daje 404.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Dane agenta w rankingu | Bez danych osobowych: wynik, staż, miasta | Kontakt dopiero po zaproszeniu; brak zmian w profilu S-02 | Plan (użytkownik) |
| Status po zapisie | Od razu `seeking_agent` | Najkrótsza droga do rankingu; `draft` zostaje w checku na później | Plan (użytkownik) |
| Panel `/owner` | Przycisk + prosta lista ofert z linkiem do rankingu | Do rankingu da się wrócić; S-04 rozbuduje listę | Plan (użytkownik) |
| Odczyt profili przez właściciela | Funkcja SQL `security definer` zwracająca tylko potrzebne kolumny | Polityka select odsłoniłaby całe wiersze agentów | Research |
| Miejsce reguły wyniku | Tylko w SQL (`rank_agents_for_offer`), test w `supabase/tests/` | Jedno źródło, testowalne w CI bez frameworka | Research |
| Kiedy liczyć ranking | Na żywo przy każdym wejściu na stronę oferty | FR-011: agent wypada, kolejny wskakuje | Plan |
| Remisy | Wynik ↓, staż ↓, `created_at` ↑, `id` ↑ | PRD + deterministyczny ostatni klucz | Research |
| Zbiór statusów | `draft, seeking_agent, invited, in_progress` od razu | S-04/S-05 nie zmieniają checka | Plan |
| `owner_id` i `status` | Wartości domyślne + grant insert bez tych kolumn | Właściciel nie podszyje się ani nie ustawi statusu | Plan |
| Metraż / pokoje | `numeric(7,2)` (przecinek lub kropka) / integer 1–50 | Metraże typu 48,5 m² są typowe | Plan |
| Kontrolki | Select dla miasta, karty radio dla typu i transakcji | 18 vs 2–3 opcje; wzorzec `RoleChoice` | Plan |

## Scope

**In scope:**
- Migracja `offers` + RLS + `rank_agents_for_offer`, test SQL, typy
- Słownik transakcji, serwis zod, `POST /api/owner/offers`, `/owner/offers/new`
- `/owner/offers/[id]` z rankingiem, `/owner` z listą, „Nowa oferta” w nawigacji, kroki smoke

**Out of scope:**
- Edycja, usuwanie, statusy na liście (S-04); zaproszenia i odrzucenia (S-05, S-06)
- Dane osobowe agenta, uzasadnienie wyniku (FR-013), zapisywanie wyniku w bazie, `service_role`

## Architecture / Approach

Formularz (wyspa React) → natywny POST → endpoint (sesja, rola, zod) → insert przez RLS → redirect na stronę oferty. Strona czyta ofertę przez RLS (404, gdy niewidoczna) i woła `supabase.rpc("rank_agents_for_offer")`; funkcja definer sprawdza właściciela oferty, liczy 35 (typ) + 35 (cena, granice włącznie) + 3 × min(staż, 10) dla agentów z miastem oferty i pełnym profilem, odrzuca wynik 0, sortuje i obcina do 3.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Schemat i reguła wyniku | Tabela, RLS, funkcja rankingu, test SQL, typy | Błąd w regule lub definer bez zawężenia do właściciela |
| 2. Zapis oferty | Formularz, serwis, endpoint, smoke | Rozjazd walidacji klienta, zod i checków |
| 3. Ranking i panel | Strona rankingu, lista na `/owner`, nawigacja, smoke | 404 vs pusty ranking; odmiana „lat”; anonimowość w HTML |

**Prerequisites:** S-01 i S-02 zamknięte; lokalny Supabase; w fazie 1 `supabase migration up` (bez kasowania kont).
**Estimated effort:** ~3 sesje, po jednej na fazę (jedna faza = jeden commit).

## Open Risks & Assumptions

- `auth.uid()` w funkcji `security definer` czyta claims wołającego — test SQL musi to potwierdzić przypadkiem obcej oferty.
- Przy błędzie walidacji serwera formularz startuje pusty; zakładamy, że walidacja klienta łapie realne błędy.
- Migracja na produkcję ręcznie przed merge (`db push --dry-run` → zgoda → `db push`).

## Success Criteria (Summary)

- Właściciel w 3 akcjach dochodzi od pustego panelu do rankingu swojej oferty.
- Ranking zgadza się z ręcznym wyliczeniem reguły PRD, także przy remisach i granicach przedziału.
- Właściciel nie widzi cudzych ofert ani danych osobowych agentów.
