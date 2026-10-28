<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Oferta i ranking top 3

- **Plan**: context/changes/offer-top3-ranking/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3
- **Date**: 2026-10-28
- **Verdict**: APPROVED
- **Findings**: 0 critical, 2 warnings, 4 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | WARNING |

## Automated checks (2026-10-28)

| Check | Result |
|---|---|
| `supabase migration list --local` (3/3 applied) | PASS |
| `supabase/tests/offer-ranking.sql` | PASS (all checks passed) |
| `supabase/tests/agent-profile.sql` | PASS |
| `npm run db:types && git diff --exit-code` | PASS (no diff) |
| `npx astro check` / `npm run lint` | PASS (0 errors) |
| `npm run build` | PASS |
| `npm run smoke` (local) | PASS (all steps) |
| CI on main (PR #8 merge + epilogue) | PASS |
| Manual 2.4 (psql: status seeking_agent, owner_id = owner) | PASS |

## Findings

### F1 — Test SQL nie dowodzi rozstrzygania remisu po stażu

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: supabase/tests/offer-ranking.sql:136-137
- **Detail**: A (100 pkt, 25 lat) i B (100 pkt, 10 lat) mają ten sam `created_at` (`now()` w transakcji), a A ma mniejsze id. Kolejność A, B wychodzi też z `created_at asc, agent_id asc`. Usunięcie `r.experience_years desc` z `order by` (migracja l.97) nie zepsułoby testu. Plan wymagał przypadku „remis wyniku → więcej lat wyżej”.
- **Fix**: Zamienić staże A↔B (A 10, B 25) i oczekiwać kolejności B, A, D.
- **Decision**: FIXED (Fix now — staże A↔B, oczekiwane B, A, D; break-check: bez `experience_years desc` test pada)

### F2 — Lista ofert na /owner bez limitu

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/owner/index.astro:18-21
- **Detail**: `select ... order("created_at", desc)` bez `.limit()`. Indeks `(owner_id, created_at desc)` jest, ale strona SSR rośnie liniowo z liczbą ofert. Stronicowanie to S-04.
- **Fix**: Dodać `.limit(OWNER_OFFERS_LIMIT)` (stała 50 w `src/lib/services/offers.ts`); pełną listę zostawić S-04.
- **Decision**: FIXED (Fix now — `OWNER_OFFERS_LIMIT = 50` w serwisie, `.limit()` w panelu)

### F3 — RPC rankingu zwraca `agent_id` i pozwala wyliczyć profile agentów

- **Severity**: 💡 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20261028140000_create_offers.sql:70-102
- **Detail**: Właściciel może wołać `rank_agents_for_offer` przez PostgREST (anon key jest publiczny) i dostaje `agent_id`, staż i miasta. UI nie renderuje id. Bez limitu ofert właściciel może dodawać oferty w różnych miastach/typach/cenach i wyliczyć wszystkie pełne profile (UUID, staż, miasta). Bez e-maili i nazw, więc PRD Guardrails nie są naruszone, ale API ujawnia więcej niż UI.
- **Fix A ⭐ Recommended**: Zaakceptować i zapisać jako ryzyko (Addendum + wejście do test-planu M3); `agent_id` i tak jest potrzebny w S-05 do zaproszenia.
  - Strength: Zero zmian schematu teraz; S-05 nie musi dodawać kolumny z powrotem.
  - Tradeoff: Enumeracja (UUID + staż + miasta) zostaje możliwa do czasu limitu ofert.
  - Confidence: HIGH — dane nie są osobowe; RLS i bramka `owner_id` działają (test SQL + smoke).
  - Blind spot: Nie wiadomo jeszcze, jak S-05 będzie przekazywać agenta (id vs token pozycji).
- **Fix B**: Usunąć `agent_id` z `returns table` teraz (nowa migracja), wrócić do tematu w S-05.
  - Strength: API zwraca dokładnie to, co pokazuje UI.
  - Tradeoff: Dwie dodatkowe migracje (usuń teraz, dodaj w S-05) i regeneracja typów; nie usuwa wyliczania stażu/miast.
  - Confidence: MED — S-05 prawie na pewno będzie potrzebować identyfikatora agenta.
  - Blind spot: Nie sprawdzono, czy smoke/test SQL nie opierają się na `agent_id` (test SQL — tak, opiera się).
- **Decision**: ACCEPTED (Fix A — ryzyko zaakceptowane: dane nieosobowe, agent_id potrzebny w S-05; Addendum w planie, follow-up do test-planu M3)

### F4 — Błędy Supabase/RPC połykane bez logu, stan błędu zwraca 200

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/owner/offers/[id].astro:28-49, src/pages/owner/index.astro:22-27, src/pages/api/owner/offers.ts:58-60
- **Detail**: `catch {}` i `if (error)` bez `console.error`; wyjątek z `toOffer` (rozjazd słownika) ginie. Stan `error` na stronie oferty renderuje `ServerError` z HTTP 200. Użytkownik widzi dobry komunikat, ale produkcja błędu nie widzi. Spójne z resztą repo — dług do M3 (observability), nie regresja.
- **Fix**: Wpisać do follow-upów M3: `console.error` z `error.code` w tych gałęziach i status 503 dla stanu `error`.
- **Decision**: DEFERRED (follow-up do M3 observability — `follow-ups/review-fixes.md`)

### F5 — Reguły walidacji oferty zduplikowane w wyspie

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/owner/OfferForm.tsx:59 vs src/lib/services/offers.ts:10
- **Detail**: `AREA_M2_PATTERN` skopiowany ręcznie (z komentarzem o synchronizacji), zamiast przyjść propsem jak reszta limitów. Powód zrozumiały (import z `offers.ts` dociągnąłby zod do wyspy), ale to druga kopia reguły.
- **Fix**: Przenieść stałe i regex bez zod do `src/lib/offer-limits.ts` i importować w serwisie i wyspie.
- **Decision**: FIXED (Fix differently — wzorzec przekazywany propsem `limits.areaM2Pattern = AREA_M2_PATTERN.source` z `new.astro`; kopia w wyspie usunięta)

### F6 — Roadmapa: S-03 nadal `in-progress`

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: context/foundation/roadmap.md:50, :125
- **Detail**: Commit p1 przestawił S-03 na `in-progress` (zmiana spoza planu, nieszkodliwa). Po deployu `change.md` mówi `implemented`, roadmapa nadal `in-progress`.
- **Fix**: Przy `/10x-archive` sprawdzić, że S-03 przechodzi na `done`; jeśli skill tego nie robi, poprawić ręcznie w commicie archiwizacji.
- **Decision**: DEFERRED (follow-up do `/10x-archive` — `follow-ups/review-fixes.md`)
