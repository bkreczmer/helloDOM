# Test E2E ścieżki krytycznej (rollout Phase 2) — plan implementacji

## Overview

Wprowadzamy Playwrighta (Chromium) i jeden plik `tests/e2e/critical-path.spec.ts`. Plik sprawdza w przeglądarce ścieżkę właściciel → oferta → top 3 → zaproszenie → odrzucenie → ponowne zaproszenie → przyjęcie i pokrywa ryzyka #1 (zły top 3 / kolejność), #2 (IDOR przez UI) i #3 (cykl statusów) z `context/foundation/test-plan.md` §2. Test uruchamia się w jobie `smoke` w CI na każdym PR.

## Current State Analysis

- Playwrighta nie ma: brak `@playwright/test` w `package.json`, `playwright.config.*`, `tests/e2e/` i `context/foundation/test-stack.md`. W `test-plan.md` §4 warstwa e2e ma status „none yet — see Phase 2”, a §6.4 jest „TBD”.
- Ranking liczy jedno RPC: `rank_agents_for_offer` (`supabase/migrations/20261028200000_invitation_response.sql:21-54`). Strona i `RankingList.astro` nie sortują ani nie filtrują (`src/pages/owner/offers/[id].astro:55-58`, `src/components/owner/RankingList.astro:30-74`). Ranking w UI jest anonimowy („Agent N”), a tożsamość agenta niesie tylko ukryte `input[name="agentId"]` w `<li>`.
- Izolację stron zapewnia wyłącznie RLS plus klient z ciasteczka sesji. Middleware sprawdza tylko rolę (`src/middleware.ts:48-51`), więc cudza oferta daje 404 z kartą „Nie znaleziono oferty”.
- Cyklu statusów pilnują RPC `invite_agent` / `respond_to_invitation`, indeks `invitations_one_active_per_offer` i polityka `offers_update_own_editable`. Wszystkie akcje to natywne formularze z odpowiedzią 302 i `?error=` / `?ok`, więc odpowiedź HTTP nie dowodzi stanu.
- Dziś smoke sprawdza w HTML tylko „Agent 1 / 100/100 / Zaproś” dla jednego agenta (`scripts/smoke.mjs:303-311`). Arytmetykę i remisy pokrywa Phase 1 (`tests/integration/ranking.test.ts`, `isolation.test.ts`, `supabase/tests/*.sql`).
- Job `smoke` (`.github/workflows/ci.yml:27-68`) kolejno: uruchamia lokalny Supabase, wykonuje testy SQL, testy integracyjne, sprawdza dryf typów, zapisuje `.env` i `.dev.vars`, buduje aplikację, a na koniec jednym krokiem uruchamia `preview` w tle na 4321 i `npm run smoke`.

Szczegóły i odwołania `file:line` są w `context/changes/testing-critical-path-e2e/research.md`.

## Desired End State

- `npx playwright test` uruchamia lokalnie (przy działającym `npx supabase start`) seed test i `tests/e2e/critical-path.spec.ts`. Oba przechodzą na zimnym serwerze, który podnosi `webServer` z configu.
- `critical-path.spec.ts` zawiera dwa `test()` w `test.describe.serial` na wspólnym seedzie:
  1. **Ścieżka główna (oferta Lublin)**: wyrocznia top 3 z PRD (P, T1, T2) → zaproszenie P → P odrzuca → ranking wraca z F jako Agent 3 i bez P → zaproszenie T1 → T1 przyjmuje. Po każdej akcji test czyta stan bazy sesją właściciela. Po drodze sprawdza izolację: właściciel B, niezaproszony agent T2 i zaproszony agent wobec drugiej oferty A.
  2. **Oferta Zielona Góra**: dokładnie jedno `<li>` (Y, 70/100), komunikat „mniej niż 3”, brak Z (wynik 0).
- Job `smoke` w CI uruchamia Playwrighta przed krokiem smoke, a przy porażce wgrywa raport i trace jako artefakt.
- `test-plan.md` (§3 Phase 2, §4 e2e, §5, §6.4), `CLAUDE.md` (Commands, Testing) i `README.md` (Skrypty) opisują nową warstwę.

Weryfikacja: zielony job `smoke` na PR oraz celowe uszkodzenia z Fazy 2 (każde daje czerwień).

### Key Discoveries:

- Kolejność rejestracji wyznacza remis T1 < T2 (`order by score desc, experience_years desc, created_at asc`, `invitation_response.sql:51-53`), więc konta agentów trzeba zakładać sekwencyjnie.
- Po przyjęciu UI agenta nie renderuje przycisków (`src/pages/agent/offers/[id].astro:88-101`). Drugą próbę przyjęcia trzeba więc wysłać przez `page.request.post` z `Origin`. Kończy się ona 302 do `/agent?error=already_responded`.
- Po odrzuceniu agent ląduje na `/agent?rejected=1`, a strona oferty daje mu 404 (`src/pages/api/agent/invitations.ts:59-66`).
- `assertCitiesEmpty` (`tests/integration/helpers.ts:111-138`) nie zależy od vitest. Komunikat naprawczy zna tylko wzorce `it-%` i `smoke-%`, więc trzeba dopisać `e2e-%`.
- `/10x-e2e-setup` nie dotyka CI i niczego nie commituje. Tworzy projekt `setup` ze storageState z `E2E_USERNAME`/`E2E_PASSWORD`, a `webServer` z `reuseExistingServer: !process.env.CI`.

## What We're NOT Doing

- Tabeli przypadków brzegowych rankingu w E2E: arytmetyka, granice cen i remisy po `agent_id` zostają w Phase 1 (test-plan §1 „koszt × sygnał”).
- Wyścigu dwóch przyjęć: przy jednym zaproszeniu na ofertę w E2E nie zachodzi, pokrywa go `supabase/tests/invitation-response.sql`.
- Usunięcia konta (FR-012) w ścieżce: pokrywa je `account-deletion.sql` i smoke. W E2E `POST /api/account/delete` służy tylko do sprzątania.
- Innych przeglądarek niż Chromium (test-plan §7) i testów na produkcji (limit maili, ryzyko #4).
- Dodawania `data-testid` ani danych osobowych agenta do UI na potrzeby testu: tożsamość sprawdzamy przez ukryte `agentId`.
- Odczytu bazy przez `service_role` ani psql w asercjach: tylko supabase-js z kluczem anon i sesją użytkownika (test-plan §6.2).
- Zmian w kodzie produkcyjnym, schemacie i politykach RLS.

## Implementation Approach

Każda faza odpowiada jednemu skillowi i kończy się jednym commitem. Faza 1 (`/10x-e2e-setup`) stawia infrastrukturę i zielony seed. Faza 2 (`/10x-e2e`) pisze właściwy test w pętli plan → generate → review → verify, z celowymi uszkodzeniami. Faza 3 (`/10x-implement`) podłącza CI i aktualizuje dokumentację. Konta i profile agentów test zakłada przez HTTP API (jak smoke), a ofertę właściciel tworzy w UI, bo to część ścieżki krytycznej.

Wyrocznia jest policzona ręcznie z reguły PRD (`context/foundation/prd.md:106-112`), a nie odczytana z kodu:

**Oferta A1** — `lublin`, mieszkanie, 500 000 zł. Agentów rejestrujemy w kolejności: P, T1, T2, F, I, O.

| Agent | Profil | Wynik z PRD | Oczekiwanie |
|---|---|---|---|
| P | lublin, apartment, 400–600 tys., 10 lat | 35+35+30 = 100 | Agent 1 |
| T1 | lublin, apartment, 400 000–500 000, 5 lat | 85 | Agent 2 (remis z T2, wcześniejsza rejestracja) |
| T2 | lublin, apartment, 500 000–700 000, 5 lat | 85 | Agent 3 |
| F | lublin, house, 400–600 tys., 15 lat | 0+35+30 = 65 | poza top 3; Agent 3 po odrzuceniu przez P |
| I | lublin, apartment, 400–600 tys., bez stażu | — (niepełny profil) | nigdy w HTML |
| O | rzeszow, apartment, 400–600 tys., 10 lat | — (inne miasto) | nigdy w HTML |

**Oferta A2** — `zielona-gora`, działka, 950 000 zł. Y (zielona-gora, plot, 900 000–1 000 000, 0 lat) ma 70 pkt i jest jedynym `<li>`. Z (zielona-gora, house, 1–10 zł, 0 lat) ma 0 pkt i nie występuje. Widoczny jest komunikat „Dopasowanych agentów jest mniej niż 3…”.

Po odrzuceniu przez P oczekiwany ranking A1 to: Agent 1 = T1 (85), Agent 2 = T2 (85), Agent 3 = F (65).

## Critical Implementation Details

- **Kolejność i serializacja**: konta zakładamy sekwencyjnie (nie `Promise.all`), w kolejności z tabeli. Plik działa w `test.describe.serial` z `workers: 1` dla tego pliku. Remis T1/T2 zależy od `profiles.created_at`.
- **Sesje**: spec rezygnuje z zapisanego storageState (`test.use({ storageState: { cookies: [], origins: [] } })`) i otwiera osobny `browser.newContext()` na użytkownika. Rejestracja przez `context.request.post("/api/auth/signup", { form })` zapisuje ciasteczka `sb-*` w tym kontekście. Każde `request.post` wysyła nagłówek `Origin: baseURL`.
- **Hydratacja**: „Przyjmij” / „Odrzuć” → „Tak, …” to wyspa React. Przed kliknięciem trzeba poczekać na interaktywność, inaczej klik ginie (wzorzec seeda z `/10x-e2e-setup`).
- **Dane między przebiegami**: e-maile `e2e-<rola>-<runId>@example.com`. Przed seedem uruchamiamy `assertCitiesEmpty` dla `lublin`, `rzeszow` i `zielona-gora`, a w `afterAll` dla każdego kontekstu `POST /api/account/delete` (niezależnie od wyniku testu).
- **CI — port**: `webServer` w CI (`reuseExistingServer: false`) musi być jedynym procesem na 4321, więc krok Playwright stoi **przed** krokiem smoke, który sam uruchamia `preview` w tle.

## Faza 1: Infrastruktura Playwright (`/10x-e2e-setup`)

### Overview

Instalujemy `@playwright/test` i Chromium, tworzymy `playwright.config.ts` i projekt `setup`, piszemy jeden zielony seed test i zapisujemy wszystko w `context/foundation/test-stack.md`. Wykonawcą jest `/10x-e2e-setup`, a ta faza ustala tylko oczekiwania wobec jego wyniku i commit.

### Changes Required:

#### 1. Zależność i skrypt

**File**: `package.json`, `package-lock.json`

**Intent**: Dodać `@playwright/test` do devDependencies i skrypt uruchamiający E2E, żeby lint i `astro check` (które obejmują `**/*`) rozwiązywały typy spec.

**Contract**: skrypt `"test:e2e": "playwright test"`, zgodny z nazewnictwem `test:integration`.

#### 2. Konfiguracja Playwright

**File**: `playwright.config.ts`

**Intent**: Konfiguracja wygenerowana przez skill z wykrytymi wartościami projektu.

**Contract**:
- `testDir: "tests/e2e"`, tylko projekt Chromium (plus `setup`);
- `PORT` z `E2E_PORT` z domyślnym 4321;
- `webServer` uruchamia `npm run build && npm run preview -- --port <PORT>` z `url: baseURL` i `reuseExistingServer: !process.env.CI`;
- `trace: "retain-on-failure"`, `screenshot: "only-on-failure"`, `retries: 0` (także w CI: retry ukryłby flakiness, a `on-first-retry` bez retry nie zapisuje trace);
- env (`SUPABASE_URL`, `SUPABASE_KEY`, `E2E_USERNAME`, `E2E_PASSWORD`) ładowane jawnie z `.env`.

Vitest (`tests/integration/**/*.test.ts`) nie może łapać `*.spec.ts`, a Playwright nie może łapać `tests/integration/**`.

#### 3. Auth setup i seed

**File**: `tests/e2e/auth.setup.ts`, `tests/e2e/seed.spec.ts`

**Intent**: Logowanie przez UI kontem `E2E_USERNAME` zapisuje `playwright/.auth/user.json`. Seed chroni jedno tanie ryzyko na poziomie przeglądarki, np. bramkę roli (zalogowany właściciel na `/agent` → 302 do `/owner`) albo dojście do panelu po zalogowaniu.

**Contract**: seed nie może zajmować miast `lublin`, `rzeszow` ani `zielona-gora` i nie może tworzyć ofert. Lokalne konto testowe zakłada skill przez `POST /api/auth/signup` (rola `owner`). Jego dane trafiają do `.env` (gitignored), a nazwy zmiennych bez wartości do `.env.example`.

#### 4. Ignorowane artefakty

**File**: `.gitignore`

**Intent**: Nie commitować sesji ani raportów.

**Contract**: dopisane `playwright/.auth/`, `.playwright-cli/`, `.playwright/` (jeśli powstaje), `test-results/`, `playwright-report/`.

#### 5. Rejestr stacku testowego

**File**: `context/foundation/test-stack.md`

**Intent**: Sekcja `## E2E` z wykrytym portem, poleceniem `webServer`, ścieżką seeda i sposobem uruchomienia (wynik skilla).

**Contract**: sekcja `## E2E`, którą czyta `/10x-e2e`.

### Success Criteria:

#### Automated Verification:

- Seed przechodzi na zimnym serwerze (nic nie nasłuchuje na 4321 przed startem): `npx playwright test tests/e2e/seed.spec.ts`
- Lint przechodzi: `npm run lint`
- Typy przechodzą: `npx astro check`
- Testy integracyjne nadal biorą tylko swoje pliki: `npm run test:integration`
- `git status --porcelain` nie pokazuje `playwright/.auth/`, `test-results/` ani `.env`

#### Manual Verification:

- Przegląd `tests/e2e/seed.spec.ts` (wzorzec dla kolejnych testów: lokatory ról, setup → action → assertion → cleanup) i `playwright.config.ts` przed commitem

**Implementation Note**: `/10x-e2e-setup` nie commituje. Po zielonych kryteriach odhacz wiersze Progress fazy 1 i zrób commit `test(testing-critical-path-e2e): phase 1 — playwright setup` razem z `plan.md`.

---

## Faza 2: Test ścieżki krytycznej (`/10x-e2e`)

### Overview

Piszemy `tests/e2e/critical-path.spec.ts` z dwoma `test()` na wspólnym seedzie. Każde z ryzyk #1, #2 i #3 ma asercję, która zawodzi przy jego materializacji, potwierdzoną celowym uszkodzeniem.

### Changes Required:

#### 1. Helpery E2E

**File**: `tests/e2e/helpers.ts` (nowy), `tests/integration/helpers.ts`

**Intent**:
- Zebrać seeding przez HTTP: signup z rolą w nowym kontekście przeglądarki, profil agenta przez `POST /api/agent/profile` (form z powtarzanymi `cities` i `propertyTypes`), sprzątanie przez `POST /api/account/delete`.
- Zebrać odczyt bazy: supabase-js z kluczem anon i `signInWithPassword`.
- Ponownie użyć `assertCitiesEmpty` i dopisać do jego komunikatu naprawczego wzorzec `e2e-%@example.com`.

**Contract**:
- Każdy POST wysyła `Origin: baseURL` i oczekuje 302 bez `?error=`.
- Helper odczytu zwraca `offers.status/price/description` oraz listę `invitations(agent_id, status)` dla oferty.
- Hosty inne niż lokalne są odrzucane, tak jak w `tests/integration/helpers.ts:47-50`.

#### 2. Spec ścieżki krytycznej

**File**: `tests/e2e/critical-path.spec.ts` (nowy)

**Intent**: Jeden plik, `test.describe.serial`. `beforeAll` zakłada konta A (owner), B (owner), P, T1, T2, F, I, O, Y i Z (sekwencyjnie, w tej kolejności agentów), uruchamia sondę pustych miast i zapisuje `user.id` każdego agenta. Na koniec A zakłada ofertę A2 (Zielona Góra, działka, 950 000 zł) przez `POST /api/owner/offers` z `Origin` i zapisuje jej id z `Location`. Dzięki temu drugi `test()` nie zależy od przebiegu pierwszego. Nagłówek pochodzenia: `// risk: #1 #2 #3 — test-plan.md §3 Phase 2`.

**Contract — `test("właściciel: top 3 z PRD → zaproszenie → odrzucenie → ponowne zaproszenie → przyjęcie; izolacja w UI")`:**

1. **A tworzy ofertę A1 w UI**: „Dodaj ofertę” → formularz (Lublin, mieszkanie, 500 000 zł, unikalny opis) → „Zapisz i pokaż agentów”. Oczekiwane: URL `/owner/offers/<id>?created=1` i „Zapisano ofertę”.
2. **Ryzyko #1 — top 3**: w sekcji „Najlepiej dopasowani agenci” `ol > li` ma dokładnie 3 elementy. Dla pozycji N=1..3 sprawdzamy „Agent N”, wynik `NN/100` i `input[name=agentId]` równe kolejno [P 100, T1 85, T2 85]. Brak `agentId` dla F, I i O w całym HTML. Brak komunikatu „mniej niż 3”.
3. *(usunięty: A2 powstaje w `beforeAll`; numeracja kroków bez zmian)*
4. **Zaproszenie P**: klik „Zaproś agenta 1”. Oczekiwane w UI: „Wysłano zaproszenie”, karta „Zaproszenie wysłane”, brak listy rankingu, „Edycja jest zablokowana…”. W bazie (sesja A): A1 `invited`, jedno zaproszenie `pending` dla P.
5. **Blokada edycji (#3)**: A wchodzi GET na `/owner/offers/<A1>/edit` → `?error=edit_locked`. Potem `request.post` na endpoint update ze zmienioną ceną → `?error=edit_locked`. W bazie `price` i `description` A1 są niezmienione.
6. **Izolacja przed odpowiedzią (#2)**:
   - kontrola pozytywna: P widzi A1 na `/agent` („Oczekuje na odpowiedź”) i na `/agent/offers/<A1>`;
   - kontrola negatywna: T2 (niezaproszony) dostaje na `/agent/offers/<A1>` status 404, kartę „Nie znaleziono oferty” i brak opisu A1 w HTML;
   - B dostaje na `/owner/offers/<A1>` i `/owner/offers/<A1>/edit` status 404, kartę „Nie znaleziono oferty” i brak opisu A1;
   - B na `/owner` nie widzi A1;
   - dodatek: A na `/agent/offers/<A1>` → przekierowanie na `/owner`.
7. **P odrzuca**: „Odrzuć” → „Tak, odrzuć”. Oczekiwane: `/agent?rejected=1` i „Odrzucono zaproszenie”, a `/agent/offers/<A1>` daje P 404. W bazie: A1 `seeking_agent`, zaproszenie P `rejected`.
8. **Ranking po odrzuceniu (#1 + #3)**: A na `/owner/offers/<A1>` widzi znów 3 `<li>`: [T1 85, T2 85, F 65]. `agentId` P nie występuje.
9. **Zaproszenie T1 i przyjęcie**: klik „Zaproś agenta 1” (T1). T1 na `/agent` nie widzi A2 (kontrola izolacji: zaproszony agent widzi tylko swoją ofertę), a bezpośredni URL `/agent/offers/<A2>` daje 404. Potem T1: „Przyjmij” → „Tak, przyjmij”. Oczekiwane: `?accepted=1`, „Przyjęto zaproszenie”, pigułki „Przyjęte” i „W obsłudze”. W bazie: A1 `in_progress`, dokładnie jedno `accepted` (T1), P nadal `rejected`.
10. **Druga próba przyjęcia (#3)**: `request.post` T1 z `response=accept` → 302 do `/agent?error=already_responded` i alert „Na to zaproszenie już odpowiedziano.”. Baza bez zmian (nadal jedno `accepted`, `in_progress`). Ta sama próba z kontekstu T2 → 404.
11. **Widok właściciela po przyjęciu**: A na `/owner/offers/<A1>` widzi kartę statusu (przyjęte / w obsłudze), bez rankingu i bez „Edytuj”. A na `/owner` widzi obie oferty (kontrola pozytywna do kroku 6).

**Contract — `test("oferta z mniej niż 3 dopasowaniami: agent z wynikiem 0 nie jest pokazywany")`:**

- A na `/owner/offers/<A2>`: dokładnie 1 `<li>` („Agent 1”, „70/100”, `agentId` = Y), widoczny komunikat „Dopasowanych agentów jest mniej niż 3…”, `agentId` Z nie występuje w HTML.

**Sprzątanie**: `afterAll` usuwa wszystkie 10 kont przez `POST /api/account/delete` z ich kontekstów i zbiera błędy razem, jak `deleteUsers`.

#### 3. Celowe uszkodzenia (krok VERIFY w `/10x-e2e`)

**File**: tymczasowe edycje, cofane po każdej próbie i niecommitowane

**Intent**: Pokazać, że każda asercja zawodzi przy materializacji ryzyka.

**Contract**:
- **#1 kolejność**: w `RankingList.astro` render odwróconej listy → czerwień w kroku 2.
- **#1 mapowanie**: ukryte `agentId` w każdym `<li>` bierze `ranking[0].agentId` → czerwień w kroku 2.
- **#1 filtr 0**: tymczasowa migracja, lokalnie i nigdy niecommitowana, która podmienia `rank_agents_for_offer` bez `where r.score > 0` → pierwszy `test()` zostaje zielony (A1 nie ma agenta z wynikiem 0 w top 3), czerwień tylko w drugim `test()` (Z na A2). Przywrócenie: `npx supabase db reset` (kasuje lokalne konta, uprzedzić użytkownika). Wariantu z `RankingList.astro` nie używamy, bo czerwieni krok 2 pierwszego testu, a nie filtr.
- **#2 izolacja**: przez `docker exec … psql`: `alter policy offers_select_own on public.offers using (true)` → czerwień w kroku 6 (B widzi A1). Przywrócenie: `alter policy offers_select_own on public.offers using (owner_id = (select auth.uid()))`.
- **#3 status**: w `src/pages/api/agent/invitations.ts` wywołanie RPC z `p_response: response === "accept" ? "reject" : "accept"` (endpoint przekazuje `response` bez mapowania) → czerwień w kroku 7: URL `?accepted=1` zamiast `/agent?rejected=1`, a przy asercji stanu bazy `in_progress` zamiast `seeking_agent`.

### Success Criteria:

#### Automated Verification:

- Spec przechodzi na zimnym serwerze: `npx playwright test tests/e2e/critical-path.spec.ts`
- Spec przechodzi 3 razy pod rząd bez flakiness: `npx playwright test tests/e2e/critical-path.spec.ts --repeat-each=3`. Uwaga na limit `sign_in_sign_ups = 100`/5 min: przy 429 odczekać.
- Każde celowe uszkodzenie z listy daje czerwień we wskazanym kroku, a po cofnięciu spec jest znów zielony
- Testy integracyjne nadal przechodzą (dopisany wzorzec `e2e-%` w helperze): `npm run test:integration`
- Lint i typy: `npm run lint && npx astro check`

#### Manual Verification:

- Przegląd spec: każdy krok z Contract ma asercję stanu (UI albo baza), nie tylko oczekiwanie na URL; wyrocznia w kodzie testu to stałe z tabeli w planie, a nie wartości odczytane z RPC
- Trace jednego przebiegu (`npx playwright test tests/e2e/critical-path.spec.ts --trace on`, potem `npx playwright show-report`) pokazuje sekwencję A → P → T2 → B → P → A → T1 bez nieoczekiwanych przekierowań

**Implementation Note**: commit `test(testing-critical-path-e2e): phase 2 — critical path e2e` razem z `plan.md`.

---

## Faza 3: CI i dokumentacja (`/10x-implement`)

### Overview

Podłączamy Playwright do joba `smoke` i aktualizujemy dokumenty, które dziś mówią „brak E2E”.

### Changes Required:

#### 1. Krok E2E w jobie smoke

**File**: `.github/workflows/ci.yml`

**Intent**: Uruchomić E2E na każdym PR na tym samym lokalnym Supabase. Krok stoi po zapisie `.env` i buildzie, a **przed** krokiem smoke, żeby `webServer` był jedynym procesem na 4321.

**Contract**: nowe kroki w jobie `smoke`:
- cache `~/.cache/ms-playwright` z kluczem po wersji `@playwright/test` z `package-lock.json`;
- `npx playwright install --with-deps chromium` (przy trafionym cache: `npx playwright install-deps chromium`);
- dopisanie do `.env` stałych, niesekretnych `E2E_USERNAME` i `E2E_PASSWORD` dla lokalnego stacku CI;
- konto `E2E_USERNAME` zakłada `auth.setup.ts` albo krok `curl` signup przed testami (wybór wykonawcy, zależny od tego, co wygenerował skill w fazie 1);
- `CI=true npx playwright test`;
- `actions/upload-artifact` z `playwright-report/` i `test-results/` przy `if: failure()`.

Podwójny build (`npm run build` przed smoke i w `webServer`) jest akceptowalny. Jeśli wykonawca chce go uniknąć, może w CI pominąć build w poleceniu `webServer` przez zmienną env, pod warunkiem że lokalny zimny start nadal buduje.

#### 2. Dokumentacja

**File**: `context/foundation/test-plan.md`, `CLAUDE.md`, `README.md`

**Intent**: Opisać nową warstwę w miejscach, które dziś mówią „brak E2E”.

**Contract**:
- `test-plan.md`: §3 wiersz Phase 2 → status `done` (albo odpowiednik używany w tabeli); §4 wiersz e2e → narzędzie, lokalizacja `tests/e2e/`, polecenie; §5 bramka e2e → aktywna w jobie `smoke`; §6.4 „Adding an e2e test” → krótki przepis (nowy kontekst na użytkownika, seed przez API z `Origin`, unikalne miasta, sonda pustych miast, odczyt bazy sesją, `/10x-e2e`).
- `CLAUDE.md`: Commands dostaje `npm run test:e2e`, a Testing zamiast „No test framework yet” wymienia vitest (integracja), testy SQL i Playwright (E2E).
- `README.md`: sekcja Skrypty dostaje `npm run test:e2e`, sekcja CI opisuje krok E2E w jobie smoke.

### Success Criteria:

#### Automated Verification:

- Składnia workflow jest poprawna: `npx --yes action-validator .github/workflows/ci.yml` albo zielony job na PR
- Job `smoke` na PR jest zielony i jego log pokazuje przejście `critical-path.spec.ts` (2 testy): `gh pr checks` / `gh run view --log`
- Lint, typy i build: `npm run lint && npx astro check && npm run build`

#### Manual Verification:

- Raz celowo czerwony przebieg w CI (np. tymczasowy commit z uszkodzeniem #1 na gałęzi, potem revert) wgrywa artefakt `playwright-report` z trace — zrzut przydatny do certyfikacji (M3)
- Dokumenty (§6.4 test-planu, CLAUDE.md Testing) są zrozumiałe dla kogoś, kto dodaje drugi test E2E

**Implementation Note**: commit `ci(testing-critical-path-e2e): phase 3 — e2e in smoke job + docs` razem z `plan.md`.

---

## Testing Strategy

### Unit Tests:

- Brak nowych: logika rankingu jest w SQL i ma testy w Phase 1.

### Integration Tests:

- Bez zmian zakresu. `tests/integration/helpers.ts` dostaje tylko dopisany wzorzec `e2e-%` w komunikacie sondy.

### E2E:

- `tests/e2e/seed.spec.ts`: wzorzec z fazy 1.
- `tests/e2e/critical-path.spec.ts`: ryzyka #1, #2, #3 według Contract fazy 2.

### Manual Testing Steps:

1. Lokalnie: `npx supabase start`, upewnić się, że nic nie nasłuchuje na 4321 (`lsof -nP -iTCP:4321 -sTCP:LISTEN`), potem `npm run test:e2e`. Oczekiwane: wszystkie testy zielone.
2. `npx playwright show-report`: przejrzeć kroki ścieżki głównej.
3. Na PR: job `smoke` zielony, a w logu widać krok Playwright.

## Performance Considerations

- 10 rejestracji, około 3 logowania supabase-js i konto E2E mieszczą się w limicie `sign_in_sign_ups = 100`/5 min razem z integracją (około 13) i smoke (około 14). Lokalne przebiegi pod rząd (`--repeat-each=3`) mogą dostać 429. Wtedy odczekać, nie podnosić limitu w `config.toml`.
- Instalacja Chromium w CI to szacunkowo 1–2 min bez cache.

## Migration Notes

Nie dotyczy: brak zmian schematu i danych produkcyjnych.

## References

- Research: `context/changes/testing-critical-path-e2e/research.md`
- Test plan: `context/foundation/test-plan.md` §2 (ryzyka #1–#3), §3 Phase 2, §6
- PRD reguła rankingu: `context/foundation/prd.md:106-112`
- Phase 1 (archiwum): `context/archive/2026-10-29-testing-ranking-and-isolation/plan.md:38`
- Wzorzec seedingu HTTP: `scripts/smoke.mjs:93-124`
- Helpery integracji: `tests/integration/helpers.ts:29-138`
- Job smoke: `.github/workflows/ci.yml:27-68`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Infrastruktura Playwright

#### Automated

- [x] 1.1 Seed przechodzi na zimnym serwerze
- [x] 1.2 Lint przechodzi
- [x] 1.3 Typy przechodzą (astro check)
- [x] 1.4 Testy integracyjne nadal biorą tylko swoje pliki
- [x] 1.5 git status nie pokazuje artefaktów Playwright ani .env

#### Manual

- [x] 1.6 Przegląd seed.spec.ts i playwright.config.ts przed commitem

### Phase 2: Test ścieżki krytycznej

#### Automated

- [ ] 2.1 critical-path.spec.ts przechodzi na zimnym serwerze
- [ ] 2.2 Spec przechodzi 3 razy pod rząd (--repeat-each=3)
- [ ] 2.3 Każde celowe uszkodzenie daje czerwień we wskazanym kroku
- [ ] 2.4 Testy integracyjne nadal przechodzą
- [ ] 2.5 Lint i typy

#### Manual

- [ ] 2.6 Przegląd spec: asercje stanu i wyrocznia ze stałych PRD
- [ ] 2.7 Trace przebiegu bez nieoczekiwanych przekierowań

### Phase 3: CI i dokumentacja

#### Automated

- [ ] 3.1 Składnia workflow poprawna
- [ ] 3.2 Job smoke na PR zielony z critical-path.spec.ts w logu
- [ ] 3.3 Lint, typy i build

#### Manual

- [ ] 3.4 Czerwony przebieg w CI wgrywa artefakt playwright-report
- [ ] 3.5 Dokumenty zrozumiałe dla autora drugiego testu E2E
