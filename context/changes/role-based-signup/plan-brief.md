# Rejestracja z rolą właściciel/agent: brief planu

> Pełny plan: `context/changes/role-based-signup/plan.md`
> Research: `context/changes/role-based-signup/research.md`

## Co i dlaczego

Przy rejestracji użytkownik wybiera na stałe rolę `owner` albo `agent`. Po zalogowaniu trafia na panel swojej roli (S-01: FR-001, FR-002). Rola jest podstawą wszystkich późniejszych reguł dostępu, dlatego trzymamy ją w tabeli chronionej RLS, a nie w metadanych, które użytkownik może sam zmienić. W tej samej zmianie zamykamy przeniesione z app-shell punkty F2, F5, F6 i F10.

## Punkt wyjścia

Baza nie ma jeszcze żadnej tabeli ani migracji. Middleware chroni tylko `/dashboard` przez `startsWith` i nie zna ról. Endpointy auth nie walidują wejścia i wkładają polski tekst do `?error=`, a strony renderują ten parametr bez filtrowania. confirm-email wybiera komunikat po `import.meta.env.DEV`.

## Stan docelowy

Formularz rejestracji ma dwie karty roli. Konto bez poprawnej roli nie powstaje, bo odrzuca je zarówno zod, jak i trigger. `/dashboard` przekierowuje na `/owner` albo `/agent`. Wejście na prefiks cudzej roli przekierowuje na własny panel. Zalogowany bez profilu zostaje wylogowany i widzi komunikat. `?error=` niesie wyłącznie kod z allowlisty. Smoke w CI sprawdza obie role, a migracja trafia na produkcję przed merge.

## Kluczowe decyzje

| Decyzja | Wybór | Dlaczego | Źródło |
| --- | --- | --- | --- |
| Gdzie trzymać rolę | `public.profiles.role`, check `owner`/`agent`, kopiowana triggerem z `raw_user_meta_data` | Metadane może zmienić sam użytkownik, a wiersz chroniony RLS nie | Research |
| RLS | Jedna polityka select „tylko swój”, bez update/insert/delete, jawne granty | Rola jest stała; od 2026-10-30 nowe tabele nie dostają grantów automatycznie | Research |
| Brak roli | Trigger odrzuca rejestrację od razu, bez wartości domyślnej | Domyślna rola nadałaby po cichu złą, nieodwracalną rolę | Użytkownik |
| Trasy | Prefiksy `/owner/*` i `/agent/*`, middleware sprawdza rolę, `/dashboard` to zwrotnica | Prefiks wyznacza wymaganą rolę w jednym miejscu (`route-guard.ts`) | Użytkownik |
| Zalogowany bez profilu | `signOut` + `/auth/signin?error=no_profile` | Konta sprzed migracji nie mają profilu | Użytkownik |
| Po zalogowaniu | `/dashboard`, potem panel roli | Jedna ścieżka dla signin i signupu z sesją | Użytkownik |
| F10 | Sesja z `signUp` prowadzi na `/dashboard`, `null` na „Sprawdź skrzynkę” | Decyduje rzeczywiste zachowanie Supabase, a nie flaga DEV | Plan |
| UI roli | Dwie karty z natywnym radio, opis i notka „nie można zmienić” | Rola jest nieodwracalna; natywne radio nie wymaga nowej zależności | Plan |
| Testy RLS | Kroki w smoke + ręczny SQL check | Brak frameworka testów; smoke już działa w CI na lokalnym Supabase | Plan |
| Migracje na produkcji | Ręcznie: `link`, `db push --dry-run`, `db push`, przed merge | `infrastructure.md:82` wymaga zatwierdzenia przez człowieka | Użytkownik |

## Zakres

**W zakresie:**
- migracja `profiles`, trigger, RLS, granty i SQL cofający;
- typy bazy;
- zod i `try/catch` w endpointach, kody błędów z allowlistą;
- confirm-email bez flagi DEV;
- middleware z prefiksami ról, panele `/owner` i `/agent`, nawigacja zależna od roli;
- karty roli i hover pól;
- smoke dla obu ról;
- runbook migracji w README.

**Poza zakresem:**
- profil agenta i słowniki (S-02);
- czytanie cudzych profili przez ranking;
- usuwanie konta;
- migracje w CI;
- pgTAP;
- backfill profili;
- reset hasła, zmiana roli.

## Architektura

Rejestracja przechodzi przez `signUp` z `options.data.role`. Trigger `on_auth_user_created` wstawia wiersz do `profiles` albo przerywa rejestrację. Middleware na ścieżkach bramkowanych (`/dashboard`, `/owner`, `/agent`) pobiera profil jednym zapytaniem objętym RLS i zapisuje go w `locals.profile`. Potem porównuje `profile.role` z wymaganą rolą prefiksu z `src/lib/route-guard.ts`. Powłoka (`AppLayout`, nawigacja) dostaje rolę przez propsy.

## Fazy w skrócie

| Faza | Co dostarcza | Główne ryzyko |
| --- | --- | --- |
| 1. Schemat i typy | Migracja `profiles` z triggerem, RLS i grantami; typy; signup przekazuje rolę | Błąd w triggerze blokuje wszystkie rejestracje |
| 2. Endpointy auth | Zod, `try/catch`, kody i allowlist, F10, signin prowadzi na `/dashboard` | Smoke musi nadążyć za nowymi przekierowaniami |
| 3. Middleware i panele ról | `route-guard.ts`, `locals.profile`, `no_profile`, zwrotnica, `/owner` i `/agent`, nawigacja | Pętla przekierowań, jeśli `signOut` nie wyczyści ciasteczek |
| 4. Formularz rejestracji | Karty roli z 7 stanami, walidacja, hover pól (F5) | Kontrast i kolejność stanów hover/focus/error |
| 5. Smoke ról i wdrożenie | Scenariusze owner i agent, ręczny check RLS, runbook, `db push` na produkcję | Krótkie okno bez działającej rejestracji między `db push` a deployem |

**Wymagania wstępne:**
- Docker z lokalnym Supabase;
- dostęp do produkcyjnego projektu Supabase (login CLI, project ref, hasło bazy) w fazie 5.

**Szacowany nakład:** ok. 3 sesje w 5 fazach.

## Otwarte ryzyka i założenia

- Między `db push` a końcem deployu rejestracja na produkcji nie działa, bo stary kod nie wysyła roli. Ryzyko zaakceptowane, merge robimy zaraz po `db push`.
- W fazach 1–3 rejestracja przez UI na branchu nie działa, bo formularz nie ma jeszcze pola roli. Działa przez smoke i curl.
- Nie wiadomo, czy produkcja wymaga potwierdzenia e-maila. F10 obsługuje oba przypadki w runtime.
- Treść błędu Supabase przy nieudanym triggerze nie jest udokumentowana, więc trafia do `unknown`, czyli ogólnego komunikatu.

## Kryteria sukcesu (skrót)

- Właściciel i agent rejestrują się, logują i trafiają na swój panel; cudzy panel przekierowuje.
- Rejestracja bez roli albo z niepoprawną rolą jest odrzucona i nie tworzy konta.
- Smoke w CI jest zielony dla obu ról, a migracja działa na produkcji.
