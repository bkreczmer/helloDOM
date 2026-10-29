---
artifact: architect-report
module: M4 (10xArchitect)
created: 2026-10-29
inputs:
  - context/map/repo-map.md (L2)
  - context/changes/matching-analysis/research.md (L3)
  - context/archive/2026-10-29-refactor-error-reporting/ (L4)
  - context/domain/domain-distillation.md, glossary.md, 02-invariant-aggregate-refactor.md, 03-anti-corruption-layer.md (L5)
---

# Raport architektoniczny M4 — helloDOM

## 1. Opisane projekty

Wszystkie artefakty (L2–L5) powstały na jednym repozytorium: **helloDOM** (`bkreczmer/helloDOM`), które łączy właścicieli nieruchomości z agentami (wynik 0–100, top 3, zaproszenie). Stack: Astro 7 SSR + React 19 + TypeScript na Cloudflare Workers, Supabase (Postgres z RLS i RPC, Auth). Skala: 8 możliwości biznesowych, 8 migracji, 91 commitów i 23 PR-y w 3 dni, jeden autor (73% commitów ze współautorem Claude). Krótka historia oznacza, że „churn” opisuje kolejność budowy, a nie stabilność.

## 2. Mapa projektu (L2)

- **Strefy ryzyka:** (1) zaproszenia i cykl statusów oferty — 63 zmiany w 21 commitach, 16 ustaleń przeglądów, 2 krytyczne z audytu; (2) bramka sesji i ról — `src/lib/supabase.ts` importuje 18 plików z 6 możliwości, audyt znalazł dwie ciche awarie krytyczne (A1, A2); (3) rejestracja i logowanie — jedyne poprawki po wdrożeniu na produkcję.
- **Lokalne centrum:** `src/lib/services/offers.ts` (fan-in 15 w trzech możliwościach) — wspólne mapowania, nie logika biznesowa.
- **Entry pointy:** `src/middleware.ts` (każde żądanie), `src/pages/owner/offers/[id].astro` (spotkanie oferty, rankingu i zaproszenia).
- **Najważniejsze unknowns:** ranking, czyli wartość rdzenia, nie ma własnej migracji — `rank_agents_for_offer` jest zdefiniowane w migracji ofert i nadpisane w migracji zaproszeń; sprzężenia przez SQL, RLS i URL-e formularzy są niewidoczne w grafie importów.

## 3. Analiza ficzera (L3)

**Badany przepływ:** oferta → ranking top 3 → zaproszenie → odpowiedź agenta. To strefa ryzyka nr 1 z mapy plus obserwowany hub `offers.ts` i rozproszony SQL rankingu.

**Feature overview:** wejściem są trzy natywne formularze (oferta, „Zaproś” z ukrytymi `offerId`/`agentId`, odpowiedź agenta). Stan zmienia się wyłącznie w Postgresie: rola `authenticated` nie ma prawa zapisu do `invitations` ani `offers.status`, więc każde przejście idzie przez RPC (`invite_agent`, `respond_to_invitation`) albo trigger. `invite_agent` przelicza ranking jeszcze raz, więc sprawdza bieżący top 3. Każde wywołanie kończy się przekierowaniem 302 z `?<sukces>=1` albo `?error=<kod>`, a cudza oferta daje 404.

**Dług techniczny:**

- **TD-1 — kontrakt SQL ↔ TS bez kompilatora.** Kody wyników RPC są utrzymywane ręcznie w `INVITE_RESULTS`/`RESPOND_RESULTS` i w `return` w SQL. Nowy kod w SQL endpoint po cichu zamieni na `unknown`. ast-grep potwierdził, że strażnicy `isInviteResult`/`isRespondResult` są wołani tylko w dwóch endpointach i nie mają testów jednostkowych.
- **TD-2 — reguła i maszyna stanów rozproszone.** Dwie definicje `rank_agents_for_offer` (grep), przejścia `offers.status` w 4 migracjach, predykat „aktywne zaproszenie” w 5 miejscach SQL.
- **TD-3 — luki testowe:** gałęzie `unavailable`/`unknown` i strony 503 bez testu, wyścig dwóch `invite_agent` symulowany ręcznym insertem.

Weryfikacja ast-grep objęła 9 twierdzeń. Pierwsza próba dała same zera, bo zsh nie uruchomił polecenia ze zmiennej; powtórka w bashu dała właściwe wyniki.

## 4. Plan refaktoryzacji (L4)

Plan powstał jako zmiana `refactor-error-reporting` (folder `context/archive/2026-10-29-refactor-error-reporting/`; wcześniej roboczo „refactor-opportunities”). Przeszedł pełny cykl: research, plan, plan-review, implementacja (PR #25, poprawki z impl-review w PR #26) i archiwizację.

**Co refaktoryzowane:** opcja A spośród trzech (A: obsługa błędów, B: kontrakt SQL rankingu, C: wydzielenie modułów). Docelowo jeden helper `reportError` zamiast 10 lokalnych kopii `fail(code)` i 30 `catch {}` bez bindingu. Każda ścieżka błędu po stronie serwera loguje jedną linię JSON (`op`, `route`, `requestId`, `userId`, bez e-maili i treści formularzy). Semantykę zmieniają tylko trzy miejsca: middleware odróżnia awarię Auth od braku sesji, `not_found` przy usuwaniu konta jest błędem (D1), a strony w stanie błędu zwracają 503 zamiast 200.

**Czego świadomie nie robimy:** zewnętrznego trackera i alertów, zmian w SQL/RPC (to opcja B), zmiany semantyki `no_profile`, własnej strony 503 dla awarii Auth, beaconu błędów po stronie klienta.

**Fazy (jedna faza = jeden commit):**

1. Helper i testy jednostkowe — auto: `test:unit`, celowe uszkodzenie testu prywatności; ręcznie: przegląd pól logu.
2. Middleware i auth — auto: lint, `astro check`, smoke, E2E; ręcznie: zatrzymany kontener Auth → `302 /auth/signin?error=unavailable`.
3. Endpointy biznesowe i D1 — auto: jak wyżej plus integracja i grep na `catch {`; ręcznie: podmieniona funkcja `delete_own_account` → `?error=unknown`.
4. Strony 503 — auto: jak wyżej plus zielone CI; ręcznie: tymczasowo przemianowana tabela `offers` → 503, linia logu w `wrangler tail` na produkcji.

## 5. Domena wg DDD (L5)

**Ubiquitous language:** _oferta_ (status: szkic → szuka agenta → zaproszenie wysłane → w obsłudze), _zaproszenie_ (oczekuje na odpowiedź / przyjęte / odrzucone), _aktywne zaproszenie_ (`pending` albo `accepted`), _wynik_ i _ranking (top 3)_, _profil dopasowania_ agenta. Kod mówi językiem PRD niemal słowo w słowo: 22 terminy Core i Supporting mają miejsce w kodzie, brakuje jednego (uzasadnienie wyniku). Najważniejsze rozjazdy:

- **D-01:** PRD opisuje „szkic” jako pierwszy status i warunek edycji, a kod go nigdy nie ustawia (decyzja z owner-offer-management, PRD niepoprawione);
- **D-06:** kryterium sukcesu „właściciel rozumie, dlaczego agent dostał dany wynik” nie ma żadnego kodu;
- **B-01:** słowo „profil” oznacza dwa pojęcia (konto z rolą i profil dopasowania) w jednej tabeli.

**Niezmiennik #1 (N-2 z N-1):** status oferty wynika z jej jedynego aktywnego zaproszenia (`seeking_agent` ⇔ brak, `invited` ⇔ `pending`, `in_progress` ⇔ `accepted`). Należy do agregatu **Oferta z zaproszeniami** (root `offers`, encje `invitations`). Dziś trzyma się tylko konwencją: pilnuje go trzech pisarzy w trzech migracjach, a trigger działa tylko na `DELETE`. Jednorazowa naprawa osieroconych ofert pokazuje, że rozjazd już się zdarzył. Plan: agregat w Postgresie (schemat `offer_lifecycle`, constraint triggery sprawdzane przy commicie, cienkie RPC), 5 faz test-first. Wariant w TS odrzucony, bo PostgREST nie daje transakcji obejmującej kilka wywołań.

**Anti-Corruption Layer:** przecieka klient Supabase. 18 plików warstwy wejścia (middleware, 9 endpointów, 7 stron, callback) wykonuje 26 zapytań i RPC oraz 8 wywołań `auth`, a serwisy — 0, choć `CLAUDE.md` deklaruje logikę w `src/lib/services/`. Odnogi sięgają kolejnych warstw: typy `Database` w DTO (`src/types.ts`) i trzech serwisach, `User` z `supabase-js` w kontrakcie `App.Locals`, kody Auth w serwisie. Sprawdzenie roli jest skopiowane w 7 endpointach. Plan: wąskie porty domenowe i jeden adapter `src/lib/adapters/supabase/`, 7 faz, na końcu reguła ESLint. Przy okazji wyszedł błąd: `src/lib/supabase.ts:15` ignoruje nagłówki `Cache-Control`, które `@supabase/ssr` każe ustawić przy odświeżaniu sesji — do osobnej zmiany.

## 6. Decyzje, które należą do mnie

> **SZKIC do redakcji przez autora** — przeredaguj własnymi słowami i usuń tę ramkę.

Agent zaproponował trzy kierunki refaktoru. Wybrałem obsługę błędów (A), a nie kontrakt SQL rankingu (B) ani podział modułów (C), bo audyt pokazał, że awarie na produkcji nie zostawiają śladu, a bez logów każda kolejna zmiana byłaby robiona na ślepo. Odwróciłem też decyzję z planu account-deletion: `not_found` przy usuwaniu konta jest teraz błędem, bo endpoint chwilę wcześniej sprawdza, że profil istnieje, a użytkownik nie może dostać potwierdzenia usunięcia danych, które nie zniknęły. Odrzuciłem natomiast dwie zmiany zachowania, które podpowiadał audyt: `no_profile` dalej wylogowuje (dochodzi tylko log), a awaria Auth kończy się istniejącym `?error=unavailable` zamiast nowej strony 503. Zasada była jedna: refaktor zmienia to, co widzi użytkownik, tylko tam, gdzie obecne zachowanie ukrywa awarię.
