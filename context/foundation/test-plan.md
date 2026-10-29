# Test Plan

> Phased test rollout for this project. Strategy is frozen at the top
> (§1–§5); cookbook patterns at the bottom (§6) fill in as phases ship.
> Read before writing any new test.
>
> Refresh: re-run `/10x-test-plan --refresh` when stale (see §8).
>
> Last updated: 2026-10-29

Zakres celowo minimalny: dwa etapy, które pokrywają ryzyka High × Medium z perspektywy użytkownika, przed terminem 2026-11-04. Ryzyka #3–#6 są w mapie, ale nie mają własnego etapu (zob. §7).

## 1. Strategy

Każdy test w tym projekcie podlega trzem zasadom:

1. **Koszt × sygnał.** Wygrywa najtańszy test, który daje prawdziwy sygnał dla danego ryzyka. Nie przenoś testu do e2e tylko dlatego, że „wydaje się bezpieczniej”. Nie kładź modelu wizyjnego na deterministycznym diffie, który już wykrywa regresję.
2. **Obawy użytkownika są dowodem.** Ryzyko zakotwiczone w „zespół boi się X, a awaria ujawniłaby się gdzieś w <obszar>” waży tyle samo co linia PRD albo dane hot-spotów.
3. **Ryzyka to scenariusze, nie miejsca w kodzie.** Ten plan opisuje, *co może się zepsuć* i *dlaczego uważamy to za prawdopodobne*. Opiera się na dokumentach, wywiadzie i *sygnale* z repozytorium (częstotliwość zmian, struktura, baza testów). NIE twierdzi, że wie, która linia odpowiada za awarię. Tę wiedzę wytwarza `/10x-research` w każdym etapie wdrożenia. Jeśli plan i research różnią się co do miejsca awarii, rację ma research.

Hot-spot scope used for likelihood weighting: `src/`, `supabase/migrations/`, `supabase/tests/`, `scripts/` (bez `src/db/database.types.ts`; 38 commitów/30 dni, cały kod powstał w ostatnich 3 dniach, więc częstotliwość zmian odzwierciedla raczej kolejność budowy niż niestabilność).

## 2. Risk Map

| # | Risk (failure scenario) | Impact | Likelihood | Source (evidence — not anchor) |
|---|---|---|---|---|
| 1 | Właściciel widzi w top 3 złych agentów albo w złej kolejności: agenta spoza miasta oferty, zły wynik 35/35/30, zły remis (staż → data rejestracji), agenta, który odrzucił zaproszenie, albo agenta z niepełnym profilem | High | Medium | PRD Business Logic, FR-008, FR-011, US-01; interview Q3 (funkcje SQL — „mało to znam”); archive/offer-top3-ranking reviews F1, archive/invitation-response reviews F1 (test remisu przechodził z niewłaściwego powodu); hot-spot dir `supabase/tests/` (11 commitów/30d) |
| 2 | **Nadużycie / IDOR:** zalogowany właściciel czyta albo zmienia cudzą ofertę, a agent widzi niezaproszoną ofertę albo dane właściciela. Atak przez REST/RPC Supabase albo podmieniony identyfikator w `/api/*` | High | Medium | PRD Guardrails, Access Control; interview Q3; archive/agent-invitation reviews F4 (UUID właściciela przez REST), archive/offer-top3-ranking reviews F3 (wyliczanie profili przez RPC), archive/role-based-signup reviews F4 (`/api/*` nie jest bramkowane); hot-spot dir `src/pages/api/` (19 commitów/30d) |
| 3 | Oferta łamie cykl statusów: dwóch przyjętych agentów, edycja po zaproszeniu, oferta zostaje w `invited` po odrzuceniu albo usunięciu konta, albo po usunięciu konta zostają dane | High | Medium | PRD Guardrails, FR-005, FR-011, FR-012, NFR o usunięciu danych; archive/agent-invitation reviews F1, F3; archive/account-deletion; archive/invitation-response reviews F4 |
| 4 | Rejestracja albo potwierdzenie e-maila działa lokalnie, a psuje się na produkcji (`redirect_to` na złą domenę, `otp_expired`) | High | Medium | interview Q2; lessons.md („flow potwierdzenia e-maila na produkcji”); archive/role-based-signup reviews F5; hot-spot dir `src/pages/api/` (19 commitów/30d) |
| 5 | **Nadużycie / niezaufane wejście:** serwer przyjmuje niepoprawne dane albo błąd Supabase kończy się 200 lub fałszywym sukcesem zamiast komunikatu | Medium | Medium | archive/agent-profile reviews F2, F3; archive/offer-top3-ranking reviews F4; archive/owner-offer-management reviews F3; hot-spot dir `src/lib/services/` (17 commitów/30d) |
| 6 | Zestaw testów daje fałszywą pewność: smoke i testy SQL są zielone mimo regresji | Medium | Medium | archive/role-based-signup reviews F2 (`startsWith`); archive/owner-offer-management reviews F1 (ruchome okno stanu); hot-spot `scripts/` (18 commitów/30d, najczęściej zmieniany obszar) |

### Risk Response Guidance

| Risk | What would prove protection | Must challenge | Context `/10x-research` must ground | Likely cheapest layer | Anti-pattern to avoid |
|---|---|---|---|---|---|
| #1 | Dla tabeli przypadków spisanej z PRD (miasto, typ, cena na granicach przedziału, staż 0/5/10/15, remis wyniku i stażu, odrzucenie, niepełny profil) właściciel dostaje dokładnie oczekiwaną kolejność i wyniki, a agent z wynikiem 0 nie pojawia się w ogóle | „Jeden agent w top 3 dowodzi reguły”; „istniejący test SQL rankingu już to pokrywa” | Gdzie naprawdę liczy się wynik, jak wywołać ranking z sesją właściciela, co dziś pokrywają testy SQL | integracja na lokalnym Supabase z prawdziwą sesją | Wartość oczekiwana przepisana z kodu funkcji (problem wyroczni); dane, w których remis faktycznie nie zachodzi |
| #2 | Użytkownik B z prawdziwą sesją dostaje odmowę albo pusty wynik na każdej ścieżce do zasobów A: tabele przez REST, RPC i endpointy `/api/*` | „Middleware chroni, więc RLS nie trzeba testować”; „pusta lista = brak dostępu” (bez sprawdzenia, że A widzi swoje dane) | Pełna lista powierzchni dostępu (tabele, RPC, endpointy), sposób uzyskania dwóch sesji w teście | integracja: dwa konta, zapytania krzyżowe | Test jako `service_role`/postgres, który omija RLS; samo „niezalogowany → 401” |
| #3 | Po każdej akcji (zaproś, przyjmij, odrzuć, usuń konto, edytuj) status oferty i liczba przyjętych agentów zgadzają się z PRD, także przy drugiej próbie przyjęcia | „Odpowiedź 200 = poprawny stan” | Gdzie żyją przejścia (RPC, triggery, kaskady); stany bez wyjścia | integracja SQL/RPC (istniejące testy SQL) | Sprawdzanie tylko odpowiedzi HTTP bez stanu bazy |
| #4 | Link z maila produkcyjnego prowadzi na domenę produkcyjną, a klik potwierdza konto | „Lokalnie działa, więc na produkcji też” (lokalnie potwierdzenia są wyłączone) | Skąd pochodzi `redirect_to`; co da się sprawdzić bez wysyłania maila (limit ~2 maile/h) | ręczny krok na produkcji + Mailpit lokalnie (lessons.md) | E2E wysyłające maile w każdym CI |
| #5 | Niepoprawne wejście kończy się czytelnym kodem błędu i baza nic nie zapisuje; błąd Supabase nie udaje sukcesu | „Walidacja w formularzu wystarczy” | Schematy walidacji po stronie serwera, ograniczenia w bazie, mapowanie błędów | integracja endpointu | Testowanie tylko klienckiej wyspy React |
| #6 | Celowo zepsuta reguła (odwrócony remis, wyłączona polityka RLS) zapala nowe testy na czerwono | „Zielone CI = chronione” | Co dziś faktycznie sprawdzają smoke i testy SQL | break-check w każdym etapie | Test, który przechodzi także po zepsuciu kodu |

## 3. Phased Rollout

| # | Phase name | Goal (one line) | Risks covered | Test types | Status | Change folder |
|---|---|---|---|---|---|---|
| 1 | Ranking i izolacja danych | Wprowadzić runner testów i udowodnić z prawdziwymi sesjami, że top 3 zgadza się z regułą PRD, a użytkownik B nie dosięga danych użytkownika A | #1, #2, #6 | integration (lokalny Supabase, dwa konta), break-check, CI | complete | context/archive/2026-10-29-testing-ranking-and-isolation/ |
| 2 | Ścieżka krytyczna w przeglądarce | Jeden test E2E z perspektywy użytkownika: właściciel → oferta → top 3 → zaproszenie → agent przyjmuje, uruchamiany w CI | #1, #2, #3 | e2e (Playwright, Chromium), CI | change opened | context/changes/testing-critical-path-e2e/ |

## 4. Stack

| Layer | Tool | Version | Notes |
|---|---|---|---|
| database / RLS | skrypty SQL w `supabase/tests/` przez `psql` | — | istnieją (6 plików), uruchamiane w CI w jobie smoke |
| smoke HTTP | `scripts/smoke.mjs` | — | istnieje; auth i główne przepływy na działającym serwerze |
| unit + integration | Vitest | 5.0.5 | `tests/integration/`, `npm run test:integration`; w CI w jobie smoke (krok `Run integration tests`) na lokalnym Supabase |
| e2e | none yet — see Phase 2 | — | Playwright przez `/10x-e2e-setup`; tylko Chromium (§7) |

**Stack grounding tools (current session):**
- Docs: none (brak Context7 i MCP dokumentacji) — wersje sprawdzane z `package.json`; checked: 2026-10-29
- Search: none (brak Exa.ai) — not used; checked: 2026-10-29
- Runtime/browser: Claude in Chrome (rozszerzenie) — tylko ręczna weryfikacja, nie warstwa testów; Playwright MCP not available in current session; checked: 2026-10-29
- Provider/platform: `gh` CLI (bez MCP GitHub/Supabase/Cloudflare) — odczyt statusu CI; checked: 2026-10-29

## 5. Quality Gates

| Gate | Where | Required? | Catches |
|---|---|---|---|
| lint + typecheck + build | husky lint-staged + CI | required (już działa) | dryf składni i typów |
| testy SQL `supabase/tests/` | CI (job smoke) | required (już działa) | regresje RLS i RPC |
| smoke HTTP | CI (job smoke) + po deployu | required (już działa) | zepsute przepływy auth i podstawowe ścieżki |
| integration (ranking + izolacja) | local + CI | required after §3 Phase 1 | regresje reguły rankingu i IDOR |
| e2e ścieżki krytycznej | CI on PR | required after §3 Phase 2 | zepsuta ścieżka właściciel → agent |
| post-edit hook | local (agent loop) | recommended after §3 Phase 2 (via `/10x-configure-hook`) | regresje w trakcie edycji |

## 6. Cookbook Patterns

### 6.1 Adding a ranking / scoring test

- **Location**: `tests/integration/<obszar>.test.ts`, wspólne helpery w `tests/integration/helpers.ts`; uruchamiane przez `npm run test:integration` na lokalnym Supabase.
- **Reference test**: `tests/integration/ranking.test.ts` (przypadki R1–R8).
- **Zasady**:
  - Wyrocznia z PRD (Business Logic), policzona ręcznie i wpisana jako stałe (`top: [["A2", 100], …]`). Nigdy nie licz wyniku tą samą formułą co `rank_agents_for_offer`.
  - Jedna pula agentów (`AGENT_POOL`) na cały plik i kilka ofert na niej, bo każda rejestracja zjada limit auth. Przed testami `assertCitiesEmpty` sprawdza, że miasta puli są puste (pozostałości w bazie zajęłyby miejsca w top 3).
  - Konta rejestruj sekwencyjnie w `beforeAll`: kolejność rejestracji wyznacza remis „wcześniejsza rejestracja”.
  - Remis musi faktycznie zachodzić w danych (ten sam wynik i staż), a przypadek graniczny ceny sprawdzaj z obu stron (równa granica i ±1).
  - Ranking wywołuj sesją właściciela oferty (`rank()`), nigdy `service_role`. Sprzątanie w `afterAll` przez `deleteUsers` (RPC `delete_own_account`).

### 6.2 Adding an access-isolation (IDOR) test

- **Location**: `tests/integration/<obszar>.test.ts`, helpery z `tests/integration/helpers.ts` (`signUpAs`, `anonClient`, `deleteUsers`).
- **Reference test**: `tests/integration/isolation.test.ts` (przypadki I1–I16).
- **Zasady**:
  - Każde zapytanie idzie przez PostgREST z kluczem anon i JWT prawdziwej sesji (albo bez sesji, dla anon). Nigdy `service_role` ani `postgres`: omijają RLS.
  - Kontrola pozytywna obok negatywnej: pusty wynik B jest dowodem tylko wtedy, gdy w tym samym przebiegu A widzi te same dane (np. `readXAsA()` po próbie B).
  - Sprawdzaj każdą ścieżkę: odczyt, `update`/`delete` (0 zmienionych wierszy i niezmieniony stan u A) oraz RPC.
  - Zaakceptowane ujawnienia (np. `owner_id` widoczny dla zaproszonego agenta) opisz w komentarzu pliku, żeby nie traktować ich jako wycieku.
  - Konta rejestruj sekwencyjnie w `beforeAll`, miasta chroń `assertCitiesEmpty`, sprzątaj przez `deleteUsers` (RPC `delete_own_account`).

### 6.3 Adding a database / RLS test in SQL

- **Location**: `supabase/tests/<slice>.sql`, uruchamiane w CI przez `psql -v ON_ERROR_STOP=1`.
- **Reference test**: `supabase/tests/invitation-response.sql`.

### 6.4 Adding an e2e test

- TBD — see §3 Phase 2 (ścieżka właściciel → agent w Chromium).

### 6.5 Per-rollout-phase notes

(Dopisywane po każdym etapie.)

- **Etap 1 (ranking i izolacja)**: pełny przebieg rejestruje ~13 kont, więc `[auth.rate_limit] sign_in_sign_ups` w `supabase/config.toml` podniesiono do 100 (lokalnie i w CI; produkcja bez zmian). Lokalnie nowy limit działa dopiero po `npx supabase stop && npx supabase start` (dane zostają); bez restartu drugi przebieg dostaje 429. Kilka przebiegów pod rząd może dać 429 — wtedy odczekaj 5 minut. Break-check RLS: `drop policy offers_select_own` *zaostrza* dostęp (RLS domyślnie odmawia), więc zapala kontrolę pozytywną, a nie test IDOR. Zepsucie izolacji to polityka przepuszczająca wszystko (`create policy … for select to authenticated using (true)`), zatwierdzona w bazie, bo PostgREST nie widzi zmian z transakcji z rollback. Wyniki: `context/changes/testing-ranking-and-isolation/plan.md`, sekcja Break-check.

## 7. What We Deliberately Don't Test

- **Kompatybilność z wieloma przeglądarkami** — E2E tylko w Chromium; NFR o czterech przeglądarkach to akceptowane ryzyko MVP. Wróć do tego, jeśli użytkownicy zgłoszą błąd w Safari albo Firefoksie. (Source: Phase 2 interview Q5.)
- **Ryzyka #3–#5 bez nowego etapu** — #3 częściowo chronią istniejące testy SQL i E2E z Phase 2; #4 jest weryfikowane ręcznie na produkcji według lessons.md; #5 zostaje bez nowych testów. To decyzja o zakresie przed terminem 2026-11-04, nie ocena, że ryzyka nie istnieją. Wróć do nich przez `--refresh` po certyfikacji.

## 8. Freshness Ledger

- Strategy (§1–§5) last reviewed: 2026-10-29
- Stack versions last verified: 2026-10-29
- AI-native tool references last verified: 2026-10-29

Refresh (`/10x-test-plan --refresh`) when:

- a new top-3 risk surfaces from the roadmap or archive,
- a recommended tool's `checked:` date is older than three months,
- the project's tech stack changes (new framework, new test runner),
- §7 negative-space no longer matches what the team believes.
