---
date: 2026-10-27T15:43:09+01:00
researcher: Claude (Opus 5.5) dla bkreczmer
git_commit: 75140a32dcce51d62c78694bb5fbe54fd3c8dbfe
branch: feat/role-based-signup
repository: helloDOM
topic: "S-01 role-based-signup: profiles + trigger + RLS, middleware po prefiksie, carried-over F2/F5/F6/F10, wdrożenie migracji"
tags: [research, auth, supabase, rls, migrations, middleware, ci]
status: complete
last_updated: 2026-10-27
last_updated_by: Claude (Opus 5.5)
---

# Research: S-01 role-based-signup

**Date**: 2026-10-27T15:43:09+01:00
**Git Commit**: 75140a3 (branch `feat/role-based-signup`, czyste drzewo)
**Repository**: helloDOM

## Research Question

Uwzględnij: (1) tabela `profiles` (id = auth.uid(), role check in ('owner','agent'), created_at) z RLS „tylko swój profil”, tworzona triggerem po rejestracji z roli przekazanej w metadanych; (2) middleware chroniący trasy po prefiksie zamiast listy `PROTECTED_ROUTES`; (3) carried over z roadmapy: F2 kody błędów + allowlist, F5 hover pól, F6 zod + try/catch w endpointach, F10 confirm-email z sesji zamiast DEV; (4) migracje w `supabase/migrations` i ich wdrożenie na produkcyjny projekt (`supabase db push`) w CI albo ręcznie.

## Summary

- **Baza danych jest dziś pusta.** Nie ma `supabase/migrations/` (w `supabase/` są tylko `config.toml` i pusty `snippets/`), nie ma typu `Database` ani `src/types.ts`. `profiles` będzie pierwszą tabelą i pierwszą polityką RLS w projekcie.
- **Trigger:** udokumentowany wzorzec Supabase to `handle_new_user()` z `security definer set search_path = ''` i trigger `after insert on auth.users`. Wyjątek w triggerze wycofuje wstawienie użytkownika, więc `signUp` zwraca błąd. Rolę czytamy z `raw_user_meta_data` tylko w chwili wstawienia. Użytkownik może ją potem zmienić przez `updateUser({data})`, więc autoryzujemy wyłącznie po `profiles.role`.
- **RLS i granty:** wystarczy jedna polityka `select to authenticated using ((select auth.uid()) = id)`. Polityki insert/update/delete nie są potrzebne, bo rola ma być stała. Granty trzeba nadać jawnie: od 2026-10-30 (za 3 dni) nowe tabele w `public` w istniejących projektach nie dostają ich automatycznie.
- **Middleware** porównuje dziś `startsWith("/dashboard")` (`src/middleware.ts:4,18`). To łapie też np. `/dashboardx`, nie zna ról i nie przekierowuje zalogowanego na panel jego roli. Lista jest wymieniona jeszcze w `AppLayout.astro:15-17`, `CLAUDE.md:26` i `AGENTS.md:26`.
- **Carried over:** `auth-errors.ts` mapuje już kody Supabase na polskie teksty, ale do URL trafia gotowy tekst, a strony renderują dowolny `?error=`. Brakuje walidacji `astro/zod` i `try/catch`. `confirm-email.astro:6` decyduje po `import.meta.env.DEV`. W `FormField.tsx:6` nie ma hover.
- **Wdrożenie migracji:** `infrastructure.md:82` wymaga, żeby migracje na produkcji zatwierdzał człowiek, a CI nie ma sekretów Supabase CLI. Dlatego `db push` uruchamiamy ręcznie, przed pushem do `main`. Smoke job w CI (`supabase start`) zastosuje nowe migracje lokalnie bez zmian w workflow, ale sam smoke test musi przesłać `role`.

## Detailed Findings

### 1. Tabela `profiles`, trigger i RLS

**Stan repo**
- `supabase/config.toml`: `major_version = 17` (:36), `[db.migrations] enabled = true` (:53-58), `[db.seed] sql_paths = ["./seed.sql"]` (:65). Pliku `seed.sql` nie ma, więc CLI ostrzeże przy `db reset`. `[auth] site_url = "http://127.0.0.1:3000"` (:154) jest nieaktualne, bo dev działa na 4321. `[auth.email] enable_confirmations = false` (:209).
- `src/lib/supabase.ts:9` tworzy `createServerClient(...)` bez generyka `<Database>`. W `src/` nie ma wygenerowanych typów.

**Wzorzec triggera** (https://supabase.com/docs/guides/auth/managing-user-data)
- `create function public.handle_new_user() returns trigger language plpgsql security definer set search_path = '' as $$ … insert into public.profiles (id, role) values (new.id, new.raw_user_meta_data ->> 'role'); return new; $$;`
- `create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();`
- Przy `search_path = ''` wszystkie nazwy muszą mieć kwalifikator schematu.
- Dokumentacja ostrzega: „If the trigger fails, it could block signups”. Wyjątek wycofuje insert do `auth.users`. `signUp` zwraca wtedy błąd, który z doświadczenia ma treść „Database error saving new user” i status 500. Ta treść nie jest podana na cytowanej stronie.
- Rolę z endpointu przekazujemy przez `supabase.auth.signUp({ email, password, options: { data: { role } } })`. Dziś `signup.ts:14` nie przekazuje `options`.

**Zaufanie do metadanych**
- `raw_user_meta_data` (user_metadata) może zmienić sam użytkownik. Rola jest bezpieczna tylko jako kopia w `profiles.role`, zrobiona raz przy insercie. Nigdzie nie autoryzujemy po `user.user_metadata.role` ani po `auth.jwt()->'user_metadata'`.
- `app_metadata` można zapisać tylko kluczem service_role, którego aplikacja nie ma (`infrastructure.md:80`: tylko klucz anon). Źródła dla tej reguły podagent nie pobrał, opieramy się na wiedzy ogólnej.

**Brak albo błędna rola**
- Rekomendacja: `role text not null check (role in ('owner','agent'))` bez wartości domyślnej, a trigger po prostu wstawia wartość z metadanych. Pusta lub błędna rola kończy się wyjątkiem, czyli odrzuconą rejestracją.
- Domyślne `'owner'` nadałoby po cichu stałą, błędną rolę.
- Endpoint waliduje `role` przez `z.enum(['owner','agent'])` (F6), więc użytkownik zobaczy przyjazny błąd, a trigger jest drugą linią obrony.

**RLS i granty**
- `alter table public.profiles enable row level security;` i jedna polityka `for select to authenticated using ((select auth.uid()) = id)`. Wrapper `(select …)` zalecają ze względu na wydajność.
- Brak polityk insert/update/delete oznacza brak dostępu, bo RLS domyślnie odmawia. Insert wykonuje trigger jako definer, a usunięcie konta (FR-012) idzie przez `on delete cascade` z `auth.users`.
- „Na stałe” (`roadmap.md:87`): nie dajemy polityki UPDATE ani grantu UPDATE. Gdy S-02 doda pola profilu, użyjemy grantu kolumnowego (`grant update (…) on public.profiles to authenticated`), który pomija `role`.
- **Zmiana Data API** (https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically): nowe tabele w `public` nie dostają już automatycznie grantów dla `anon`/`authenticated`/`service_role`. Od 2026-05-30 dotyczy to nowych projektów, a od 2026-10-30 istniejących. RLS nie jest włączany automatycznie. Wniosek: migracja zawiera jawnie `grant select on public.profiles to authenticated;` i nic dla `anon`.
- Dodatkowo `revoke execute on function public.handle_new_user() from public, anon, authenticated;`.
- Luka: nie sprawdzono, czy lokalny obraz CLI stosuje już nowe domyślne granty. Jawne granty działają w obu przypadkach.
- Wytyczna z PRD (`CLAUDE.md`, Hard rules) „agent widzi tylko oferty, do których go zaproszono” dotyczy przyszłych tabel. Dla `profiles` wystarczy „tylko swój”. Ranking (S-03) będzie potrzebował czytać profile agentów, ale to osobna polityka albo funkcja w S-02/S-03, poza tym zakresem.

### 2. Middleware i panele ról

- `src/middleware.ts:4` ma `const PROTECTED_ROUTES = ["/dashboard"]`, a `:18` sprawdza `pathname.startsWith(route)`. Na tej sprawdzonej ścieżce `/dashboardfoo` też jest chronione. Porównanie po segmencie (`p === prefix || p.startsWith(prefix + "/")`) jest już w `src/components/shell/nav.ts:15-17` (`isActive`) i można go użyć ponownie.
- Middleware pobiera tylko `getUser()` (:9-12). Rola wymaga dodatkowego zapytania `profiles` (RLS: swój wiersz). Trzeba to zrobić przy każdym chronionym żądaniu albo tylko na prefiksach chronionych. To decyzja dla planu. Kandydat na wynik: `context.locals.profile`, typowany w `src/env.d.ts:1-5`.
- Outcome S-01 (`roadmap.md:87`): „trafia na panel swojej roli”. Dziś:
  - `signin.ts:20` przekierowuje na `/`,
  - `index.astro:18` linkuje do `/dashboard`,
  - `dashboard.astro` jest wspólny dla obu ról,
  - `nav.ts:10` ma jedną pozycję „Panel”.
- Nazwy tras (np. `/owner/…` i `/agent/…` jako prefiksy albo `/dashboard` z treścią zależną od roli) nie są nigdzie ustalone. To otwarty wybór. Model prefiksowy naturalnie łączy się z punktem (2): prefiks wyznacza wymaganą rolę, a zła rola przekierowuje na własny panel.
- Defence in depth `AppLayout.astro:14-18` rzuca błąd, gdy brak użytkownika. Komunikat i komentarz wskazują `PROTECTED_ROUTES`, więc przy zmianie trzeba je zaktualizować razem z `CLAUDE.md:26` i `AGENTS.md:26` (tam też „Add every new gated route there”).
- Smoke test (`scripts/smoke.mjs:40,56,58`) sprawdza `/dashboard`. Kroki 52-55 oczekują przekierowania signin na `/`, a krok 43 robi signup bez `role`. Po dodaniu triggera z wymaganą rolą ten krok się wyłoży, więc smoke trzeba zaktualizować w tej samej zmianie.

### 3. Carried over (F2, F5, F6, F10)

Źródło wymagań: `context/foundation/roadmap.md:95-99` i `context/archive/2026-10-27-app-shell/reviews/impl-review.md` (F2 :45-53, F5 :75-83, F6 :85-102, F10 :134-142).

- **F2 – kody błędów i allowlist.**
  - `src/lib/services/auth-errors.ts:1-6` ma już mapę kod → tekst dla `invalid_credentials`, `user_already_exists`, `email_not_confirmed` i `weak_password`, a do tego fallback (:8) i `AUTH_UNAVAILABLE_MESSAGE` (:10).
  - Problem jest w kierunku przepływu: endpointy wkładają do URL gotowy tekst (`signin.ts:12,17`, `signup.ts:12,17`), a strony przekazują surowy `?error=` do `ServerError` (`signin.astro:6,13`, `signup.astro:6,13`, `ServerError.tsx:16`).
  - Zmiana: endpoint przekazuje kod (np. `unavailable`, `invalid_input` i kody Supabase), strona mapuje go przez allowlistę, a nieznany kod daje fallback. Supabase może też zwrócić kod spoza listy przy błędzie triggera, który wtedy wpada w fallback. Plan może dodać osobny kod dla tej sytuacji.
  - Smoke sprawdza tylko prefiks `?error=` (`smoke.mjs:49`), więc kody go nie złamią.
- **F6 – zod i try/catch.**
  - `signin.ts:6-8` i `signup.ts:6-8` używają `form.get(...) as string` bez `try/catch`. Gdy treść żądania nie jest formularzem, `formData()` rzuca wyjątek i kończy się 500.
  - Wymaganie: `z` z `astro/zod` i `safeParse`, czyli `{email, password}` dla signin oraz `{email, password, role}` dla signup. `formData()` i wywołania Supabase trafiają do `try/catch` z przekierowaniem `?error=`.
  - Dziś klient waliduje hasło na min. 6 znaków (`SignUpForm.tsx:9`). Schemat serwera powinien to odzwierciedlać.
- **F10 – confirm-email.**
  - `confirm-email.astro:6` ma `isAutoConfirmed = import.meta.env.DEV`. Lokalnie `enable_confirmations = false` (`config.toml:209`), ale ustawienie produkcji jest nieznane, a w CI build produkcyjny działa na lokalnym Supabase bez potwierdzeń. Flaga DEV daje więc złe komunikaty w obu kierunkach.
  - Zmiana: `signUp` zwraca `data.session`. Wartość `null` oznacza, że potrzebne jest potwierdzenie, a sesja oznacza, że użytkownik jest od razu zalogowany. Endpoint przekazuje tę informację w przekierowaniu (np. `?confirmed=1`) albo, gdy sesja istnieje, kieruje od razu na panel roli.
  - Smoke krok 44 oczekuje `/auth/confirm-email` jako prefiksu.
- **F5 – hover pól.**
  - `inputBase` w `FormField.tsx:6` nie ma `hover:`. Design-system DoD (`design-system.md:104-106`) wymaga stanu hover.
  - Zgodnie z notą review: ramka ciemniejsza niż `--rs-input-border`, np. `hover:border-rs-fg-3`, przy czym focus i `data-[state=error]` mają pierwszeństwo. Kolejność klas i specyficzność trzeba zweryfikować w przeglądarce (lesson „Odhaczaj krok ręczny…”). Zgodnie z lesson o kontraście ramka pola ma mieć ≥3:1.
- **Wybór roli w UI:** `SignUpForm.tsx` ma dziś tylko email/hasło/powtórz hasło (:81-142). Wybór roli to nowy kontrolowany element, np. radio group lub segmented. Musi mieć 7 stanów DoD i walidację klienta, a wysyła pole `role`. W `src/components/ui/` są tylko `Card.astro` i `button.tsx`, więc komponentu radio nie ma. Ewentualnie `npx shadcn@latest add radio-group`.

### 4. Migracje i wdrożenie na produkcję

- **Konwencja:** `npx supabase migration new create_profiles` tworzy `supabase/migrations/<YYYYMMDDHHmmss>_create_profiles.sql`, zgodnie z `CLAUDE.md` (Supabase migrations). Lokalnie migrację stosuje `npx supabase db reset` albo `migration up`.
- **Down migration:** `infrastructure.md:92` wymaga down migration dla każdej zmiany RLS. Jej forma (komentarz w pliku albo osobny plik) to decyzja dla planu.
- **CI dziś** (`.github/workflows/ci.yml`):
  - `smoke` instaluje CLI `supabase/setup-cli@v1` z `version: latest` (:35-37) i robi `supabase start -x …` (:41). `supabase start` stosuje migracje z `supabase/migrations` (przykładowe wyjście w CLI reference pokazuje „Applying migration…”, choć strona nie opisuje tego wprost). Workflow nie wymaga zmian.
  - `deploy` robi build i `npx wrangler deploy` (:71-72). Nie ma tam kroku migracji ani sekretów `SUPABASE_ACCESS_TOKEN`/`SUPABASE_DB_PASSWORD`/`SUPABASE_PROJECT_ID`.
- **Ograniczenie zespołowe:** `infrastructure.md:82` mówi, że migracje na produkcyjnym projekcie zatwierdza człowiek. `:81` dodaje, że `wrangler rollback` nie cofa schematu ani RLS.
- **Opcja ręczna (zgodna z :82):** `npx supabase link --project-ref <ref>`, potem `npx supabase db push --dry-run`, potem `npx supabase db push`. Wszystko wykonujemy przed merge/push do `main`, żeby schemat był na produkcji, zanim `deploy` wypchnie kod, który go używa. Trzeba to zapisać w README (dziś nic o migracjach) i w checkliście planu.
- **Opcja CI** (https://supabase.com/docs/guides/deployment/managing-environments): krok w `deploy` przed `wrangler deploy` z `supabase link` i `supabase db push` oraz sekretami w GitHub. Żeby spełnić :82, potrzebny jest GitHub `environment: production` z wymaganymi recenzentami. Taki próg dotyczyłby każdego deployu, nie tylko tych z migracjami. Wymaga to też zmiany `CLAUDE.md` (CI: „Production Supabase secrets live as Worker secrets, not in GitHub”).
- **Kolejność i kompatybilność:** migracja musi trafić na produkcję przed kodem. Powinna być addytywna, żeby stary Worker (rollback) dalej działał. Tu nowa tabela i trigger są addytywne, ale trigger z wymaganą rolą łamie rejestrację starego kodu, który nie wysyła `role`. Między `db push` a deployem rejestracja na produkcji nie zadziała. Okno jest krótkie, ale trzeba je odnotować albo trigger musi tolerować brak roli przez czas przejścia.
- **Użytkownicy istniejący na produkcji** (np. konta smoke z poprzednich deployów, `ci.yml:77` sprawdza tylko curl) nie dostaną wierszy w `profiles`. Liczby nie sprawdzono. Plan musi zdecydować o backfillu albo o obsłudze „brak profilu” w middleware.
- Rekomendacja podagenta: przypiąć wersję `setup-cli` zamiast `latest` (:37). To poza zakresem, opcjonalnie.

### 5. Typy

- `npx supabase gen types typescript --local > …` jeszcze nie istnieje. Typ `Role = 'owner' | 'agent'` i DTO profilu powinny trafić do `src/types.ts` (`CLAUDE.md`: shared types), a klient może dostać `createServerClient<Database>`.

## Code References

- `src/middleware.ts:4,18` – lista i `startsWith` bez granicy segmentu
- `src/components/shell/nav.ts:10,15-17` – jedna pozycja nawigacji; `isActive` z granicą segmentu
- `src/layouts/AppLayout.astro:14-18` – guard z komunikatem o `PROTECTED_ROUTES`
- `src/pages/api/auth/signin.ts:6-20`, `signup.ts:6-20` – brak zod/try-catch, tekst w `?error=`, signin → `/`, signup bez `options.data`
- `src/pages/auth/signin.astro:6,13`, `signup.astro:6,13`, `src/components/auth/ServerError.tsx:16` – surowy `?error=` renderowany
- `src/lib/services/auth-errors.ts:1-15` – istniejąca mapa kodów
- `src/pages/auth/confirm-email.astro:6` – decyzja po `import.meta.env.DEV`
- `src/components/auth/FormField.tsx:6` – `inputBase` bez hover
- `src/components/auth/SignUpForm.tsx:9,80-148` – formularz bez roli
- `src/env.d.ts:1-5` – `Locals` ma tylko `user`
- `src/lib/supabase.ts:9` – klient bez typu `Database`
- `scripts/smoke.mjs:38-59` – kroki zależne od `/dashboard`, signup bez roli, signin → `/`
- `supabase/config.toml:65,154,209` – seed bez pliku, stary `site_url`, potwierdzenia wyłączone
- `.github/workflows/ci.yml:35-41,71-72` – smoke stawia Supabase; deploy bez migracji
- `context/foundation/infrastructure.md:80-82,92` – tylko klucz anon; rollback nie cofa schematu; człowiek zatwierdza migracje; down migration

## Architecture Insights

- Rola jest stałym atrybutem w `public.profiles`, a nie w JWT. Autoryzacja opiera się na wierszu chronionym RLS, a metadane służą tylko jako kanał przekazania roli przy rejestracji.
- Jeden helper prefiksów w `src/lib/` (np. mapa prefiks → wymagana rola) może obsłużyć zarówno middleware, jak i guard w layoutach, zamiast dublować listę w kilku plikach.
- Kontrakt błędów: endpoint zwraca **kod**, strona robi **mapę**. To samo dotyczy parametru potwierdzenia (F10).

## Historical Context (from prior changes)

- `context/archive/2026-10-27-app-shell/reviews/impl-review.md:45-53,75-83,85-102,134-142` – F2, F5, F6 i F10 zostały odroczone do S-01 decyzją użytkownika. Wymagania są nadal aktualne: kod w powyższych liniach się nie zmienił.
- F5 (nota w :83): proponowany `line-strong` (24%) jest jaśniejszy niż `--rs-input-border` (28%). Nadal obowiązuje, bo dotyczy tokenów niezmienionych od tego czasu (nie zmierzono ponownie).
- `context/foundation/lessons.md` – kontrast ≥3:1 dla ramek elementów interaktywnych; krok ręczny (hover) odhaczać dopiero po zobaczeniu.

## Related Research

Brak wcześniejszych `research.md` w `context/changes/**` i `context/archive/**`.

## Open Questions

1. **Trasy paneli:** prefiksy per rola (`/owner`, `/agent`) czy wspólny `/dashboard` z treścią po roli? To decyduje o kształcie middleware z punktu (2).
2. **Wdrożenie migracji:** ręcznie (zgodnie z `infrastructure.md:82`, rekomendowane na MVP) czy krok w CI z `environment` i recenzentem (wymaga zmiany CLAUDE.md)?
3. **Okno przejścia:** czy trigger ma odrzucać brak roli od razu (krótka przerwa w rejestracji między `db push` a deployem), czy tymczasowo go tolerować?
4. **Istniejący użytkownicy na produkcji bez profilu:** backfill (jaka rola?), usunięcie kont testowych czy przekierowanie „brak profilu” w middleware? Liczba kont nieznana.
5. **Co ma `/` dla zalogowanego** po signin: przekierowanie na panel roli czy obecny link „Przejdź do panelu”?
6. Czy produkcyjny projekt Supabase wymaga potwierdzenia e-maila? Ustawienie nieznane, a F10 rozwiązuje to w runtime przez `session`.
