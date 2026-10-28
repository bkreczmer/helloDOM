<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Odpowiedź na zaproszenie

- **Plan**: context/changes/invitation-response/plan.md
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
| Pattern Consistency | WARNING |
| Success Criteria | WARNING |

Automated checks run during review: migration up, 4 SQL tests, `db:types` diff, `astro check`, `lint`, `build`, local smoke, CI on PR #13 and the main merge: all green.

## Findings

### F1 — Tekst potwierdzenia niepowiązany z przyciskiem „Tak, …”

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/agent/InvitationResponse.tsx:95-104
- **Detail**: Fokus przechodzi na „Tak, przyjmij”/„Tak, odrzuć”, ale `<p>` z ostrzeżeniem („nie da się tego cofnąć”, „Oferta zniknie…”) nie jest powiązany z przyciskiem. Czytnik ekranu odczyta tylko nazwę przycisku przy nieodwracalnej akcji.
- **Fix**: `useId()` → `id` na `<p>` i `aria-describedby` na przycisku potwierdzenia (nowy opcjonalny prop w `SubmitButton`, przekazywany do `Button`).
- **Decision**: FIXED (useId + aria-describedby; nowy prop `describedBy` w SubmitButton)

### F2 — Slice niedomknięty: krok 3.6 i status w roadmapie

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: context/changes/invitation-response/plan.md (Progress 3.6); context/foundation/roadmap.md:53,186
- **Detail**: 3.6 (pełny przepływ na produkcji) nieodhaczony. Roadmapa ma S-06 jako `in-progress`, a tabela w l.186 nadal „Czeka na S-05” (S-07 „Czeka na S-06”). Produkcja odpowiada (200, `POST /api/agent/invitations` anonimowo → 302).
- **Fix**: Przejść przepływ zaproszenie → odrzucenie → zaproszenie kolejnego → przyjęcie na produkcji, odhaczyć 3.6, w roadmapie ustawić S-06 `done` i odświeżyć l.186–187.
- **Decision**: FIXED (roadmapa: S-06 done, tabela handoff S-06/S-07); 3.6 czeka na test produkcyjny użytkownika

### F3 — Blokada `for update` na cudzej ofercie przed sprawdzeniem zaproszenia

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20261028200000_invitation_response.sql:87-90
- **Detail**: Każdy zalogowany użytkownik może na chwilę zablokować dowolną ofertę (znając UUID), zanim funkcja sprawdzi, że ma do niej zaproszenie. Wynik to i tak `not_found`, nic nie wycieka; UUID nie do zgadnięcia, blokada trwa jedną krótką transakcję.
- **Fix**: Zaakceptować ryzyko i dopisać komentarz w migracji (kolejność blokad oferta → zaproszenie jest ważniejsza niż wczesny `exists`).
- **Decision**: ACCEPTED (UUID nie do zgadnięcia, blokada jednej krótkiej transakcji, wynik `not_found`; zastosowanej migracji nie edytujemy)

### F4 — Drobiazgi: `cn(className)` bez łączenia i `method="post"`

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/auth/SubmitButton.tsx:25; src/components/agent/InvitationResponse.tsx:86
- **Detail**: `cn()` z jednym argumentem nic nie łączy; pozostałe wyspy używają `method="POST"`.
- **Fix**: `className={className}` i `method="POST"`.
- **Decision**: FIXED

### F5 — Endpoint właściciela gubi błąd przy niepoprawnym `offerId`

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/api/owner/invitations.ts:17 vs src/pages/api/agent/invitations.ts:17-18
- **Detail**: Agent dostaje `/agent?error=<kod>` z komunikatem; właściciel ląduje na gołym `/owner` bez informacji. Wersja agenta jest lepsza; to kod sprzed tej zmiany.
- **Fix**: Zostawić na S-04 (zmiany w `/owner`) i dopisać tam jako drobną poprawkę.
- **Decision**: SKIPPED

### F6 — Test SQL: niepokryta gałąź i prefiks UUID ofert

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: supabase/tests/invitation-response.sql:38-40
- **Detail**: Gałąź „zaproszenie `pending`, ale oferta ≠ `invited`” → `already_responded` nie ma testu (w normalnym przepływie nieosiągalna). Oferty mają prefiks `0006` zamiast planowanego `0005` (bez kolizji z innymi testami).
- **Fix**: Bez zmian w kodzie; zapisać jako znane odstępstwo.
- **Decision**: ACCEPTED (gałąź nieosiągalna w normalnym przepływie; prefiks 0006 bez kolizji)
