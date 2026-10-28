# Rejestracja z rolą właściciel/agent — plan implementacji

## Overview

Użytkownik przy rejestracji wybiera na stałe rolę `owner` albo `agent`. Rola trafia do nowej tabeli `public.profiles` przez trigger na `auth.users`, a RLS pozwala czytać tylko własny wiersz. Middleware chroni panele `/owner/*` i `/agent/*` po prefiksie i sprawdza rolę. `/dashboard` przekierowuje na panel roli. Przy okazji zamykamy przeniesione z app-shell F2 (kody błędów i allowlist), F5 (hover pól), F6 (`zod` i `try/catch`) i F10 (confirm-email wg sesji). To slice S-01 z roadmapy (FR-001, FR-002).

## Current State Analysis

- Baza jest pusta: nie ma `supabase/migrations/`, typu `Database` ani `src/types.ts`. Klient `src/lib/supabase.ts:9` nie ma typu bazy.
- `src/middleware.ts:4,18`: lista `PROTECTED_ROUTES = ["/dashboard"]` i `startsWith` bez granicy segmentu, bez wiedzy o roli. `context.locals` ma tylko `user` (`src/env.d.ts:1-5`).
- Endpointy `src/pages/api/auth/signin.ts` i `signup.ts` (linie 6-20):
  - `form.get(...) as string`, bez `zod` i bez `try/catch`;
  - do `?error=` trafia gotowy polski tekst;
  - signin przekierowuje na `/`;
  - signup nie przekazuje `options.data`.
- Strony `signin.astro:6,13` i `signup.astro:6,13` przekazują surowy `?error=` do `ServerError`.
- `src/lib/services/auth-errors.ts:1-15` ma już mapę kodów Supabase na polskie teksty, tylko używa jej po złej stronie.
- `src/pages/auth/confirm-email.astro:6` wybiera komunikat po `import.meta.env.DEV`.
- `src/components/auth/FormField.tsx:6` (`inputBase`) nie ma stanu hover. `SignUpForm.tsx` nie ma pola roli. W `src/components/ui/` są tylko `Card.astro` i `button.tsx`.
- Nawigacja: `Sidebar.astro`, `Dock.astro` i `MobileNav.tsx` czytają statyczny `navConfig` z `src/components/shell/nav.ts:10`. Tam też jest `isActive` z granicą segmentu (`:15-17`).
- `AppLayout.astro:14-18` rzuca błąd, gdy brak użytkownika, i odsyła do `PROTECTED_ROUTES`. To samo zdanie stoi w `CLAUDE.md:26` i `AGENTS.md:26`.
- `scripts/smoke.mjs:38-59` ma 8 kroków. Opierają się na `/dashboard`, signupie bez roli, przekierowaniu signin na `/` i signupie na `/auth/confirm-email`.
- CI: job smoke robi `supabase start` na lokalnym Supabase (`.github/workflows/ci.yml:41`), które stosuje migracje z repo. Deploy (`:71-72`) nie migruje bazy.
- `context/foundation/infrastructure.md:82`: migracje na produkcji zatwierdza człowiek. `:81`: `wrangler rollback` nie cofa schematu. `:92`: każda zmiana RLS potrzebuje down migration.
- `supabase/config.toml`: `sql_paths = ["./seed.sql"]` (:65), ale pliku nie ma. `site_url = "http://127.0.0.1:3000"` (:154). `enable_confirmations = false` (:209).

## Desired End State

- Rejestracja wymaga wyboru roli. Konto bez poprawnej roli nie powstaje: odrzuca je zarówno `zod` w endpoincie, jak i trigger w bazie.
- Po rejestracji z sesją i po zalogowaniu użytkownik trafia na `/dashboard`, a stamtąd na `/owner` albo `/agent`. Bez sesji trafia na `/auth/confirm-email`, wariant „Sprawdź skrzynkę”.
- Wejście na panel cudzej roli przekierowuje na własny panel. Niezalogowany trafia na `/auth/signin`. Zalogowany bez profilu zostaje wylogowany i widzi komunikat.
- `?error=` niesie tylko kod. Nieznany kod pokazuje ogólny komunikat, a tekst z URL nigdy nie trafia do UI.
- Smoke w CI przechodzi dla obu ról. Migracja jest na produkcji przed merge.

Weryfikacja: `npm run lint`, `npx astro check`, `npm run build`, `npm run smoke` na lokalnym Supabase, ręczne kroki z faz i ręczny check RLS w SQL.

### Key Discoveries:

- Wzorzec triggera Supabase: `security definer set search_path = ''`, `after insert on auth.users`. Wyjątek w triggerze wycofuje utworzenie użytkownika, a `signUp` zwraca błąd (research §1).
- `raw_user_meta_data` może zmienić sam użytkownik, więc rolę czytamy z niego tylko w triggerze. Autoryzacja opiera się wyłącznie na `profiles.role` (research §1).
- Od 2026-10-30 nowe tabele w `public` nie dostają automatycznie grantów Data API, więc granty muszą być jawne w migracji (research §1, changelog Supabase 45329).
- `isActive` w `nav.ts:15-17` to gotowy predykat prefiksu z granicą segmentu.
- Lessons: kontrast ramek i ikon elementów interaktywnych ≥3:1 w obu motywach; krok ręczny odhaczamy dopiero po wywołaniu stanu w przeglądarce.

## What We're NOT Doing

- Edycja profilu, pola agenta, słownik miast i typów: to S-02.
- Polityki pozwalające czytać cudze profile (ranking): to S-02/S-03.
- Usuwanie konta (FR-012): to osobny slice. Tu tylko `on delete cascade`.
- Migracje w CI (`db push` w jobie deploy) i sekrety Supabase CLI w GitHub. Wdrożenie jest ręczne.
- pgTAP i framework testów. RLS weryfikujemy smoke testem i ręcznym SQL.
- Backfill profili dla istniejących kont na produkcji. Konta testowe użytkownik usuwa ręcznie.
- Reset hasła (FR-014), zmiana roli, zmiana `site_url` produkcji w panelu Supabase.
- Przepisanie `ThemeToggle` i inne pominięte pozycje z app-shell review.

## Implementation Approach

Kolejność: schemat, potem endpointy, potem routing, potem UI, na końcu domknięcie testów i wdrożenie. Każda faza aktualizuje te kroki `scripts/smoke.mjs`, których zachowanie zmienia, żeby CI na PR było zielone po każdym commicie.

Od fazy 1 do fazy 4 formularz w przeglądarce nie wysyła roli, więc rejestracja przez UI na branchu nie działa. Działa przez smoke i `curl`. To akceptowane, bo zmiana jest jedna i jeden merge.

Rolę przechowujemy w tabeli, a nie w JWT. Middleware czyta profil jednym zapytaniem objętym RLS, tylko dla ścieżek bramkowanych.

## Critical Implementation Details

- **Kolejność wdrożenia:** `db push` na produkcję idzie przed merge do `main`. Od tej chwili do końca deployu (job `deploy`) stary kod na produkcji nie wysyła roli, więc rejestracja zwraca błąd. To świadoma decyzja: trigger odrzuca brak roli od razu. Merge robimy zaraz po `db push`.
- **Brak profilu:** middleware przed przekierowaniem woła `supabase.auth.signOut()`, żeby wyczyścić ciasteczka. Inaczej `/auth/signin` przekierowywałby z powrotem w pętli, jeśli kiedyś dodamy auto-redirect zalogowanych.

## Phase 1: Schemat i typy

### Overview

Pierwsza migracja: `public.profiles`, trigger tworzący profil z roli w metadanych, RLS i granty. Do tego porządki w `config.toml` i typy TypeScript. Endpoint signup przekazuje rolę, żeby smoke pozostał zielony.

### Changes Required:

#### 1. Migracja `profiles`

**File**: `supabase/migrations/<YYYYMMDDHHmmss>_create_profiles.sql` (przez `npx supabase migration new create_profiles`)

**Intent**: Tworzy tabelę ról i jedyne źródło prawdy o roli. Profil powstaje atomowo z kontem, a brak lub zła rola odrzuca rejestrację.

**Contract**:
- `public.profiles`: `id uuid primary key references auth.users(id) on delete cascade`, `role text not null check (role in ('owner','agent'))` bez wartości domyślnej, `created_at timestamptz not null default now()`.
- `alter table … enable row level security`.
- Jedna polityka `profiles_select_own`: `for select to authenticated using ((select auth.uid()) = id)`. Bez polityk insert, update i delete, bo rola jest stała.
- Granty: `grant select on public.profiles to authenticated`; `grant all on public.profiles to service_role`; nic dla `anon`. Przed grantami `revoke all on public.profiles from anon, authenticated`, żeby wynik nie zależał od domyślnych grantów projektu.
- `public.handle_new_user()`: `returns trigger language plpgsql security definer set search_path = ''`. Wstawia `(new.id, new.raw_user_meta_data ->> 'role')`. Bez `coalesce`, więc `null` lub zła wartość łamie constraint i rejestracja przepada. `revoke execute … from public, anon, authenticated`.
- Trigger `on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user()`.
- Na końcu pliku blok komentarza `-- down:` z SQL cofającym (drop trigger, drop function, drop table), zgodnie z `infrastructure.md:92`.

#### 2. Konfiguracja lokalnego Supabase

**File**: `supabase/config.toml`, `supabase/seed.sql`

**Intent**: Usuwa ostrzeżenie o brakującym seedzie i nieaktualny adres dev.

**Contract**: Pusty `supabase/seed.sql` z komentarzem, że seed jest celowo pusty. `site_url = "http://localhost:4321"` i `additional_redirect_urls = ["http://localhost:4321"]`.

#### 3. Typy bazy i domeny

**File**: `src/db/database.types.ts` (wygenerowany), `src/types.ts`, `src/lib/supabase.ts`, `package.json`, `eslint.config.js`, `.prettierignore` (nowy)

**Intent**: Typowany klient i jeden typ roli używany przez endpointy, middleware i UI.

**Contract**:
- Skrypt `"db:types": "supabase gen types typescript --local > src/db/database.types.ts"`. Plik generujemy i commitujemy. `src/db/database.types.ts` trafia bezwarunkowo do ignores w `eslint.config.js` i do `.prettierignore`: lint-staged uruchamia `eslint --fix` (z `eslint-plugin-prettier`, `consistent-type-definitions`, `array-type`), który przepisałby wygenerowany plik i wywrócił sprawdzenie `git diff --exit-code`. Sprawdzenie 1.2 uruchamiamy po commicie pliku (plik nieśledzony przechodzi `git diff` trywialnie).
- `src/types.ts` eksportuje `ROLES = ["owner","agent"] as const`, `type Role` i `type Profile` (wiersz `profiles`, oparty na `Database`).
- `createServerClient<Database>(…)`.

#### 4. Signup przekazuje rolę (przejściowo)

**File**: `src/pages/api/auth/signup.ts`

**Intent**: Trigger wymaga roli, więc endpoint musi ją przekazać już teraz, żeby smoke przechodził. Pełną walidację wprowadza faza 2.

**Contract**: `signUp({ email, password, options: { data: { role } } })`, gdzie `role` pochodzi z pola formularza `role`.

#### 5. Smoke wysyła rolę

**File**: `scripts/smoke.mjs`

**Intent**: Krok „signup creates account” dostaje `role: "owner"`.

**Contract**: Formularz signup ma pola `email`, `password` i `role`. Pozostałe kroki bez zmian.

### Success Criteria:

#### Automated Verification:

- Migracja stosuje się na czystej bazie: `npx supabase db reset`
- Typy się generują i są aktualne: `npm run db:types && git diff --exit-code src/db/database.types.ts`
- Lint, typy i build przechodzą: `npm run lint && npx astro check && npm run build`
- Smoke przechodzi na lokalnym Supabase: `npm run smoke`

#### Manual Verification:

- W Studio (`http://localhost:54323`) po smoke'u w `public.profiles` jest wiersz z `role = owner` dla konta smoke, a tabela ma włączony RLS i jedną politykę select
- `curl -X POST` na `/api/auth/signup` bez pola `role` kończy się przekierowaniem z `?error=`, a w Authentication nie pojawia się nowy użytkownik

**Implementation Note**: Po automatycznej weryfikacji zatrzymaj się i poczekaj, aż człowiek potwierdzi kroki ręczne.

---

## Phase 2: Endpointy auth

### Overview

Endpointy waliduje `zod` i chroni `try/catch`, błędy wędrują jako kody, a strony mapują je przez allowlistę (F2, F6). Signup decyduje o przekierowaniu po sesji (F10). Signin kieruje na `/dashboard`.

### Changes Required:

#### 1. Kody błędów i allowlist

**File**: `src/lib/services/auth-errors.ts`

**Intent**: Jedno miejsce, które zamienia błąd na kod (po stronie endpointu) i kod na polski komunikat (po stronie strony). Dowolny tekst z URL nie może trafić do UI.

**Contract**:
- `type AuthErrorCode` to zamknięty zbiór: `invalid_credentials`, `user_already_exists`, `email_not_confirmed`, `weak_password`, `invalid_input`, `unavailable`, `no_profile`, `unknown`.
- `toAuthErrorCode(error: { code?: string }): AuthErrorCode` zwraca kod Supabase, jeśli jest w zbiorze, a w przeciwnym razie `unknown`.
- `authErrorMessage(code: string | null): string | null` zwraca `null` dla braku kodu, polski tekst dla kodu z allowlisty i ogólny komunikat dla każdego innego ciągu.
- `toPolishAuthError` i `AUTH_UNAVAILABLE_MESSAGE` usuwamy, kiedy nie mają już użyć.
- Nowe teksty:
  - `invalid_input`: „Sprawdź poprawność danych w formularzu”;
  - `unavailable`: obecny tekst niedostępności;
  - `no_profile`: „Twoje konto nie ma przypisanej roli. Skontaktuj się z nami.” (bez „zarejestruj się ponownie”, bo e-mail nadal istnieje w `auth.users` i ponowna rejestracja kończy się `user_already_exists`);
  - `unknown`: obecny fallback.

#### 2. Schematy wejścia

**File**: `src/lib/services/auth-schemas.ts` (nowy)

**Intent**: Walidacja serwerowa zgodna z walidacją klienta, oparta na `z` z `astro/zod` (CLAUDE.md).

**Contract**:
- `signInSchema = { email: poprawny e-mail (trim), password: niepusty string }`.
- `signUpSchema = { email, password: min 6 znaków (jak `MIN_PASSWORD_LENGTH` w `SignUpForm.tsx:9`), role: z.enum(ROLES) }`. `confirmPassword` jest walidowane tylko na kliencie.
- Wywołujący używają `safeParse(Object.fromEntries(formData))`.
- API e-maila (`z.email()` albo `z.string().email()`) dobieramy do wersji zod eksportowanej przez `astro/zod`.

#### 3. Endpointy signin i signup

**File**: `src/pages/api/auth/signin.ts`, `src/pages/api/auth/signup.ts`

**Intent**: Żadna ścieżka nie kończy się nieobsłużonym 500. Wynik to zawsze przekierowanie.

**Contract**:
- `formData()`, `safeParse` i wywołania Supabase są w `try/catch`.
- Błędy: wyjątek z `formData()` (np. body JSON rzuca `TypeError`) i nieudany parse dają `?error=invalid_input`, brak klienta `?error=unavailable`, błąd Supabase `?error=<toAuthErrorCode>`, wyjątek z wywołania Supabase `?error=unknown`. `formData()` łapiemy osobno, żeby nie trafił do ogólnego `unknown`.
- Sukces signin kieruje na `/dashboard`.
- Sukces signup: gdy `data.session` istnieje, `/dashboard`; gdy jest `null`, `/auth/confirm-email`.

#### 4. Strony auth

**File**: `src/pages/auth/signin.astro`, `src/pages/auth/signup.astro`, `src/pages/auth/confirm-email.astro`

**Intent**: Strony pokazują tylko komunikaty z allowlisty. confirm-email ma jeden wariant.

**Contract**:
- `serverError={authErrorMessage(Astro.url.searchParams.get("error"))}`.
- confirm-email: usunąć `import.meta.env.DEV` i wariant „Konto utworzone”. Zostaje tylko „Sprawdź skrzynkę” (ikona `MailCheck`).

#### 5. Smoke po nowych przekierowaniach

**File**: `scripts/smoke.mjs`

**Intent**: Dopasować oczekiwania do F10 i nowego celu signin.

**Contract**:
- Lokalny Supabase ma wyłączone potwierdzanie, więc signup oczekuje `302 → /dashboard`, a smoke zachowuje ciasteczka.
- Signin z dobrym hasłem oczekuje `302 → /dashboard`.
- Nowy krok: signup bez roli oczekuje `302 → /auth/signup?error=invalid_input`.

### Success Criteria:

#### Automated Verification:

- Lint, typy i build: `npm run lint && npx astro check && npm run build`
- Smoke przechodzi: `npm run smoke`
- Żaden endpoint nie przekazuje tekstu w `?error=`: `grep -rn "encodeURIComponent" src/pages/api/auth` zwraca pusty wynik
- Brak gałęzi DEV w confirm-email: `grep -n "import.meta.env.DEV" src/pages/auth/confirm-email.astro` zwraca pusty wynik

#### Manual Verification:

- `/auth/signin?error=Konto%20zablokowane` pokazuje ogólny komunikat „Coś poszło nie tak…”, a nie tekst z URL
- `/auth/signin?error=invalid_credentials` pokazuje „Nieprawidłowy e-mail lub hasło”
- `curl -X POST -H "Content-Type: application/json" -d '{}'` na `/api/auth/signin` daje `302` z `?error=invalid_input`, a nie 500
- Logowanie złym hasłem w przeglądarce pokazuje polski komunikat z mapy

**Implementation Note**: Po automatycznej weryfikacji zatrzymaj się i poczekaj, aż człowiek potwierdzi kroki ręczne.

---

## Phase 3: Middleware i panele ról

### Overview

Bramkowanie po prefiksach z rolą, profil w `locals`, obsługa braku profilu, `/dashboard` jako zwrotnica, panele `/owner` i `/agent` oraz nawigacja zależna od roli.

### Changes Required:

#### 1. Reguły tras

**File**: `src/lib/route-guard.ts` (nowy)

**Intent**: Jedna definicja, które ścieżki są bramkowane i dla jakiej roli. Zastępuje listę `PROTECTED_ROUTES`.

**Contract**:
- `ROLE_PREFIXES: Record<Role, string> = { owner: "/owner", agent: "/agent" }`.
- `GATED_PATHS = ["/dashboard", ...Object.values(ROLE_PREFIXES)]`.
- `matchesPrefix(pathname, prefix)` ma tę samą semantykę co `isActive` (`pathname === prefix || pathname.startsWith(prefix + "/")`); `isActive` w `nav.ts` może go reużyć.
- `requiredRole(pathname): Role | null`.
- `isGated(pathname): boolean`.
- `homeFor(role): string` zwraca prefiks roli.

#### 2. Middleware

**File**: `src/middleware.ts`, `src/env.d.ts`

**Intent**: Dla ścieżek bramkowanych middleware wymaga sesji i profilu, a na cudzym prefiksie kieruje na własny panel.

**Contract**:
- `App.Locals` dostaje `profile: Profile | null`.
- `user` ustawiamy jak dotąd. Gdy `isGated(pathname)`:
  - brak użytkownika: redirect `/auth/signin`;
  - jest użytkownik: `select id, role, created_at from profiles where id = user.id` (`maybeSingle`);
  - błąd zapytania (`error`): redirect `/auth/signin?error=unavailable` bez `signOut()`, bo przejściowy błąd bazy nie może kasować sesji;
  - brak profilu (`data === null`, bez błędu): `signOut()` i redirect `/auth/signin?error=no_profile`;
  - `requiredRole(pathname)` różna od `profile.role`: redirect `homeFor(profile.role)`.
- Ścieżki niebramkowane nie pytają o profil (`profile = null`).

#### 3. Zwrotnica i panele

**File**: `src/pages/dashboard.astro`, `src/pages/owner/index.astro` (nowy), `src/pages/agent/index.astro` (nowy)

**Intent**: `/dashboard` nie ma własnej treści i przekierowuje wg roli. Każda rola ma swój panel w powłoce.

**Contract**:
- `dashboard.astro`: `const { profile } = Astro.locals; if (!profile) throw new Error(…)` (jak guard w `AppLayout`), potem `return Astro.redirect(homeFor(profile.role))`. Middleware gwarantuje, że profil istnieje, ale `profile: Profile | null` w strict TS wymaga zawężenia.
- `/owner`: `AppLayout title="Panel właściciela"`, karta powitalna z e-mailem i zdaniem, że tu pojawią się oferty.
- `/agent`: `AppLayout title="Panel agenta"`, karta z e-mailem i zdaniem o zaproszeniach i profilu.
- Treść stron to placeholdery zgodne z obecnym `dashboard.astro`.

#### 4. Nawigacja wg roli i guard w layoucie

**File**: `src/components/shell/nav.ts`, `Sidebar.astro`, `Dock.astro`, `MobileNav.tsx`, `AppTopbar.astro`, `src/layouts/AppLayout.astro`

**Intent**: Powłoka pokazuje pozycje właściwe dla roli. Guard w layoucie odwołuje się do nowej reguły.

**Contract**:
- `navFor(role: Role): NavItem[]` zastępuje stały `navConfig`. Na razie jedna pozycja „Panel” z `href = homeFor(role)`.
- `AppLayout` wymaga `user` i `profile` i rzuca błąd z komunikatem: „page must live under a gated prefix in src/lib/route-guard.ts”.
- `AppLayout` przekazuje `role` do `Sidebar`, `Dock` i `AppTopbar`, a `AppTopbar` dalej do `MobileNav` (prop `role`).
- Linki marki w powłoce (`AppTopbar.astro:20`, `Sidebar.astro:14`, `MobileNav.tsx:99`) zmieniają `href="/dashboard"` na `homeFor(role)`. `src/pages/index.astro:18` zostaje przy `/dashboard`, bo strona publiczna nie zna profilu.

#### 5. Dokumentacja dla agentów

**File**: `CLAUDE.md`, `AGENTS.md`

**Intent**: Usunąć odwołanie do `PROTECTED_ROUTES`.

**Contract**: Linia 26 w obu plikach: middleware ustawia `locals.user` i `locals.profile`, a bramkowane prefiksy i role są w `src/lib/route-guard.ts`. Nowa strona w powłoce ma leżeć pod `/owner/*` albo `/agent/*`.

#### 6. Smoke dla routingu

**File**: `scripts/smoke.mjs`

**Intent**: Dopasować kroki z `/dashboard` do zwrotnicy.

**Contract**:
- „dashboard renders for signed-in user” zmienia się na: `/dashboard` daje `302 → /owner`, a `/owner` daje `200`.
- Kroki anonimowe na `/dashboard` zostają (`302 → /auth/signin`).

### Success Criteria:

#### Automated Verification:

- Lint, typy i build: `npm run lint && npx astro check && npm run build`
- Smoke przechodzi: `npm run smoke`
- `PROTECTED_ROUTES` nie istnieje: `grep -rn "PROTECTED_ROUTES" src CLAUDE.md AGENTS.md` zwraca pusty wynik

#### Manual Verification:

- Zalogowany owner: `/dashboard` prowadzi na `/owner`, `/agent` i `/agent/cokolwiek` też prowadzą na `/owner`
- `/ownerx` daje 404 i nie jest bramkowane
- Po usunięciu wiersza profilu w Studio wejście na `/owner` wylogowuje i pokazuje na `/auth/signin` komunikat `no_profile`. Ponowne wejście na `/owner` przekierowuje na signin (sesja wyczyszczona)
- Sidebar, Dock i MobileNav pokazują aktywną pozycję „Panel” na `/owner` w obu motywach, na 360px i na desktopie

**Implementation Note**: Po automatycznej weryfikacji zatrzymaj się i poczekaj, aż człowiek potwierdzi kroki ręczne.

---

## Phase 4: Formularz rejestracji

### Overview

Wybór roli jako dwie karty radio w `SignUpForm` i hover pól (F5). Od tej fazy rejestracja przez UI działa end-to-end.

### Changes Required:

#### 1. Karty roli

**File**: `src/components/auth/RoleChoice.tsx` (nowy)

**Intent**: Wybór roli, której nie da się później zmienić, z opisem przy każdej opcji. Natywne radio zapewnia klawiaturę i a11y bez nowej zależności.

**Contract**:
- Props: `value: Role | ""`, `onChange(role)`, `error?: string`.
- Renderuje `fieldset` z `legend` „Kim jesteś?” i dwie etykiety-karty z `input type="radio" name="role"` (wizualnie ukryte, ale fokusowalne):
  - „Właściciel” z ikoną `Home` (lucide) i opisem „Chcę sprzedać lub wynająć nieruchomość”;
  - „Agent” z ikoną `BriefcaseBusiness` i opisem „Pośredniczę w sprzedaży i wynajmie”.
- Pod kartami stała notka (`fg-3`, ≥4.5:1): „Roli nie można później zmienić.”
- Bez domyślnego zaznaczenia.
- Stany DoD:
  - default: ramka `--rs-input-border`;
  - hover: ramka `--rs-fg-3`;
  - focus-visible: ring `shadow-focus` na karcie przez `has-[:focus-visible]`;
  - checked: ramka i ikona `--rs-accent-strong`, tło `accent-soft` albo istniejący token;
  - error: ramka `--rs-danger`, komunikat jak w `FormField` (`aria-describedby` na fieldset, `aria-invalid` na radio).
- Klasy łączymy przez `cn()`. Kontrast ramek i ikon ≥3:1 w obu motywach (lesson).

#### 2. SignUpForm

**File**: `src/components/auth/SignUpForm.tsx`

**Intent**: Rola jest wymagana także po stronie klienta, a fokus przy błędzie trafia na wybór roli.

**Contract**:
- Stan `role: Role | ""`. `RoleChoice` stoi jako pierwsze pole przed e-mailem.
- `validate()` dodaje `errors.role = "Wybierz, czy jesteś właścicielem, czy agentem"`.
- Fokus pierwszego `[aria-invalid="true"]` działa również dla radio (istniejący mechanizm `:64-68`).

#### 3. Hover pól (F5)

**File**: `src/components/auth/FormField.tsx`

**Intent**: Brakujący stan hover z DoD design systemu.

**Contract**: `inputBase` dostaje `hover:border-rs-fg-3`. Focus (`focus:border-rs-accent`) i błąd (`data-[state=error]:border-rs-danger`) muszą wygrywać w trakcie hover. Kolejność i warianty sprawdzamy w przeglądarce, w razie potrzeby `hover:not-focus:` albo `data-[state=error]:hover:`.

### Success Criteria:

#### Automated Verification:

- Lint, typy i build: `npm run lint && npx astro check && npm run build`
- Smoke przechodzi: `npm run smoke`

#### Manual Verification:

- Rejestracja w przeglądarce jako owner i jako agent prowadzi na właściwy panel
- Wysłanie bez roli pokazuje błąd przy kartach i przenosi fokus na pierwszą kartę; czytnik (VoiceOver) ogłasza legend i błąd
- Karty roli: default, hover, focus-visible (Tab i strzałki), checked i error wywołane i obejrzane w light i dark
- Pola: hover wywołany (lub wymuszony `:hover` w DevTools) i widoczny w obu motywach; focus i błąd nie są nadpisywane przez hover
- Kontrast ramek i ikon kart ≥3:1, a tekstów ≥4.5:1 w obu motywach (DevTools)
- 360px bez poziomego scrolla, polskie znaki poprawne

**Implementation Note**: Po automatycznej weryfikacji zatrzymaj się i poczekaj, aż człowiek potwierdzi kroki ręczne.

---

## Phase 5: Smoke ról i wdrożenie

### Overview

Smoke pokrywa obie role i przekierowania krzyżowe. Ręcznie sprawdzamy izolację RLS w SQL. W README powstaje runbook migracji, a migracja trafia na produkcję przed merge.

### Changes Required:

#### 1. Smoke dla obu ról

**File**: `scripts/smoke.mjs`

**Intent**: Automatycznie udowodnić routing ról i odrzucenie rejestracji bez roli na zbudowanej aplikacji.

**Contract**:
- Osobne słoiki ciasteczek per użytkownik (np. `jar` jako parametr albo funkcja `session()`).
- Scenariusz ownera jak dotąd plus `/agent → 302 /owner`.
- Scenariusz agenta: signup z `role=agent` daje `/dashboard`, potem `/dashboard → 302 /agent`, `/agent → 200`, `/owner → 302 /agent`.
- Signup z `role=admin` daje `?error=invalid_input`.
- Wylogowanie agenta i `/agent → 302 /auth/signin`.
- Zero zależności, bez zmian w CLI.

#### 2. Runbook migracji

**File**: `README.md` (sekcja „Deploy”)

**Intent**: Udokumentować ręczne wdrażanie migracji wymagane przez `infrastructure.md:82`.

**Contract**:
- Kroki: `npx supabase login`, `npx supabase link --project-ref <ref>`, `npx supabase db push --dry-run`, `npx supabase db push`.
- Reguła: wykonuje człowiek przed merge do `main`, a merge robi zaraz potem.
- Uwaga: `wrangler rollback` nie cofa schematu, a SQL cofający jest w bloku `-- down:` migracji.

#### 3. Wdrożenie na produkcję (krok operacyjny, bez kodu)

**Intent**: Schemat na produkcji przed nowym kodem.

**Contract**:
1. Użytkownik usuwa konta testowe w produkcyjnym Supabase (Authentication).
2. Wykonuje runbook (`--dry-run` pokazuje tylko migrację `create_profiles`), potem `db push`.
3. Merge PR.
4. Po jobie `deploy` sprawdza rejestrację na `https://hellodom.hellodom.workers.dev`.

### Success Criteria:

#### Automated Verification:

- Lint, typy i build: `npm run lint && npx astro check && npm run build`
- Smoke z oboma scenariuszami przechodzi lokalnie: `npm run smoke`
- Job CI `smoke` jest zielony na PR: `gh pr checks`

#### Manual Verification:

- Ręczny check RLS w Studio SQL (lokalnie, z dwoma kontami po smoke):
  - `set local role authenticated; set local request.jwt.claims = '{"sub":"<uuid A>"}'; select * from public.profiles;` zwraca tylko wiersz A;
  - `update public.profiles set role = 'agent' where id = '<uuid A>'` jest odrzucony albo zmienia 0 wierszy;
  - `insert` jest odrzucony;
  - jako `set local role anon` `select` daje permission denied.
- `db push --dry-run` na produkcji pokazuje wyłącznie `create_profiles`, a `db push` przechodzi
- Po deployu na produkcji: rejestracja ownera i agenta prowadzi na właściwy panel (albo na „Sprawdź skrzynkę”, jeśli produkcja wymaga potwierdzenia), a wejście na cudzy prefiks przekierowuje

**Implementation Note**: Po automatycznej weryfikacji zatrzymaj się i poczekaj, aż człowiek potwierdzi kroki ręczne. Krok produkcyjny wykonuje człowiek.

---

## Testing Strategy

### Unit Tests:

- Brak frameworka testów (CLAUDE.md). Logikę `route-guard.ts` i `auth-errors.ts` pokrywają kroki smoke przez rzeczywiste przekierowania.

### Integration Tests:

- `scripts/smoke.mjs` na zbudowanej aplikacji i lokalnym Supabase (CI job `smoke`):
  - signup, signin i signout dla ownera i agenta;
  - zwrotnica `/dashboard`;
  - przekierowania krzyżowe;
  - signup bez roli i z niepoprawną rolą;
  - anonimowy dostęp.

### Manual Testing Steps:

1. Ręczny SQL check RLS (faza 5).
2. Usunięcie profilu: wylogowanie i komunikat (faza 3).
3. Stany kart roli i hover pól w obu motywach (faza 4).
4. Wstrzyknięcie tekstu w `?error=` (faza 2).

## Performance Considerations

Jedno dodatkowe zapytanie `profiles` (po kluczu głównym, objęte RLS) na żądanie do ścieżek bramkowanych. Strony publiczne go nie wykonują. Polityka używa `(select auth.uid())`, żeby funkcja liczyła się raz na zapytanie, a nie dla każdego wiersza.

## Migration Notes

- Migracja jest addytywna (nowa tabela, funkcja i trigger), ale zmienia kontrakt rejestracji. Stary kod bez roli dostaje błąd od chwili `db push` do końca deployu (Critical Implementation Details).
- Istniejące konta na produkcji nie mają profilu. Użytkownik usuwa konta testowe przed `db push`, a ewentualne pozostałe trafią w ścieżkę `no_profile`.
- Rollback: `wrangler rollback` nie cofa schematu. SQL cofający jest w bloku `-- down:` migracji i trzeba go wykonać ręcznie.

## References

- Research: `context/changes/role-based-signup/research.md`
- Carried over: `context/foundation/roadmap.md:95-99`, `context/archive/2026-10-27-app-shell/reviews/impl-review.md` (F2, F5, F6, F10)
- Wzorzec prefiksu: `src/components/shell/nav.ts:15-17`
- Infrastruktura: `context/foundation/infrastructure.md:80-82,92`
- Supabase: https://supabase.com/docs/guides/auth/managing-user-data, https://supabase.com/docs/guides/deployment/managing-environments

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Schemat i typy

#### Automated

- [x] 1.1 Migracja stosuje się na czystej bazie: `npx supabase db reset` — 33c2e5d
- [x] 1.2 Typy się generują i są aktualne: `npm run db:types && git diff --exit-code src/db/database.types.ts` — 33c2e5d
- [x] 1.3 Lint, typy i build przechodzą: `npm run lint && npx astro check && npm run build` — 33c2e5d
- [x] 1.4 Smoke przechodzi na lokalnym Supabase: `npm run smoke` — 33c2e5d

#### Manual

- [x] 1.5 W Studio wiersz `profiles` z `role = owner` dla konta smoke, RLS włączony, jedna polityka select — 33c2e5d
- [x] 1.6 Signup bez `role` przez curl daje `?error=` i nie tworzy użytkownika — 33c2e5d

### Phase 2: Endpointy auth

#### Automated

- [x] 2.1 Lint, typy i build: `npm run lint && npx astro check && npm run build` — 0ea9e56
- [x] 2.2 Smoke przechodzi: `npm run smoke` — 0ea9e56
- [x] 2.3 Żaden endpoint nie przekazuje tekstu w `?error=` (grep `encodeURIComponent` pusty) — 0ea9e56
- [x] 2.4 Brak gałęzi DEV w confirm-email (grep `import.meta.env.DEV` pusty) — 0ea9e56

#### Manual

- [x] 2.5 `?error=` z dowolnym tekstem pokazuje ogólny komunikat — 0ea9e56
- [x] 2.6 `?error=invalid_credentials` pokazuje „Nieprawidłowy e-mail lub hasło” — 0ea9e56
- [x] 2.7 POST z JSON `{}` na signin daje 302 `?error=invalid_input`, nie 500 — 0ea9e56
- [x] 2.8 Logowanie złym hasłem w przeglądarce pokazuje polski komunikat z mapy — 0ea9e56

### Phase 3: Middleware i panele ról

#### Automated

- [x] 3.1 Lint, typy i build: `npm run lint && npx astro check && npm run build` — 9e4775b
- [x] 3.2 Smoke przechodzi: `npm run smoke` — 9e4775b
- [x] 3.3 `PROTECTED_ROUTES` nie istnieje (grep w src, CLAUDE.md, AGENTS.md pusty) — 9e4775b

#### Manual

- [x] 3.4 Owner: `/dashboard`, `/agent` i `/agent/cokolwiek` prowadzą na `/owner` — 9e4775b
- [x] 3.5 `/ownerx` daje 404 i nie jest bramkowane — 9e4775b
- [x] 3.6 Usunięty profil: wylogowanie, komunikat `no_profile`, sesja wyczyszczona — 9e4775b
- [x] 3.7 Sidebar, Dock i MobileNav z aktywną pozycją „Panel” na `/owner` w obu motywach, 360px i desktop — 9e4775b

### Phase 4: Formularz rejestracji

#### Automated

- [x] 4.1 Lint, typy i build: `npm run lint && npx astro check && npm run build`
- [x] 4.2 Smoke przechodzi: `npm run smoke`

#### Manual

- [x] 4.3 Rejestracja w przeglądarce jako owner i agent prowadzi na właściwy panel
- [x] 4.4 Wysłanie bez roli: błąd przy kartach, fokus na pierwszej karcie, VoiceOver ogłasza legend i błąd
- [x] 4.5 Karty roli: default, hover, focus-visible, checked i error obejrzane w light i dark
- [x] 4.6 Hover pól widoczny w obu motywach; focus i błąd nie są nadpisywane
- [x] 4.7 Kontrast ramek i ikon kart ≥3:1, tekstów ≥4.5:1 w obu motywach
- [x] 4.8 360px bez poziomego scrolla, polskie znaki poprawne

### Phase 5: Smoke ról i wdrożenie

#### Automated

- [ ] 5.1 Lint, typy i build: `npm run lint && npx astro check && npm run build`
- [ ] 5.2 Smoke z oboma scenariuszami przechodzi lokalnie: `npm run smoke`
- [ ] 5.3 Job CI `smoke` zielony na PR: `gh pr checks`

#### Manual

- [ ] 5.4 Ręczny check RLS w Studio SQL: tylko własny wiersz, update i insert odrzucone, anon bez dostępu
- [ ] 5.5 `db push --dry-run` na produkcji pokazuje tylko `create_profiles`, `db push` przechodzi
- [ ] 5.6 Po deployu: rejestracja ownera i agenta na produkcji prowadzi na właściwy panel, cudzy prefiks przekierowuje
