<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Zaproszenie agenta

- **Plan**: context/changes/agent-invitation/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3
- **Date**: 2026-10-28
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Evidence

- Drift: wszystkie zmiany z „Changes Required” faz 1–3 są MATCH. Nie ma MISSING, a żaden punkt z „What We're NOT Doing” nie został wdrożony. Dodatki są nieszkodliwe: typ `StatusTone`, eksporty `inviteSchema`/`isInviteResult`, mapowanie tonów pilli oraz wyeksportowany `oneOf` w `offers.ts`, na który plan pozwalał w fazie 3 §1.
- Automatyczne kontrole (2026-10-28, lokalnie):
  - `supabase/tests/*.sql`: 3/3 przechodzą.
  - `migration list --local`: 20261028180000 zastosowana.
  - `db:types` + `git diff --exit-code`: czysto.
  - `astro check`: 0 błędów.
  - `lint`: czysto.
  - `build`: OK.
  - `npm run smoke`: wszystkie kroki PASS.
  - CI na `main` (merge PR #11): success.
- Bezpieczeństwo:
  - `invite_agent`: `security definer`, `search_path=''`, bramka `auth.uid()`, `for update` przed kontrolami, `unique_violation` → `offer_locked`.
  - RLS bez rekursji.
  - `?error=` przez allowlistę.
  - CSRF: domyślne `checkOrigin`.
  - Kontrast pilli: ≥5.9:1 w obu motywach.

## Findings

### F1 — Usunięcie agenta zostawia ofertę na stałe w `invited`

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20261028180000_create_invitations.sql:13 (+ :106)
- **Detail**: `invitations.agent_id ... on delete cascade` kasuje zaproszenie, ale `offers.status` zostaje `invited`. Ranking i „Zaproś” są widoczne tylko przy `seeking_agent`, a `invite_agent` zwraca `offer_locked`, więc właściciel nie ma wyjścia z tego stanu. Plan świadomie odłożył to do S-07 („What We're NOT Doing”), ale opis S-07 w `context/foundation/roadmap.md:163-173` tego nie wymienia. Scenariusz grozi też wcześniej: konta testowe na produkcji usuwasz ręcznie w panelu. Test SQL sprawdza kaskadę tylko od strony oferty.
- **Fix A ⭐ Recommended**: Dopisać do S-07 w roadmapie wymóg „przywróć `seeking_agent` ofertom, których aktywne zaproszenie zniknęło”, a przy usuwaniu kont testowych na produkcji usuwać najpierw ofertę.
  - Strength: Zgodne z decyzją planu. Nie wymaga migracji ani `db push` teraz.
  - Tradeoff: Do czasu S-07 ręczne usunięcie agenta w panelu blokuje ofertę.
  - Confidence: HIGH — S-07 i tak musi sprzątać zaproszenia (roadmap:173).
  - Blind spot: Nie sprawdzono, czy na produkcji jest już oferta osierocona w ten sposób.
- **Fix B**: Trigger `after delete on invitations`, który cofa ofertę do `seeking_agent`, gdy nie ma już aktywnego zaproszenia, plus przypadek w teście SQL.
  - Strength: Usuwa problem u źródła, także przy usuwaniu w panelu.
  - Tradeoff: Nowa migracja, `db push` na produkcję i PR. Zmienia też semantykę, z którą S-06/S-07 będą pracować.
  - Confidence: MED — trigger musi pominąć kaskadę wywołaną usunięciem samej oferty.
  - Blind spot: Interakcja z przyszłym flow odrzucenia w S-06.
- **Decision**: FIXED (Fix A) — wymóg dopisany do S-07 w context/foundation/roadmap.md

### F2 — `StatusPill` łączy klasy przez `class:list`, nie `cn()`

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/ui/StatusPill.astro:28-32
- **Detail**: CLAUDE.md wymaga `cn()` do łączenia klas. Przy `class:list` klasa przekazana z zewnątrz, która koliduje z klasą tonu (np. `bg-*`), nie nadpisuje jej przewidywalnie. Dziś nikt nie przekazuje `class`, a `Card.astro` robi to samo.
- **Fix**: `class={cn("…", TONE_CLASSES[tone], className)}`.
- **Decision**: FIXED

### F3 — Ponowne zaproszenie odrzuconego agenta da mylące `offer_locked`

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architecture
- **Location**: supabase/migrations/20261028180000_create_invitations.sql:18, :102-103
- **Detail**: `unique (offer_id, agent_id)` blokuje drugie zaproszenie tego samego agenta. Po odrzuceniu (S-06) `unique_violation` zostanie zmapowane na „Do tej oferty wysłano już zaproszenie.”. Dziś ten stan jest nieosiągalny.
- **Fix**: Dopisać do S-06 w roadmapie: wykluczyć odrzuconych agentów z rankingu (PRD), co zamyka tę ścieżkę.
- **Decision**: FIXED — dopisane do Risk S-06 w context/foundation/roadmap.md

### F4 — Agent przez REST widzi UUID właściciela

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20261028180000_create_invitations.sql:32, :47-57
- **Detail**: Grant `select` na wszystkie kolumny `offers`/`invitations` pozwala agentowi pobrać PostgREST-em `owner_id`. To nie są dane osobowe: `profiles` ma tylko politykę „own”, więc UUID nie da się zamienić na e-mail. UI tego nie pokazuje.
- **Fix**: Zaakceptować. Ewentualnie w S-06 nadać grant kolumnowy albo zrobić widok.
- **Decision**: ACCEPTED — UUID bez PII (profiles tylko „own”), UI go nie pokazuje.
