<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Rejestracja z rolą właściciel/agent

- **Plan**: context/changes/role-based-signup/plan.md
- **Scope**: Full plan (ukończone fazy; faza 5 ma otwarte kroki ręczne 5.5 i 5.6)
- **Reviewed phases**: 1, 2, 3, 4
- **Date**: 2026-10-28
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 3 warnings, 5 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | WARNING |
| Safety & Quality    | WARNING |
| Architecture        | WARNING |
| Pattern Consistency | WARNING |
| Success Criteria    | WARNING |

## Automated checks (2026-10-28, HEAD e584f83)

- `npm run lint`: PASS
- `npx astro check`: PASS (0 errors, 0 warnings, 0 hints)
- `npm run build`: PASS
- `npm run db:types && git diff --exit-code src/db/database.types.ts`: PASS
- `grep encodeURIComponent src/pages/api/auth`, `grep import.meta.env.DEV confirm-email.astro`, `grep PROTECTED_ROUTES src CLAUDE.md AGENTS.md`: wszystkie puste (PASS)
- `npm run smoke` na `npm run preview` + lokalnym Supabase: PASS (23/23)
- `npx supabase db reset`: nie uruchomione (kasuje lokalne dane); migrację na czystej bazie stosuje job CI `smoke`

## Findings

### F1 — Link potwierdzający otwarty na innym urządzeniu kończy się mylącym komunikatem

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/pages/auth/callback.ts:19, src/lib/services/auth-errors.ts:25
- **Detail**: `exchangeCodeForSession` to flow PKCE: code verifier leży w ciasteczku przeglądarki, w której wysłano formularz rejestracji. Kliknięcie linku z e-maila w innej przeglądarce lub na telefonie da `link_expired`, choć Supabase już potwierdził e-mail. Komunikat „Link wygasł lub został już użyty. Zaloguj się albo zarejestruj ponownie.” zachęca do ponownej rejestracji, która skończy się `user_already_exists`. Wniosek z analizy flow, nie z testu.
- **Fix A ⭐ Recommended**: Zmienić tekst `link_expired` na wskazujący logowanie (np. „Link wygasł lub został już użyty. Jeśli potwierdziłeś już e-mail, zaloguj się.”)
  - Strength: Jedna linia w auth-errors.ts; usuwa zachętę do duplikatu konta.
  - Tradeoff: Użytkownik z innego urządzenia nadal nie ląduje od razu w panelu.
  - Confidence: HIGH — zmiana tylko tekstu z allowlisty.
  - Blind spot: Nie sprawdzono, czy Supabase potwierdza e-mail przed nieudaną wymianą kodu w tym scenariuszu.
- **Fix B**: Szablon e-maila z `token_hash` i `verifyOtp({ type: "email", token_hash })` w callbacku zamiast PKCE
  - Strength: Działa niezależnie od urządzenia; zalecany przez Supabase wariant dla SSR.
  - Tradeoff: Zmiana szablonu e-maila w panelu produkcyjnym i w config.toml, nowa ścieżka do przetestowania przez Mailpit.
  - Confidence: MED — wymaga weryfikacji z bieżącą wersją `@supabase/ssr`.
  - Blind spot: Konfiguracja szablonów na produkcji nie jest wersjonowana w repo.
- **Decision**: FIXED (Fix A; tekst neutralny płciowo: „Jeśli e-mail jest już potwierdzony, zaloguj się.”)

### F2 — Smoke porównuje Location przez startsWith i przepuszcza błędne przekierowania

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: scripts/smoke.mjs:113, scripts/smoke.mjs:71
- **Detail**: `actual.location.startsWith(expected.location)`. Krok „signin rejects wrong password” oczekuje prefiksu `/auth/signin?error=`, więc przejdzie także dla `unknown` i `unavailable` (Supabase leży). Kroki oczekujące `/auth/signin` (:48, :81, :95) przechodzą też dla `?error=unavailable` i `?error=no_profile`, czyli przy zepsutym zapytaniu o profil. Brak kroku dla `no_profile`.
- **Fix**: Porównywać `actual.location === expected.location` i w :71 oczekiwać `/auth/signin?error=invalid_credentials`.
- **Decision**: FIXED (smoke 23/23 po zmianie)

### F3 — Plan nie odzwierciedla zmian dodanych w trakcie i po merge

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: context/changes/role-based-signup/plan.md:160, :275-283, :98
- **Detail**: Zmiany są uzasadnione, ale plan ich nie zna: `src/pages/dashboard.ts` zamiast `dashboard.astro` (crash `astro-eslint-parser`); kody `link_expired` i `rate_limited` oraz aliasy w auth-errors.ts; nowy `src/pages/auth/callback.ts` i `emailRedirectTo` (d4717df); dodatkowy wpis `/auth/callback` w `additional_redirect_urls`; globalna zmiana `--rs-input-border` i nowy `--rs-focus-border` w global.css (dotyczy wszystkich pól, nie tylko rejestracji).
- **Fix**: Dopisać do planu sekcję „Addendum” z tymi pięcioma pozycjami i powodami.
- **Decision**: FIXED (sekcja Addendum w plan.md przed Progress)

### F4 — `/api/*` nie jest bramkowane, a reguła tego nie mówi

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architecture
- **Location**: src/lib/route-guard.ts:7, CLAUDE.md:26
- **Detail**: Middleware ładuje profil tylko dla `/dashboard`, `/owner/*`, `/agent/*`. Dla endpointów auth to poprawne, ale przyszłe endpointy (S-02/S-03) dostaną `locals.profile = null` i muszą same sprawdzać użytkownika i rolę. CLAUDE.md opisuje tylko strony.
- **Fix**: Dopisać w CLAUDE.md i AGENTS.md: „Endpointy w `/api/*` nie są bramkowane; każdy sprawdza `locals.user` i rolę z `profiles` sam.”
- **Decision**: FIXED (zdanie po angielsku w CLAUDE.md:26; AGENTS.md to symlink na CLAUDE.md)

### F5 — `emailRedirectTo` budowany z nagłówka Host

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/auth/signup.ts:30
- **Detail**: `${context.url.origin}/auth/callback` pochodzi z żądania. Nadużycie blokuje allowlista Redirect URLs w Supabase (produkcyjnej nie sprawdzono). Lokalnie `127.0.0.1:4321` nie jest na liście i cicho spada na `site_url`.
- **Fix**: Zostawić, ale potwierdzić, że produkcyjna lista Redirect URLs zawiera tylko domenę workers.dev (albo wprowadzić zmienną `PUBLIC_SITE_URL`).
- **Decision**: FIXED (differently: opcjonalna zmienna `SITE_URL` w `astro:env/server`, w runtime; signup używa `new URL("/auth/callback", SITE_URL ?? origin)`; README i .env.example zaktualizowane. Wymaga `npx wrangler secret put SITE_URL` na produkcji)

### F6 — Komentarz w eslint.config.js opisuje nieistniejące sprawdzenie w CI

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: eslint.config.js:82
- **Detail**: Komentarz mówi o „regeneration diff check”, ale `.github/workflows/ci.yml` nie uruchamia `npm run db:types` ani `git diff --exit-code`. Typy mogą się rozjechać z migracjami bez sygnału w CI.
- **Fix**: Dodać krok `npm run db:types && git diff --exit-code src/db/database.types.ts` do joba `smoke` (po `supabase start`).
- **Decision**: FIXED (krok „Check generated database types are up to date” w jobie smoke; do potwierdzenia na pierwszym runie CI, bo CI używa `supabase/setup-cli` w wersji `latest`, a lokalnie jest v2.117.0)

### F7 — Ikona błędu bez `aria-hidden`

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/auth/RoleChoice.tsx:72, src/components/auth/FormField.tsx
- **Detail**: `CircleAlert` przy komunikacie błędu jest dekoracyjna, a nie ma `aria-hidden="true"`. Ten sam wzorzec jest w FormField.
- **Fix**: Dodać `aria-hidden="true"` do `CircleAlert` w obu komponentach.
- **Decision**: DISMISSED (fałszywy alarm: lucide-react 1.45 dodaje `aria-hidden="true"` automatycznie, gdy ikona nie ma propów a11y — `node_modules/lucide-react/dist/esm/shared/src/build/buildLucideIconNode.mjs:48`)

### F8 — Nieaktualne statusy i niezacommitowany Progress

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: context/foundation/roadmap.md (S-01), context/changes/role-based-signup/plan.md:583-584
- **Detail**: PR #3 i hotfixy są na `main`, a S-01 w roadmapie ma `in-progress`. Kroki 5.5 i 5.6 są `[ ]`, choć lekcja w lessons.md opisuje wykonanie 5.6 po deployu. Zmiana plan.md (5.3 i SHA) nie jest zacommitowana.
- **Fix**: Po ponownym sprawdzeniu rejestracji na produkcji odhaczyć 5.5 i 5.6, zacommitować plan i zaktualizować S-01 w roadmapie.
- **Decision**: FIXED (użytkownik potwierdził 5.5 i 5.6; odhaczone w Progress, S-01 = done w roadmap.md. Commit pozostaje do wykonania)
