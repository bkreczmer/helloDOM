# Powłoka aplikacji w design systemie helloDOM — Plan Brief

> Full plan: `context/changes/app-shell/plan.md`

## What & Why

Zastępujemy wygląd „10x Astro Starter” design systemem helloDOM (`context/foundation/design-system.md`): tokeny light/dark, fonty, przełącznik motywu, komponenty potrzebne stronom auth, layout publiczny i powłoka aplikacji. To foundation F-01 z roadmapy. Bez niego każdy wycinek S-01…S-07 budowałby widoki w stylach startera i trzeba by je przestylować drugi raz.

## Starting Point

`global.css` ma domyślne tokeny shadcn i wariant dark przez klasę `.dark`. Kosmiczne style startera są wpisane na sztywno w 11 plikach (landing, auth, dashboard, komponenty formularzy). UI jest po angielsku (`lang="en"`). Ról jeszcze nie ma, więc nawigacja nie ma treści poza panelem.

## Desired End State

Każda strona używa tokenów `--rs-*`, a motyw light/dark przełącza się i przetrwa przeładowanie bez mignięcia. `/` to minimalny landing helloDOM, strony auth to polskie karty w layoucie publicznym. `/dashboard` działa w powłoce: sidebar 244 px na desktopie, 64 px na tablecie, a na mobile topbar z szufladą i dock. W `src/` nie zostaje nic ze stylów startera.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| Tokeny shadcn vs `--rs-*` | Nazwy shadcn jako aliasy na `--rs-*`; kolory `--rs-*` w Tailwindzie jako `rs-*` | Przyszłe `npx shadcn add` od razu renderuje się w kolorach helloDOM, a `accent` z shadcn (szary hover) nie myli się z niebieskim `--rs-accent`. |
| Które strony dostają powłokę | Powłoka tylko dla zalogowanych; `/` i `/auth/*` w lekkim layoucie publicznym z nowym landingiem | Topbar powłoki pokazuje użytkownika, a anonimowy widziałby pustą nawigację; publiczne repo przestaje pokazywać branding startera. |
| Język UI | Polski, `lang="pl"`, na wszystkich dotykanych stronach | PRD i README są po polsku, a NFR o polskich znakach jest sprawdzany na prawdziwych tekstach od razu. |
| Zakres komponentów | Tylko Button, Card, pola formularza, błąd, submit, przełącznik hasła | Komponenty powstają z pierwszym wycinkiem, który ich używa; Badge, pill i wiersz oferty przyjdą z S-02…S-04. |
| Motyw | `data-theme` na `<html>`, inline script w `<head>`, `localStorage['theme']`, domyślnie light | Zgodnie ze specyfikacją; brak mignięcia, bo atrybut jest ustawiany przed renderem. |
| Wyspy React | Tylko `ThemeToggle` i `MobileNav`; sidebar, topbar, dock i Card jako `.astro` | Konwencja CLAUDE.md: `.tsx` tylko przy stanie lub handlerze. |

## Scope

**In scope:**
- Tokeny light/dark, statusy (w dark `-fg` z kontrastem ≥4.5:1), typografia, promienie, cienie, focus na `--rs-accent-ring`/`--rs-accent`, breakpointy `tablet:` 641 px / `desktop:` 981 px; aliasy shadcn; wariant dark przez `data-theme`
- Fonty Manrope i Nunito self-hosted przez `@fontsource` (bez Google Fonts, RODO), skrypt motywu, `ThemeToggle`, favicon SVG, baner na tokenach
- Button według specyfikacji (z `destructive` na `--rs-danger` dla S-04/S-07), Card, przestylowane pola formularza, polskie komunikaty
- Polskie błędy Supabase: mapa 4 najczęstszych kodów + ogólny komunikat (`src/lib/services/auth-errors.ts`)
- `PublicLayout`, minimalny landing, strony auth po polsku; usunięcie `Welcome`, `Topbar`, `LibBadge`, PNG startera
- `AppLayout`: sidebar, topbar, szuflada, dock; `/dashboard` w powłoce

**Out of scope:**
- Badge, pill statusu, wiersz oferty
- Nawigacja zależna od roli i rola w topbarze (S-01)
- Pełne tłumaczenie wszystkich błędów Supabase; zmiany logiki auth, middleware, tras
- Rozbudowany landing

## Architecture / Approach

`Layout.astro` to dokument HTML: fonty, skrypt motywu, `lang="pl"`, baner. Na nim stoją dwa layouty: `PublicLayout` (wordmark, przełącznik motywu, treść na `--rs-bg`) i `AppLayout` (grid sidebar + treść, topbar, dock). Nawigacja pochodzi z jednej konfiguracji `navConfig` (etykieta, ścieżka, ikona) w `src/components/shell/nav.ts`, którą sidebar, szuflada i dock importują bezpośrednio. S-01 dopisze tam pozycje zależne od roli.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Tokeny, fonty i motyw | Globalne tokeny `--rs-*`, motyw light/dark bez mignięcia, fonty, favicon | Błędne mapowanie aliasów shadcn albo `@custom-variant` psuje dark |
| 2. Komponenty bazowe | Button, Card, pola formularza w stylu helloDOM, polskie komunikaty | Zmiana wariantów `Button` w miejscach, które ich używają |
| 3. Layout publiczny | Landing helloDOM, strony auth na kartach, usunięty starter | Poziome przewijanie przy 360 px |
| 4. Powłoka aplikacji | Sidebar 244/64 px, topbar, szuflada, dock; `/dashboard`; smoke | Dostępność szuflady (fokus, Escape) i dock zasłaniający treść |

**Prerequisites:** Lokalny Supabase do `npm run smoke` w fazie 4; `context/foundation/design-system.md` jako źródło wartości.
**Estimated effort:** ~2 sesje, 4 fazy.

## Open Risks & Assumptions

- Tokeny `color-mix(in oklab, …)` i `oklch` wymagają współczesnych przeglądarek; NFR obejmuje tylko dwie najnowsze wersje, więc to akceptowalne.
- Komponenty shadcn dodane później, które używają usuniętych wariantów `Button` (`outline`, `secondary`), trzeba będzie przepiąć przy dodawaniu.
- Mapa błędów Supabase opiera się na `error.code` (`invalid_credentials`, `user_already_exists`, `email_not_confirmed`, `weak_password`); nieznane kody dostają ogólny polski komunikat.
- Fonty jadą z buildem (`@fontsource`); żadnych żądań do Google, więc nie ma przekazania IP (LG München 2022).

## Success Criteria (Summary)

- Każda strona wygląda zgodnie ze specyfikacją helloDOM w light i dark, a motyw przetrwa przeładowanie bez mignięcia.
- `/dashboard` działa w powłoce na desktopie, tablecie i przy 360 px bez poziomego przewijania.
- Lint, `astro check`, build i smoke przechodzą, a w `src/` nie zostaje nic ze stylów startera.
