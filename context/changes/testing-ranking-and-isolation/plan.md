# Testy rankingu top 3 i izolacji danych — plan implementacji

## Overview

Etap 1 z `context/foundation/test-plan.md` (ryzyka #1, #2, #6). Dodajemy runner (Vitest) i dwa pliki testów integracyjnych na lokalnym Supabase, uruchamiane z prawdziwymi sesjami użytkowników (klucz anon + JWT z `signUp`, nigdy `service_role`). Pierwszy sprawdza, że właściciel dostaje dokładnie ten top 3, który wynika z reguły PRD. Drugi sprawdza, że użytkownik B nie dosięga danych A przez REST ani RPC, a A swoje dane widzi. Break-check potwierdza, że celowo zepsuta reguła zapala testy na czerwono. Na końcu testy trafiają do CI.

## Current State Analysis

- Ranking liczy tylko `public.rank_agents_for_offer(p_offer_id)` (`supabase/migrations/20261028200000_invitation_response.sql:21-57`). Funkcja jest SECURITY DEFINER, właściciela rozpoznaje po `o.owner_id = auth.uid()` (`:43`), a sortuje po `score desc, experience_years desc, created_at asc, agent_id asc` (`:52`).
- Testy SQL (`supabase/tests/offer-ranking.sql`, `invitation-response.sql`) podszywają się pod użytkownika przez `set local role` + claims i ręcznie ustawiają `created_at`. Nie sprawdzają: stażu 5 i 15, remisu stażu po capie, mieszanej puli miasto/spoza miasta, niepełnego profilu przez brak ceny albo typu, kolejności zwróconej po odrzuceniu (research §3).
- Izolacja leży w całości w bazie: RLS na `profiles`, `offers`, `invitations` oraz RPC z bramką `auth.uid()` (research §4). Smoke sprawdza `/api/*` z cudzym id (404), ale **nikt nie wysyła prawdziwego JWT B do PostgREST** (research §5).
- Brak frameworka testów. Vitest 5.0.5 pasuje do `vite` 8.3.5 i Node 24 (research §6, `npm view vitest version` → 5.0.5).
- Lokalnie `enable_confirmations = false` (`supabase/config.toml:209`), więc `signUp` od razu zwraca sesję. Limit `sign_in_sign_ups = 30` / 5 min / IP (`:190`).
- Lokalna baza w chwili planowania: 1 kompletny agent, tylko w `warszawa`. Miasta `opole`, `krakow`, `torun`, `kielce` są puste.

## Desired End State

- `npm run test:integration` uruchamia `tests/integration/*.test.ts` na lokalnym Supabase. Każdy przebieg zakłada własne konta i je usuwa.
- Test rankingu sprawdza tabelę R1–R8 (niżej): dokładną kolejność `agent_id` i `score` z wyroczni policzonej z PRD, nie z kodu funkcji.
- Test izolacji sprawdza I1–I16: odmowa albo pustka dla B, kontrola pozytywna dla A.
- Brudna baza (kompletny agent w mieście testu) kończy test czytelnym błędem, a nie fałszywym zielonym.
- Cztery celowe zepsucia (BC1–BC4) dają czerwony test, a przywrócenie zielony. Wynik jest zapisany w planie.
- CI (job `smoke`) uruchamia testy integracyjne przed buildem.
- `test-plan.md` ma wypełnione §4 (Vitest), §6.1, §6.2, §6.5.

### Key Discoveries:

- `profiles.created_at default now()` bez grantu update (`20261028100000_add_agent_profile.sql:39-40`). Kolejne `signUp` to osobne transakcje, więc rejestracja sekwencyjna daje rosnącą datę. Remis „wcześniejsza rejestracja” sprawdzimy bez ręcznego ustawiania dat.
- Agent ustawia profil zwykłym `update` na `profiles` własną sesją (grant na 5 kolumn, `add_agent_profile.sql:40`). Właściciel tworzy ofertę przez `insert` bez `owner_id` i `status` (defaulty `auth.uid()` i `seeking_agent`, `create_offers.sql:10,18,43`).
- Sprzątanie bez `service_role`: `rpc('delete_own_account')` każdym kontem. Kaskady usuwają profil, oferty i zaproszenia (`20261028220000_account_deletion.sql:50-79`).
- Kody wyników RPC: `invite_agent` → `ok | not_found | offer_locked | agent_not_ranked` (`create_invitations.sql:59-66`); `respond_to_invitation` → `ok | not_found | already_responded | invalid_response` (`invitation_response.sql:58-70`).
- **Korekta researchu (§7):** `drop policy offers_select_own` *zaostrza* dostęp (RLS domyślnie odmawia), więc zapaliłaby się kontrola pozytywna, a nie test IDOR. Break-check izolacji dodaje politykę przepuszczającą wszystko (`using (true)`).
- Testy przez PostgREST widzą tylko zatwierdzone zmiany. Break-check musi więc zatwierdzić zepsucie w bazie i potem je cofnąć, a nie działać w transakcji z rollback.

## What We're NOT Doing

- Testów `/api/*` przez HTTP. Endpointy z cudzym id pokrywa smoke (`scripts/smoke.mjs:331,356,568,573,626,400,421,431`), a test REST/RPC sprawdza tę samą bramkę RLS, z której te endpointy korzystają.
- Komunikatu „mniej niż 3 agentów” w UI. Test sprawdza tylko, że RPC zwraca 1 wiersz (R7). Wygląd strony zostaje dla E2E z etapu 2.
- Ostatniego klucza sortowania `agent_id asc`: nie wynika z PRD, a prawdziwe sesje nie dają równych `created_at`.
- Ryzyk #3–#5 (test-plan §7).
- Zmian w schemacie, migracjach i kodzie aplikacji. Jedyne zmiany poza testami to `supabase/config.toml` (limit), dopisek w PRD, `ci.yml`, `package.json` i `test-plan.md`.
- Commitowanego skryptu break-check. Zepsucia robimy ręcznie przez `psql`, a wynik zapisujemy w planie.
- Testów jednostkowych i coverage.

## Implementation Approach

Dwa klienty supabase-js (`createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })`) na użytkownika. Konta rejestrowane sekwencyjnie w `beforeAll` i usuwane w `afterAll`. Jedna wspólna pula agentów w pliku rankingu, a na niej kilka ofert, bo każda rejestracja zjada budżet limitu auth. Wyrocznię liczymy ręcznie z PRD (`prd.md:108-112`) i wpisujemy jako stałe oczekiwane wartości. Test nie liczy wyniku tą samą formułą co funkcja.

Dla ochrony produkcji helper odmawia startu, jeśli host `SUPABASE_URL` to nie `127.0.0.1` ani `localhost`.

## Critical Implementation Details

- **Kolejność rejestracji = kolejność w tabeli puli.** Agentów A1–A8 rejestruj po kolei (`await` każdego `signUp`, bez `Promise.all`). Od tego zależy remis A3/A4 w R1.
- **Strażnik przed pulą.** Sprawdzenie czystości miast (`opole`, `krakow` w rankingu; `torun` w izolacji) robi właściciel *przed* rejestracją agentów testu, ofertą-sondą, która musi dać pusty ranking. Sondę potem usuwa.
- **Sprzątanie nie przykrywa błędu.** `afterAll` woła `delete_own_account` dla każdego założonego konta, także po nieudanym `beforeAll`. Błędy sprzątania zbiera i zgłasza, ale nie zastępuje nimi pierwotnego błędu.

## Faza 1: Runner i test rankingu

### Overview

Vitest z helperami do sesji i test rankingu z tabelą przypadków R1–R8. Do tego wyższy limit auth i dopisek w PRD o granicach ceny.

### Changes Required:

#### 1. Zależność i skrypt

**File**: `package.json`

**Intent**: Dodać Vitest jako runner i jedno polecenie do uruchamiania testów integracyjnych.

**Contract**: devDependency `vitest@^5.0.5` (przez `npm install -D`, z aktualizacją `package-lock.json`); skrypt `"test:integration": "vitest run"`.

#### 2. Konfiguracja Vitest

**File**: `vitest.config.ts` (nowy)

**Intent**: Uruchomić testy w Node bez configu Astro. Załadować `SUPABASE_URL` i `SUPABASE_KEY` z `.env` lokalnie albo z env procesu w CI.

**Contract**: `defineConfig` z `vitest/config`; `test.include: ["tests/integration/**/*.test.ts"]`, `environment: "node"`, `fileParallelism: false` (wspólny limit auth), `testTimeout: 30_000`, `hookTimeout: 120_000`. `test.env` to wybrane dwa klucze z `loadEnv(mode, process.cwd(), "")` z `vite`. Zmienne procesu mają pierwszeństwo przed `.env`.

#### 3. Helpery

**File**: `tests/integration/helpers.ts` (nowy)

**Intent**: Wspólny kod sesji, profili, ofert, strażnika czystości i sprzątania dla obu plików testów.

**Contract** (eksporty):
- `supabaseEnv(): { url, key }` — rzuca, gdy brak zmiennej albo host ≠ `127.0.0.1`/`localhost`.
- `signUpAs(role: "owner" | "agent", label: string): Promise<TestUser>` — `TestUser = { client: SupabaseClient<Database>; id: string; email: string }`. E-mail `it-${label}-${runId}@example.com`, gdzie `runId` jest wspólny dla przebiegu. `options.data.role`. Rzuca, gdy brak sesji.
- `anonClient(): SupabaseClient<Database>`.
- `setAgentProfile(user, profile)` — `update` na `profiles` po `id`, z `.select()`. Rzuca, jeśli zmieniony wiersz to nie dokładnie 1.
- `createOffer(owner, fields): Promise<string>` — `insert` z `.select("id").single()`, zwraca id. `transaction` jest `not null` (`sale | rent`, `create_offers.sql:13,28`), więc helper domyślnie wstawia `transaction: "sale"`. Korzystają z tego sonda, R1–R8 i oferta X.
- `rank(owner, offerId): Promise<{ agentId: string; score: number }[]>` — `rpc("rank_agents_for_offer")`, zachowuje kolejność wierszy.
- `assertCitiesEmpty(owner, cities: string[])` — oferta-sonda (`apartment`, `sale`, cena 1) w każdym mieście, ranking musi być pusty. Sondę usuwa, a przy niepustym rankingu rzuca błąd: `Lokalna baza ma kompletnych agentów w <miasto> — testy wymagają pustego miasta. Pozostałości testów usuniesz: docker exec supabase_db_10x-astro-starter psql -U postgres -c "delete from auth.users where email like 'it-%@example.com'". Ostateczność: npx supabase db reset (kasuje wszystkie lokalne konta).` Komentarz w helperze: sonda nie wykrywa agenta, który na niej ma wynik 0 (staż 0, inny typ, cena poza zakresem). Taki agent może dać fałszywy czerwony w R6/R7, ale nigdy fałszywy zielony.
- `deleteUsers(users: TestUser[])` — `rpc("delete_own_account")` dla każdego, zbiera błędy.

Typy z `src/db/database.types.ts` (import względny, bez aliasu `@/`), bo reguły `no-unsafe-*` z `strictTypeChecked` obejmują `tests/`.

#### 4. Test rankingu

**File**: `tests/integration/ranking.test.ts` (nowy)

**Intent**: Udowodnić ryzyko #1 z perspektywy właściciela. Dla każdej oferty RPC zwraca dokładnie oczekiwane `agent_id` i `score` w oczekiwanej kolejności.

**Contract**: `beforeAll`: właściciel O → `assertCitiesEmpty(O, ["opole", "krakow"])` → sekwencyjnie A1–A8 z profilami z tabeli puli. Jeden `it` na przypadek R1–R8 z asercją `toEqual` na tablicy `{ agentId, score }`. `afterAll`: `deleteUsers`.

**Pula agentów** (rejestracja w tej kolejności):

| Agent | Miasta | Typy | Cena min–max | Staż | Uwagi |
|---|---|---|---|---|---|
| A1 | opole | apartment | 300 000–500 000 | 10 | |
| A2 | opole | apartment | 300 000–500 000 | 15 | staż ponad cap |
| A3 | opole | house | 300 000–500 000 | 5 | |
| A4 | opole | apartment | 600 000–800 000 | 5 | rejestracja po A3 |
| A5 | opole | plot | 1–100 | 0 | |
| A6 | krakow | apartment, house, plot | 0–2 000 000 | 20 | idealny, ale inne miasto |
| A7 | opole | apartment | brak (null/null) | 10 | niepełny: brak ceny |
| A8 | opole | brak (`{}`) | 300 000–500 000 | 10 | niepełny: brak typu |

**Wyrocznia** (PRD `prd.md:110,112`: typ +35, cena w przedziale włącznie +35, staż 3 pkt/rok do 10 lat; sortowanie wynik ↓, staż ↓, rejestracja ↑; wynik 0 i niepełny profil nieobecne; najwyżej 3):

| Id | Oferta (miasto, typ, cena) | Oczekiwany top (agent wynik) | Co sprawdza |
|---|---|---|---|
| R1 | opole, apartment, 400 000 | A2 100, A1 100, A3 50 | remis wyniku → staż (15 > 10 po capie); remis wyniku i stażu → rejestracja (A3 przed A4); limit 3 (A4 50 wypada); staż 5 = 15 pkt; A5 = 0 nieobecny; A6 spoza miasta nieobecny mimo wyniku 100; A7, A8 nieobecni |
| R2 | opole, apartment, 300 000 | A2 100, A1 100, A3 50 | cena = `price_min` daje +35 |
| R3 | opole, apartment, 500 000 | A2 100, A1 100, A3 50 | cena = `price_max` daje +35 |
| R4 | opole, apartment, 299 999 | A2 65, A1 65, A4 50 | `price_min − 1` daje 0 za cenę |
| R5 | opole, apartment, 500 001 | A2 65, A1 65, A4 50 | `price_max + 1` daje 0 za cenę |
| R6 | opole, plot, 50 | A5 70, A2 30, A1 30 | staż 0 = 0 pkt (70, nie więcej); staż 10 i 15 = 30 |
| R7 | krakow, apartment, 400 000 | A6 100 (dokładnie 1 wiersz) | agent z miasta oferty; mniej niż 3 wyniki |
| R8 | opole, apartment, 400 000; O zaprasza A2 (`ok`), A2 odrzuca (`ok`) | A1 100, A3 50, A4 50; R1 nadal A2, A1, A3 | odrzucający wypada z tej oferty, kolejny wchodzi; odrzucenie nie wpływa na inną ofertę |

#### 5. Limit auth

**File**: `supabase/config.toml`

**Intent**: Zdjąć ryzyko 429 przy ~13 kontach testów + 14 żądaniach smoke i przy powtórkach break-checku. Dotyczy tylko lokalnego i CI Supabase; produkcja ma własne ustawienia w panelu.

**Contract**: `[auth.rate_limit] sign_in_sign_ups = 100` z komentarzem, dlaczego. Lokalnie wymaga `npx supabase stop && npx supabase start` (dane zostają). Przed restartem uprzedź użytkownika, bo na chwilę zatrzyma lokalną bazę.

#### 6. Dopisek do PRD

**File**: `context/foundation/prd.md`

**Intent**: Zapisać jako regułę produktu decyzję z planowania: granice przedziału ceny liczą się włącznie.

**Contract**: sekcja `## Business Logic`, zdanie o cenie (`:110`): „Cena daje 35 pkt, jeśli mieści się w przedziale agenta (granice włącznie), a 0 poza nim.”

### Success Criteria:

#### Automated Verification:

- `npm run test:integration` zielony lokalnie: 8 przypadków R1–R8
- Drugie uruchomienie zaraz po pierwszym też zielone (sprzątanie działa, brak 429)
- Po przebiegu lokalna baza nie ma kont `it-*@example.com` (`psql` przez `docker exec`)
- Strażnik działa: tymczasowy kompletny agent w `opole` (konto przez `POST /api/auth/signup` albo `signUp`) → test pada komunikatem „Lokalna baza ma kompletnych agentów w opole”; po usunięciu konta znów zielony
- Blokada hosta działa: `SUPABASE_URL=https://example.supabase.co npm run test:integration` kończy się błędem przed jakimkolwiek żądaniem
- `npm run lint` i `npx astro check` bez błędów

#### Manual Verification:

- Użytkownik porównuje tabelę wyroczni R1–R8 z `prd.md:108-112` i potwierdza, że oczekiwane wyniki wynikają z PRD

**Implementation Note**: Po zielonych kryteriach automatycznych zatrzymaj się na potwierdzenie tabeli wyroczni przez użytkownika, zanim przejdziesz do fazy 2.

---

## Faza 2: Test izolacji

### Overview

Test z czterema prawdziwymi sesjami i klientem anon. Każda ścieżka B → zasoby A przez REST albo RPC daje odmowę albo pustkę. W tym samym przebiegu A (i zaproszony agent) widzi swoje dane.

### Changes Required:

#### 1. Test izolacji

**File**: `tests/integration/isolation.test.ts` (nowy)

**Intent**: Udowodnić ryzyko #2: użytkownik bez uprawnień nie czyta ani nie zmienia cudzych ofert, zaproszeń i profili. Pusta odpowiedź liczy się jako dowód tylko obok kontroli pozytywnej.

**Contract**: `beforeAll` sekwencyjnie: właściciel A → `assertCitiesEmpty(A, ["torun"])` → właściciel B → agent G (`torun`, `apartment`, 300 000–500 000, staż 10) → agent H (`kielce`, kompletny profil, niezaproszony). A tworzy ofertę X (`torun`, `apartment`, 400 000) i zaprasza G (`invite_agent` → `ok`). `afterAll`: `deleteUsers`. Jeden `it` na wiersz (albo spójną grupę) z tabeli:

| Id | Kto | Ścieżka | Oczekiwane |
|---|---|---|---|
| I1 | A | `select offers id=X` | 1 wiersz (kontrola pozytywna) |
| I2 | A | `rpc rank_agents_for_offer(X)` | `[G]` (kontrola pozytywna) |
| I3 | A | `select invitations offer_id=X` | 1 wiersz, `agent_id = G` |
| I4 | G | `select offers id=X` | 1 wiersz (zaproszony widzi) |
| I5 | B | `select offers id=X` | `[]` |
| I6 | B | `update offers set description where id=X` | 0 wierszy; A czyta X bez zmiany `description` |
| I7 | B | `delete offers where id=X` | 0 wierszy; A nadal widzi X |
| I8 | B | `insert offers` z `owner_id = A` | błąd (brak grantu na `owner_id`); A nie ma nowej oferty |
| I9 | B | `rpc rank_agents_for_offer(X)` | `[]` |
| I10 | B | `rpc invite_agent(X, H)` | `not_found`; A widzi tylko zaproszenie G |
| I11 | B | `select invitations offer_id=X` | `[]` |
| I12 | B | `select profiles` (bez filtra) i `id=A` | tylko własny wiersz; `id=A` → `[]` |
| I13 | H | `select offers id=X`, `select invitations offer_id=X` | `[]`, `[]` |
| I14 | H | `rpc respond_to_invitation(X, "accept")` | `not_found`; A widzi X w statusie `invited`, zaproszenie G `pending` |
| I15 | G | `select profiles id=A`, `id=H`; `rpc rank_agents_for_offer(X)`; `update profiles where id=H` | `[]`, `[]`, `[]`, 0 wierszy; H czyta swój profil bez zmian |
| I16 | anon | `select offers`, `select profiles` | błąd uprawnień (`42501`) albo `[]`, bez żadnego wiersza |

Zaakceptowane ujawnienia, których test nie traktuje jako błąd: `owner_id` oferty widoczny dla zaproszonego agenta (agent-invitation F4) i dane agentów z RPC dla właściciela własnej oferty (offer-top3-ranking F3). Opisz je w komentarzu nad tabelą.

### Success Criteria:

#### Automated Verification:

- `npm run test:integration` zielony lokalnie: ranking i izolacja razem
- Po przebiegu brak kont `it-*@example.com` w lokalnej bazie
- `npm run lint` i `npx astro check` bez błędów

---

## Faza 3: CI, break-check i dokumentacja

### Overview

Testy integracyjne w jobie `smoke`, potwierdzenie przez celowe zepsucie (ryzyko #6) i wpisy w cookbooku planu testów.

### Changes Required:

#### 1. Krok CI

**File**: `.github/workflows/ci.yml`

**Intent**: Uruchamiać testy integracyjne w jedynym jobie z lokalnym Supabase, zaraz po testach SQL, przed buildem i smoke.

**Contract**: nowy krok `Run integration tests` po `Run database tests` (`:43-49`), przed `Check generated database types…`. Ustawia `SUPABASE_URL`/`SUPABASE_KEY` z `supabase.env` (`API_URL`/`ANON_KEY`) i uruchamia `npm run test:integration`.

#### 2. Break-check (bez commitowanego kodu)

**Intent**: Dowód, że testy łapią regresję reguły i RLS. Zepsucie zatwierdzasz w lokalnej bazie przez `docker exec supabase_db_10x-astro-starter psql -U postgres`, uruchamiasz testy, przywracasz i uruchamiasz je ponownie. Wynik każdego kroku (czerwony test + nazwa przypadku, potem zielony) zapisz w sekcji `## Break-check` na końcu planu, przed `## Progress`.

**Contract**:

| Id | Zepsucie | Oczekiwany czerwony | Przywrócenie |
|---|---|---|---|
| BC1 | `rank_agents_for_offer`: `experience_years desc` → `asc` | R1 (A1 przed A2) | ponowne wykonanie definicji funkcji z `20261028200000_invitation_response.sql:21-57` |
| BC2 | `rank_agents_for_offer`: `created_at asc` → `desc` | R1 (A4 zamiast A3) | jak BC1 |
| BC3 | `rank_agents_for_offer`: `between` → `o.price > p.price_min and o.price < p.price_max` | R2, R3 | jak BC1 |
| BC4 | `create policy offers_select_all on public.offers for select to authenticated using (true)` | I5 (i I13) | `drop policy offers_select_all on public.offers` |

Każde zepsucie robisz osobno (jedno naraz). BC1–BC3 uruchamiasz przez `npx vitest run tests/integration/ranking.test.ts`, a BC4 przez `npx vitest run tests/integration/isolation.test.ts`. Pełny przebieg ma ~13 rejestracji, a 9 przebiegów przekroczyłoby limit 100 na 5 minut. Czerwony liczy się tylko jako nieudana asercja na oczekiwanym przypadku. Błąd `beforeAll` albo 429 to nie dowód: wtedy odczekaj i powtórz. Po ostatnim przywróceniu pełny przebieg ma być zielony, a `supabase/tests/*.sql` też przechodzą.

#### 3. Plan testów

**File**: `context/foundation/test-plan.md`

**Intent**: Zapisać w cookbooku, jak dodać kolejny test rankingu i izolacji, żeby następny agent nie wymyślał wzorca od nowa.

**Contract**: §4 wiersz „unit + integration” → Vitest 5.0.5, `tests/integration/`, `npm run test:integration`, CI job `smoke`. §6.1 i §6.2: lokalizacja, plik referencyjny, zasady (wyrocznia z PRD jako stałe, pula + strażnik miasta, sekwencyjna rejestracja, kontrola pozytywna obok negatywnej, nigdy `service_role`, sprzątanie przez `delete_own_account`). §6.5: notatka etapu 1 (limit auth 100, korekta break-checku RLS z polityką `using (true)`). §3: status etapu 1 → `implemented`. `Last updated` → data.

### Success Criteria:

#### Automated Verification:

- BC1–BC4: każde zepsucie daje czerwony test na oczekiwanym przypadku, a przywrócenie zielony (wynik w sekcji `## Break-check`)
- Po break-checku `npm run test:integration` zielony, a `supabase/tests/*.sql` przechodzą przez `psql -v ON_ERROR_STOP=1`
- `npm run lint` bez błędów
- Na PR job `smoke` zielony z krokiem `Run integration tests` (`gh pr checks`, log kroku pokazuje R1–R8 i I1–I16)

---

## Testing Strategy

### Integration Tests:

- Ranking: R1–R8 na wspólnej puli A1–A8 (Faza 1).
- Izolacja: I1–I16 z sesjami A, B, G, H i anon (Faza 2).

### Manual Testing Steps:

1. Użytkownik porównuje tabelę R1–R8 z `prd.md:108-112` (Faza 1).

Reszta weryfikacji (strażnik, blokada hosta, sprzątanie, break-check, CI) jest automatyczna i wykonuje ją agent.

## Performance Considerations

13 rejestracji na przebieg, sekwencyjnie. Spodziewany czas to kilkanaście sekund lokalnie. `hookTimeout` 120 s zostawia zapas na CI.

## Migration Notes

Brak migracji. Zmiana `supabase/config.toml` wymaga jednorazowego restartu lokalnego Supabase (`npx supabase stop && npx supabase start`), bez utraty danych. CI startuje Supabase od zera, więc bierze nowy limit automatycznie.

## References

- Research: `context/changes/testing-ranking-and-isolation/research.md`
- Plan testów: `context/foundation/test-plan.md:46` (etap 1), §2 Risk Response Guidance
- Reguła rankingu: `context/foundation/prd.md:108-112`
- Funkcja rankingu: `supabase/migrations/20261028200000_invitation_response.sql:21-57`
- Wzorzec sesji i unikalnych e-maili: `scripts/smoke.mjs:7-13,93-130`
- Precedens break-checku: `context/archive/2026-10-28-offer-top3-ranking/reviews/impl-review.md:38-46`

## Break-check

Wykonane 2026-10-29 na lokalnej bazie. Zepsucie zatwierdzone przez `docker exec supabase_db_10x-astro-starter psql -U postgres`, przywrócenie BC1–BC3 z definicji zapisanej wcześniej przez `pg_get_functiondef`. Po BC3 definicja funkcji w bazie jest identyczna z oryginałem (`diff` pusty).

| Id | Zepsucie | Wynik na zepsutym kodzie | Po przywróceniu |
|---|---|---|---|
| BC1 | `experience_years desc` → `asc` | czerwony: R1, R2, R3, R4, R5, R6, R8 (7/8; R7 ma jednego agenta) | ranking 8/8 |
| BC2 | `created_at asc` → `desc` | czerwony: R1, R2, R3, R8 (remis A3/A4 przy 50 pkt) | ranking 8/8 |
| BC3 | `between` → `o.price > p.price_min and o.price < p.price_max` | czerwony: R2, R3 | ranking 8/8 |
| BC4 | `create policy offers_select_all on public.offers for select to authenticated using (true)` | czerwony: I5, I13 | `drop policy`; zostaje 5 oryginalnych polityk `offers`; izolacja 16/16 |

Każdy czerwony wynik to nieudana asercja `toEqual` na oczekiwanym przypadku (bez błędu `beforeAll` i bez 429).

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Runner i test rankingu

#### Automated

- [x] 1.1 `npm run test:integration` zielony lokalnie: 8 przypadków R1–R8 — 6ccd3a8
- [x] 1.2 Drugie uruchomienie zaraz po pierwszym też zielone (sprzątanie działa, brak 429) — 6ccd3a8
- [x] 1.3 Po przebiegu lokalna baza nie ma kont `it-*@example.com` — 6ccd3a8
- [x] 1.4 Strażnik działa: kompletny agent w `opole` → czytelny błąd; po usunięciu znów zielony — 6ccd3a8
- [x] 1.5 Blokada hosta działa: nie-localhost `SUPABASE_URL` → błąd przed żądaniem — 6ccd3a8
- [x] 1.6 `npm run lint` i `npx astro check` bez błędów — 6ccd3a8

#### Manual

- [x] 1.7 Użytkownik potwierdza tabelę wyroczni R1–R8 względem PRD — 6ccd3a8

### Phase 2: Test izolacji

#### Automated

- [x] 2.1 `npm run test:integration` zielony lokalnie: ranking i izolacja razem — b09ca17
- [x] 2.2 Po przebiegu brak kont `it-*@example.com` w lokalnej bazie — b09ca17
- [x] 2.3 `npm run lint` i `npx astro check` bez błędów — b09ca17

### Phase 3: CI, break-check i dokumentacja

#### Automated

- [x] 3.1 BC1–BC4: każde zepsucie czerwone na oczekiwanym przypadku, przywrócenie zielone — e6b6eb0
- [x] 3.2 Po break-checku testy integracyjne i `supabase/tests/*.sql` zielone — e6b6eb0
- [x] 3.3 `npm run lint` bez błędów — e6b6eb0
- [x] 3.4 Na PR job `smoke` zielony z krokiem `Run integration tests` — e6b6eb0
