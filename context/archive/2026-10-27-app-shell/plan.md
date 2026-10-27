# Powłoka aplikacji w design systemie helloDOM — plan implementacji

## Overview

Zastępujemy style „10x Astro Starter” (kosmiczne tło, fiolet, glassmorphism) design systemem helloDOM ze specyfikacji `context/foundation/design-system.md`. W zakres wchodzą tokeny `--rs-*` dla light i dark, fonty Manrope i Nunito, przełącznik motywu bez mignięcia, komponenty bazowe potrzebne stronom auth, layout publiczny (landing i auth) oraz powłoka aplikacji dla zalogowanych: sidebar, topbar, szuflada i dock. Cały UI, którego dotyka ta zmiana, przechodzi na polski (`lang="pl"`). To foundation F-01 z roadmapy: odblokowuje S-01…S-07, które budują swoje widoki w tej powłoce.

## Current State Analysis

- `src/styles/global.css:1-131` — domyślne tokeny shadcn (neutral, oklch), wariant dark przez klasę `.dark` (`global.css:4`), utility `bg-cosmic` (`global.css:113`). Nie ma żadnych tokenów `--rs-*`.
- `src/layouts/Layout.astro` — `lang="en"`, domyślny tytuł „10x Astro Starter”, brak fontów, favicon PNG startera. Renderuje baner `missingConfigs` (`Layout.astro:21-35`), który musi zostać.
- Style startera są wpisane na sztywno w: `src/components/Welcome.astro`, `src/components/Topbar.astro`, `src/components/ui/LibBadge.astro`, `src/pages/dashboard.astro`, `src/pages/auth/{signin,signup,confirm-email}.astro`, `src/components/auth/{FormField,SubmitButton,ServerError,PasswordToggle}.tsx`, `src/components/Banner.astro` (kolory hex).
- `src/components/ui/button.tsx` — shadcn `buttonVariants` (default/destructive/outline/secondary/ghost/link) oparte na `--primary`/`--accent`.
- Formularze auth (`SignInForm.tsx`, `SignUpForm.tsx`) to wyspy React z walidacją po stronie klienta i angielskimi komunikatami (`SignUpForm.tsx:26-129`).
- `Welcome.astro` i `Topbar.astro` są używane wyłącznie przez landing startera; `LibBadge.astro`, `public/template.png` nie są nigdzie używane.
- `scripts/smoke.mjs` sprawdza tylko statusy HTTP i przekierowania (`/`, `/dashboard`, `/api/auth/*`), nie treść.
- Ról (właściciel/agent) jeszcze nie ma — wprowadza je S-01.

## Desired End State

- Każda strona korzysta z tokenów `--rs-*`; po przełączeniu motywu cała aplikacja (łącznie z banerem i polami formularzy) zmienia się na dark i z powrotem, a wybór przetrwa przeładowanie bez mignięcia jasnego motywu.
- `/` pokazuje minimalny landing helloDOM (hero na `--rs-grad-brand`, CTA do rejestracji i logowania); `/auth/signin`, `/auth/signup`, `/auth/confirm-email` to karty na `--rs-bg` w layoucie publicznym, po polsku.
- `/dashboard` renderuje się w powłoce: sidebar 244 px na desktopie (>980 px), sidebar ikonowy 64 px na tablecie (641–980 px), na mobile (≤640 px) topbar z hamburgerem otwierającym szufladę i pływający dock na dole.
- W `src/` nie ma już śladu stylów startera (`bg-cosmic`, `purple-*`, `bg-white/…`, `text-white`, gradientowe nagłówki).
- `npm run lint`, `npx astro check`, `npm run build` i `npm run smoke` przechodzą.

### Key Discoveries:

- Specyfikacja przełącza motyw atrybutem `data-theme` na `<html>` (`design-system.md:9`), więc `@custom-variant dark` w `global.css:4` musi przejść z klasy `.dark` na atrybut.
- W shadcn `accent` oznacza szare tło hover, a w design systemie `--rs-accent` to niebieski kolor marki. Kolory `--rs-*` trafiają więc do Tailwinda w osobnej przestrzeni nazw (`bg-rs-accent`, `text-rs-fg-2`), a nazwy shadcn są aliasami.
- Specyfikacja definiuje bazowy przycisk jako obramowany (`ramka line-strong`) z wariantami `primary`/`accent`/`ghost`/`link` (`design-system.md:93`).
- Konwencja z CLAUDE.md: `.tsx` tylko dla stanu lub handlerów. Stąd `ThemeToggle.tsx` i `MobileNav.tsx` jako wyspy, a sidebar, topbar, dock i Card jako `.astro`.

## What We're NOT Doing

- Komponenty Badge, pill statusu i wiersz oferty — powstaną w S-02/S-03/S-04, które ich używają.
- Treść nawigacji zależna od roli i rola w topbarze — przychodzą z S-01. Teraz nawigacja ma jedną pozycję („Panel”).
- Pełne tłumaczenie wszystkich błędów Supabase — tłumaczymy tylko 4 najczęstsze, reszta dostaje ogólny polski komunikat (Faza 2 §5).
- Zmiany w logice auth, middleware, trasach i smoke teście (endpointy auth zmieniają wyłącznie treść `?error=`).
- Rozbudowany landing (sekcje marketingowe, stopka z treścią) — tylko hero z CTA.

## Implementation Approach

Od dołu do góry: najpierw warstwa tokenów i dokument HTML (motyw działa globalnie, nawet zanim strony zostaną przepisane), potem komponenty, z których korzystają strony auth, potem layout publiczny razem ze sprzątaniem startera, a na końcu powłoka zalogowanych. Każda faza zostawia aplikację budującą się i działającą. Nazwy shadcn zostają jako aliasy na `--rs-*`, więc przyszłe `npx shadcn add` od razu renderuje się w kolorach helloDOM.

## Critical Implementation Details

- **Brak mignięcia motywu:** skrypt ustawiający `data-theme` musi być `is:inline` w `<head>` przed arkuszem stylów i fontami, opakowany w `try/catch` (localStorage może rzucić w trybie prywatnym; wtedy `light`). Ustawia też `color-scheme`, żeby natywne kontrolki i scrollbar zgadzały się z motywem.
- **Hydracja `ThemeToggle`:** serwer nie zna motywu, więc wyspa nie może renderować ikony na podstawie stanu przy pierwszym renderze. Renderuje obie ikony (słońce/księżyc) i ukrywa niewłaściwą przez CSS wariantu `dark:`. Handler tylko przełącza atrybut i zapis w `localStorage['theme']`.
- **Szuflada mobilna:** przy otwarciu fokus przechodzi do pierwszej pozycji nawigacji, `Escape`, kliknięcie backdropu i kliknięcie linku zamykają szufladę, a fokus wraca na hamburger. Przy otwartej szufladzie `body` nie przewija się.

## Faza 1: Tokeny, fonty i motyw

### Overview

Warstwa globalna: tokeny `--rs-*` light/dark, aliasy shadcn, mapowanie na Tailwind, wariant dark przez `data-theme`, fonty, skrypt motywu, przełącznik motywu, favicon i baner na tokenach.

### Changes Required:

#### 1. Tokeny i mapowanie na Tailwind

**File**: `src/styles/global.css`

**Intent**: Zastąpić tokeny startera pełnym zestawem z `design-system.md` (paleta bazowa, light, dark, statusy, typografia, promienie, cienie, easing) i usunąć `bg-cosmic`. Nazwy shadcn zostają jako aliasy, żeby istniejące i przyszłe komponenty shadcn działały.

**Contract**:
- `@custom-variant dark (&:where([data-theme="dark"], [data-theme="dark"] *));`
- `:root, [data-theme="light"]` — wszystkie tokeny light z `design-system.md:11-47`, w tym `--rs-success|warn|danger|info` z wariantami `-soft`/`-fg`, `--rs-input-bg` (light: `--rs-surface`), `color-scheme: light`. `[data-theme="dark"]` — nadpisania z `design-system.md:49-62`, `color-scheme: dark`, oraz rozjaśnione `-fg` statusów (kontrast ≥4.5:1 na `-soft`, WCAG AA): `--rs-success-fg: oklch(0.85 0.12 145)`, `--rs-warn-fg: oklch(0.86 0.11 75)`, `--rs-danger-fg: oklch(0.82 0.10 28)`.
- Aliasy shadcn: `--background→--rs-bg`, `--foreground→--rs-fg`, `--card→--rs-surface`, `--card-foreground→--rs-fg`, `--popover→--rs-surface-3`, `--popover-foreground→--rs-fg`, `--primary→--rs-fg`, `--primary-foreground→--rs-surface`, `--secondary|--muted|--accent→--rs-surface-2`, `--secondary-foreground|--accent-foreground→--rs-fg`, `--muted-foreground→--rs-fg-3`, `--destructive→--rs-danger`, `--border→--rs-line`, `--input→--rs-input-border`, `--ring→--rs-accent`, `--radius: 10px`, `--sidebar-*` analogicznie (`--sidebar→--rs-surface`, `--sidebar-accent→--rs-surface-2`, `--sidebar-primary→--rs-accent`). Tokeny `--chart-*` usunięte.
- `@theme inline` wystawia kolory `--color-rs-<token>` (np. `bg-rs-surface-2`, `text-rs-accent-fg`, `border-rs-line`, `bg-rs-danger-soft`), fonty `--font-display` (Manrope), `--font-body` (Nunito), `--font-numeric`, promienie (`--radius-card` 10px, `--radius-control` 8px, `--radius-sm` 6px, `--radius-badge` 4px, `--radius-dock` 20px), cienie (`--shadow-rs-1`, `--shadow-card`, `--shadow-focus: 0 0 0 3px var(--rs-accent-ring)` — niebieski accent 30%, nie `--rs-accent-soft`), easing `--ease-rs`, breakpointy `--breakpoint-tablet: 641px` i `--breakpoint-desktop: 981px` (warianty `tablet:` / `desktop:`; style bazowe = mobile ≤640 px; domyślnych `sm:`/`md:`/`lg:` nie używamy w powłoce ani stronach publicznych).
- Fonty self-hosted przez `@fontsource/manrope` (wagi 300, 400, 500, 600, 700) i `@fontsource/nunito` (400, 500, 600, 700) jako zależności npm; importy CSS konkretnych wag na początku `global.css` (np. `@import "@fontsource/manrope/600.css";`). Pliki fontów jadą z buildem, żadnych żądań do Google (RODO; LG München 2022). Podzbiory `latin-ext` są w paczce (polskie znaki).
- `@layer base`: zachować `* { border-border outline-ring/50 }`; `:focus-visible` dla elementów interaktywnych (`a`, `button`, `[role="button"]`, `summary`) — `outline: 2px solid var(--rs-accent); outline-offset: 2px`. Inputy zamiast outline dostają ramkę `--rs-accent` + `--shadow-focus` (Faza 2).
- `@layer base`: `body` — `--rs-bg`, `--rs-fg`, Nunito 14px/1.5, antialiasing; nagłówki h1–h4 Manrope w skali z `design-system.md:70`; klasy pomocnicze `.page-title` i `.microlabel` (`design-system.md:71-72`).

#### 2. Dokument HTML

**File**: `src/layouts/Layout.astro`

**Intent**: Bazowy dokument dla obu przyszłych layoutów: polski język, fonty, skrypt motywu przed renderem, favicon SVG, domyślny tytuł helloDOM.

**Contract**: `<html lang="pl">`; `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">` (safe-area dla docka); inline script w `<head>` (przed linkami do stylów) ustawiający `document.documentElement.dataset.theme` z `localStorage['theme']` (`light` | `dark`, domyślnie `light`, `try/catch`); bez `preconnect` i linków do Google Fonts (fonty przychodzą z `global.css` przez `@fontsource`); `<link rel="icon" type="image/svg+xml" href="/favicon.svg">`; domyślny `title` = „helloDOM”, a podany tytuł strony renderuje się jako „<tytuł> · helloDOM”. Baner `missingConfigs` bez zmian w logice. Usunąć scoped `<style>` z `margin: 0` (Tailwind preflight to robi).

#### 3. Przełącznik motywu

**File**: `src/components/ThemeToggle.tsx` (nowy)

**Intent**: Icon button 34 px przełączający light/dark; wyspa, bo ma handler.

**Contract**: default export bez propsów; renderuje `<button type="button" aria-label="Przełącz motyw">` z ikonami `Moon` (widoczna w light) i `Sun` (widoczna w dark) z `lucide-react`, ukrywanymi klasami `dark:hidden` / `hidden dark:block`. `onClick` ustawia `data-theme` na przeciwną wartość i zapisuje ją w `localStorage['theme']` w `try/catch`.

#### 4. Favicon

**File**: `public/favicon.svg` (nowy); usunąć `public/favicon.png`, `public/template.png`

**Intent**: Własny favicon helloDOM zgodnie z `design-system.md:106`.

**Contract**: Prosty SVG: zaokrąglony kwadrat w `#2B9AF5` z białą literą „h” (bez nazw ani logotypów innych marek).

#### 5. Baner na tokenach

**File**: `src/components/Banner.astro`

**Intent**: Zastąpić kolory hex tokenami statusów, żeby baner działał w obu motywach.

**Contract**: Warianty bez zmian (`info` | `warning` | `error`), mapowane na `--rs-info`, `--rs-warn-soft`/`--rs-warn-fg`, `--rs-danger-soft`/`--rs-danger-fg`; dla `info` tło `--rs-surface-2`, tekst `--rs-accent-fg`. Role ARIA bez zmian.

### Success Criteria:

#### Automated Verification:

- Lint przechodzi: `npm run lint`
- Typy przechodzą: `npx astro check`
- Build przechodzi: `npm run build`
- `bg-cosmic` i `.dark {` zniknęły z `src/styles/global.css`: `grep -nE "bg-cosmic|^\.dark \{" src/styles/global.css` nic nie zwraca
- Layout ma `lang="pl"` i skrypt motywu: `grep -nE 'lang="pl"|dataset\.theme' src/layouts/Layout.astro` zwraca oba
- Brak żądań do Google Fonts: `grep -rn "fonts.googleapis\|fonts.gstatic" src` nic nie zwraca, a `grep -n "@fontsource" src/styles/global.css` zwraca importy obu fontów

#### Manual Verification:

- Kliknięcie `ThemeToggle` (tymczasowo wstawionego na dowolną stronę albo przez `document.documentElement.dataset.theme='dark'` w konsoli) zmienia tło i tekst na dark; po przeładowaniu motyw zostaje bez mignięcia jasnego tła
- W DevTools fonty Manrope i Nunito są załadowane z własnej domeny (zakładka Network: zero żądań do `fonts.googleapis.com`/`fonts.gstatic.com`); favicon SVG widoczny w karcie
- Baner braku konfiguracji (uruchomienie bez `SUPABASE_URL`) jest czytelny w light i dark (tekst na `-soft` ≥4.5:1 w narzędziu kontrastu DevTools)
- Przejście `Tab` po stronie pokazuje wyraźną niebieską obwódkę focusu na linkach i przyciskach w light i dark

**Implementation Note**: Po zielonej automatycznej weryfikacji zatrzymaj się na ręczne potwierdzenie przed kolejną fazą.

---

## Faza 2: Komponenty bazowe

### Overview

Komponenty, z których korzystają strony auth, w stylu helloDOM; polskie komunikaty w formularzach.

### Changes Required:

#### 1. Button

**File**: `src/components/ui/button.tsx`

**Intent**: Przepisać `buttonVariants` na specyfikację z `design-system.md:93`, zachowując API komponentu (`variant`, `size`, `asChild`).

**Contract**: Baza: 38 px, padding 10×16, radius 8, Manrope 600 13px, tło `--rs-surface`, ramka `--rs-line-strong`, hover: `-translate-y-0.5` + cień `0 6px 18px rgba(15,23,42,.08)`, przejście `--ease-rs` 0.18s, focus `--shadow-focus`, disabled bez uniesienia i z `opacity-50`. Warianty: `default` (baza), `primary` (tło `--rs-fg`, tekst `--rs-surface`), `accent` (tło `--rs-accent`, tekst `--rs-accent-on`, 700, hover `--rs-accent-hover`), `ghost` (bez ramki i tła, hover `--rs-surface-2`, bez uniesienia), `link` (tekst `--rs-accent-fg`, podkreślenie na hover), `destructive` (tło `--rs-danger`, tekst `--rs-accent-on`, ramka `--rs-danger`, hover `color-mix(in oklab, var(--rs-danger) 85%, black)`; potrzebny w S-04 „Usuń ofertę” i S-07 „Usuń konto”). Rozmiary: `default` 38 px, `sm` 30 px, `lg` 46 px, `icon` 34×34. Usunąć `outline`, `secondary`.

#### 2. Card

**File**: `src/components/ui/Card.astro` (nowy)

**Intent**: Karta ze specyfikacji (`design-system.md:94`) dla stron auth i panelu.

**Contract**: Props `title?: string`, `class?: string`; slot `icon` (opcjonalny, w kafelku 26 px na `--rs-surface-2`) i slot domyślny. Tło `--rs-surface`, ramka 1px `--rs-line`, radius 10; nagłówek (gdy `title`) padding 13×18, tytuł Manrope 600 14px; treść padding 14×18. Klasy łączone przez `class:list` (odpowiednik `cn()` w Astro).

#### 3. Pola i elementy formularza

**File**: `src/components/auth/FormField.tsx`, `src/components/auth/PasswordToggle.tsx`, `src/components/auth/ServerError.tsx`, `src/components/auth/SubmitButton.tsx`

**Intent**: Przestylować na tokeny i stany ze specyfikacji (`design-system.md:95`), bez zmiany propsów.

**Contract**:
- `FormField`: label 11.5px 600 `--rs-fg-2`; input 38 px, padding 10×12 (z lewej miejsce na ikonę), radius 8, tło `--rs-input-bg`, ramka `--rs-input-border`, Nunito 500 13.5px, placeholder `--rs-fg-4`; focus: ramka `--rs-accent` + `--shadow-focus`; błąd: `data-state="error"` i `aria-invalid`, ramka `--rs-danger`, komunikat 11.5px `--rs-danger-fg` z `aria-describedby`. Ikona `--rs-fg-3`.
- `PasswordToggle`: kolory `--rs-fg-3`/hover `--rs-fg`; `aria-label` „Pokaż hasło” / „Ukryj hasło”.
- `ServerError`: tło `--rs-danger-soft`, tekst `--rs-danger-fg`, ramka `--rs-danger` w 30% przez `color-mix`, radius 8, `role="alert"`.
- `SubmitButton`: `Button` w wariancie `accent`, pełna szerokość, bez nadpisywania kolorów klasami; spinner w `currentColor`.

#### 4. Polskie komunikaty formularzy

**File**: `src/components/auth/SignInForm.tsx`, `src/components/auth/SignUpForm.tsx`

**Intent**: Przetłumaczyć wszystkie teksty widoczne dla użytkownika; logika walidacji bez zmian.

**Contract**: Etykiety „E-mail”, „Hasło”, „Powtórz hasło”; placeholdery „ty@przyklad.pl”, „Twoje hasło”, „Co najmniej 6 znaków”, „Wpisz hasło ponownie”; błędy „Podaj adres e-mail”, „Podaj poprawny adres e-mail”, „Podaj hasło”, „Powtórz hasło”, „Hasła nie są takie same”; przyciski „Zaloguj się” / „Logowanie…”, „Załóż konto” / „Zakładanie konta…”. Nazwy pól formularza (`name`) bez zmian — od nich zależą endpointy i smoke test.

#### 5. Polskie błędy Supabase

**File**: `src/lib/services/auth-errors.ts` (nowy), `src/pages/api/auth/signin.ts`, `src/pages/api/auth/signup.ts`

**Intent**: Błędy z Supabase trafiają do `?error=` po polsku; PRD zakłada polski interfejs, a testy E2E w M3 będą sprawdzać te komunikaty.

**Contract**: `export function toPolishAuthError(error: { code?: string; message: string }): string` — mapa po `error.code` (stabilniejszy niż treść komunikatu): `invalid_credentials` → „Nieprawidłowy e-mail lub hasło”, `user_already_exists` → „Konto z tym adresem e-mail już istnieje”, `email_not_confirmed` → „Potwierdź adres e-mail, zanim się zalogujesz”, `weak_password` → „Hasło jest za słabe — użyj co najmniej 6 znaków”; każdy inny kod → „Coś poszło nie tak. Spróbuj ponownie.”. Endpointy wołają ją zamiast `error.message`; komunikat braku konfiguracji („Supabase is not configured”) → „Usługa logowania jest chwilowo niedostępna”. Przekierowania i prefiks `?error=` bez zmian (smoke sprawdza tylko prefiks).

### Success Criteria:

#### Automated Verification:

- Lint przechodzi: `npm run lint`
- Typy przechodzą: `npx astro check`
- Build przechodzi: `npm run build`
- W komponentach auth nie ma kolorów startera: `grep -rnE "purple-|blue-100|bg-white/|text-white|red-[0-9]" src/components/auth src/components/ui/button.tsx` nic nie zwraca
- Brak angielskich komunikatów: `grep -rnE "is required|Enter a valid|do not match|Sign in|Creating account" src/components/auth` nic nie zwraca
- Endpointy nie przekazują surowych błędów Supabase: `grep -rnE "error\.message|is not configured" src/pages/api/auth` nic nie zwraca

#### Manual Verification:

- Na `/auth/signin` i `/auth/signup` pola mają stan default, hover, focus (niebieska ramka + ring), błąd (czerwona ramka + komunikat) i disabled przycisku przy wysyłaniu, w light i dark
- Polskie znaki (ą, ę, ł, ś, ż) w etykietach i komunikatach renderują się w Nunito/Manrope bez fontu zastępczego

**Implementation Note**: Po zielonej automatycznej weryfikacji zatrzymaj się na ręczne potwierdzenie przed kolejną fazą.

---

## Faza 3: Layout publiczny i strony anonimowe

### Overview

Layout dla `/` i `/auth/*`, minimalny landing helloDOM, strony auth po polsku na kartach, usunięcie artefaktów startera.

### Changes Required:

#### 1. Layout publiczny

**File**: `src/layouts/PublicLayout.astro` (nowy)

**Intent**: Lekki layout dla niezalogowanych: nagłówek z wordmarkiem i przełącznikiem motywu, treść na `--rs-bg`.

**Contract**: Props `title?: string`, przekazywany do `Layout.astro`. Nagłówek: wordmark „helloDOM” (link do `/`, Manrope 700, `--rs-accent-fg`, w dark `--rs-fg`) po lewej, `<ThemeToggle client:load />` po prawej; padding strony ze specyfikacji (`28px 32px 60px`, mobile `16px 14px`). Slot domyślny jako `<main>`.

#### 2. Landing

**File**: `src/pages/index.astro`; usunąć `src/components/Welcome.astro`, `src/components/Topbar.astro`, `src/components/ui/LibBadge.astro`

**Intent**: Zastąpić hero startera minimalnym landingiem helloDOM.

**Contract**: `PublicLayout`; sekcja hero na `--rs-grad-brand`, radius karty, tekst `--rs-accent-on`: nagłówek „Znajdź agenta dopasowanego do Twojej nieruchomości”, jedno zdanie opisu (miasto, typ, cena, doświadczenie → top 3 z wynikiem 0–100, na podstawie README), CTA `Button` `accent` „Załóż konto” → `/auth/signup` i `default` „Zaloguj się” → `/auth/signin`. Gdy `Astro.locals.user` istnieje, jedno CTA „Przejdź do panelu” → `/dashboard`. Przyciski jako linki przez `buttonVariants` na `<a>` (bez wyspy). Strona zwraca 200 (smoke).

#### 3. Strony auth

**File**: `src/pages/auth/signin.astro`, `src/pages/auth/signup.astro`, `src/pages/auth/confirm-email.astro`

**Intent**: Przenieść na `PublicLayout` + `Card`, przetłumaczyć.

**Contract**: Wyśrodkowana kolumna `max-w-sm` (na 360 px pełna szerokość minus gutter). Tytuły stron: „Logowanie”, „Rejestracja”, „Sprawdź skrzynkę” / „Konto utworzone”. Linki pod formularzem: „Nie masz konta? Załóż je” / „Masz już konto? Zaloguj się” w kolorze `--rs-accent-fg`. `confirm-email`: emoji zastąpione ikoną `lucide-react` (`MailCheck` / `CircleCheck`) w `--rs-accent`, opisy po polsku, link „Przejdź do logowania” / „Wróć do logowania”. Przekazywanie `?error=` do formularzy bez zmian.

### Success Criteria:

#### Automated Verification:

- Lint przechodzi: `npm run lint`
- Typy przechodzą: `npx astro check`
- Build przechodzi: `npm run build`
- Artefakty startera usunięte: `ls src/components/Welcome.astro src/components/Topbar.astro src/components/ui/LibBadge.astro public/template.png public/favicon.png` zgłasza brak wszystkich plików
- Brak stylów i tekstów startera w stronach publicznych: `grep -rnE "bg-cosmic|purple-|bg-white/|text-white|10x Astro Starter|Sign (in|up)" src/pages/index.astro src/pages/auth src/layouts` nic nie zwraca

#### Manual Verification:

- `/`, `/auth/signin`, `/auth/signup`, `/auth/confirm-email` przy 360 px nie mają poziomego przewijania; w light i dark wyglądają zgodnie ze specyfikacją
- Zalogowany użytkownik na `/` widzi „Przejdź do panelu”
- Błąd logowania (złe hasło) wyświetla się po polsku („Nieprawidłowy e-mail lub hasło”) w `ServerError` na karcie; ponowna rejestracja tego samego e-maila pokazuje „Konto z tym adresem e-mail już istnieje”

**Implementation Note**: Po zielonej automatycznej weryfikacji zatrzymaj się na ręczne potwierdzenie przed kolejną fazą.

---

## Faza 4: Powłoka aplikacji

### Overview

`AppLayout` dla zalogowanych: sidebar (244 px desktop, 64 px tablet), topbar, szuflada i dock na mobile; `/dashboard` przechodzi na powłokę.

### Changes Required:

#### 1. Model nawigacji

**File**: `src/components/shell/nav.ts` (nowy)

**Intent**: Jedno źródło pozycji nawigacji dla sidebaru, szuflady i docka, które S-01 rozszerzy o pozycje zależne od roli.

**Contract**: `export interface NavItem { href: string; label: string; icon: LucideIcon }`; `export const navConfig: NavItem[]` z jedną pozycją `{ href: "/dashboard", label: "Panel", icon: LayoutDashboard }`; `isActive(pathname, href)` — dopasowanie dokładne lub prefiks z `/`. To jedyna lista nawigacji: `Sidebar`, `MobileNav` i `Dock` importują `navConfig` bezpośrednio (moduł działa po stronie serwera i w wyspie), żaden nie dostaje pozycji ani ikon przez propsy. Dock pokazuje maksymalnie 5 pozycji (`design-system.md:89`).

#### 2. Sidebar

**File**: `src/components/shell/Sidebar.astro` (nowy)

**Intent**: Sidebar desktop/tablet ze specyfikacji (`design-system.md:86-87`).

**Contract**: Props `pathname: string`; pozycje z `navConfig`. Ukryty ≤640 px (`hidden tablet:flex`). 641–980 px: szerokość 64 px, tylko ikony 16 px, etykiety jako `sr-only` + `title`. >980 px (`desktop:`): 244 px, wordmark, pozycje 13.5px/500, padding 9×10, radius 6; aktywna (`aria-current="page"`): tło `--rs-surface-2`, 600, ikona `--rs-accent`. Sticky, wysokość `100vh`, tło `--rs-surface`, prawa ramka `--rs-line`, padding 22×14.

#### 3. Topbar

**File**: `src/components/shell/AppTopbar.astro` (nowy)

**Intent**: Topbar ze specyfikacji (`design-system.md:88-89`).

**Contract**: Props `email: string`. Sticky, z-index 10, padding 16×32 (mobile 12×14), tło `--rs-surface`, dolna ramka `--rs-line`. Mobile: `<MobileNav client:load … />` (hamburger 36 px) po lewej i wyśrodkowany wordmark. Po prawej: `ThemeToggle`, awatar (kółko z pierwszą literą e-maila na `--rs-surface-2`), e-mail 13.5px/600 (ukryty ≤640 px), przycisk `ghost` `icon` z `LogOut` i `aria-label="Wyloguj"` w formularzu `POST /api/auth/signout`. Miejsce na rolę (11px) zostaje puste do S-01.

#### 4. Szuflada mobilna

**File**: `src/components/shell/MobileNav.tsx` (nowy)

**Intent**: Hamburger i szuflada na ≤640 px; wyspa, bo trzyma stan otwarcia.

**Contract**: Props tylko `pathname: string`; pozycje i ikony z `navConfig` importowanego w wyspie (bez przekazywania ikon przez granicę wyspy). Hamburger i szuflada tylko ≤640 px (`tablet:hidden`). Szuflada z lewej, szerokość 86% / max 320 px, z-index 110, backdrop z `backdrop-blur-[2px]`, `role="dialog"`, `aria-modal="true"`, `aria-label="Nawigacja"`. Zachowanie zamykania i fokusu zgodnie z „Critical Implementation Details”. Hamburger `aria-expanded`, `aria-controls`.

#### 5. Dock

**File**: `src/components/shell/Dock.astro` (nowy)

**Intent**: Pływający dock na mobile (`design-system.md:89`).

**Contract**: Props `pathname: string`; pozycje z `navConfig`. Widoczny tylko ≤640 px (`tablet:hidden`); `fixed`, 10 px od bocznych krawędzi, `bottom: calc(8px + env(safe-area-inset-bottom))`, z-index 50, radius 20, tło `--rs-surface`, ramka `--rs-line`; grid 5 kolumn, przyciski min. 54 px, ikona + etykieta 9.5px, aktywny w `--rs-accent` z `aria-current="page"`.

#### 6. AppLayout i panel

**File**: `src/layouts/AppLayout.astro` (nowy), `src/pages/dashboard.astro`

**Intent**: Złożyć powłokę i przenieść na nią panel.

**Contract**: `AppLayout` — props `title: string`; bierze `Astro.url.pathname` i `Astro.locals.user`; jedna kolumna ≤640 (bazowo), `tablet:` grid `64px 1fr`, `desktop:` grid `244px 1fr`; obszar treści: padding `28px 32px 60px`, gap 18, `max-width: 1440px` (mobile `16px 14px 92px` — miejsce na dock); `.page-title` z `title`. `dashboard.astro` — `AppLayout title="Panel"`, `Card` z tytułem „Witaj” i tekstem „Zalogowano jako {email}. Tu pojawią się Twoje oferty albo zaproszenia.”. Wylogowanie tylko przez topbar.

### Success Criteria:

#### Automated Verification:

- Lint przechodzi: `npm run lint`
- Typy przechodzą: `npx astro check`
- Build przechodzi: `npm run build`
- Smoke test przechodzi na podglądzie produkcyjnym z lokalnym Supabase: `npm run smoke`
- W całym `src/` nie ma stylów startera: `grep -rnE "bg-cosmic|purple-|blue-100|bg-white/|text-white|bg-clip-text" src` nic nie zwraca

#### Manual Verification:

- `/dashboard` >980 px: sidebar 244 px z aktywną pozycją „Panel”; 641–980 px: sidebar 64 px z samymi ikonami; ≤640 px: topbar z hamburgerem i wyśrodkowanym wordmarkiem oraz dock na dole, treść nie chowa się pod dockiem
- Szuflada: otwiera się hamburgerem, zamyka `Escape`, kliknięciem backdropu i linku; fokus wraca na hamburger; strona pod spodem się nie przewija
- Przy 360 px brak poziomego przewijania; light i dark poprawne na wszystkich trzech szerokościach
- Wylogowanie z topbaru przekierowuje na `/`
- Szybki przegląd w najnowszych Chrome, Firefoksie i Safari (Edge = Chromium)

**Implementation Note**: Po zielonej automatycznej weryfikacji zatrzymaj się na ręczne potwierdzenie.

---

## Testing Strategy

### Unit Tests:

- Brak — projekt nie ma jeszcze frameworka testów (CLAUDE.md). Logika jest trywialna (`isActive`, przełączanie atrybutu).

### Integration Tests:

- `npm run smoke` po fazie 4: `/` → 200, `/dashboard` dla anonimowego → przekierowanie, rejestracja/logowanie/wylogowanie bez zmian w trasach i nazwach pól.

### Manual Testing Steps:

1. Otwórz `/` w light, przełącz na dark, przeładuj — dark bez mignięcia.
2. Zarejestruj konto na `/auth/signup` z celowymi błędami walidacji (pusty e-mail, różne hasła) — polskie komunikaty, czerwone ramki.
3. Zaloguj się, sprawdź `/dashboard` przy 1280, 800 i 360 px.
4. Na 360 px otwórz i zamknij szufladę klawiaturą (`Tab`, `Enter`, `Escape`).
5. Powtórz kroki 1 i 3 w Safari i Firefoksie.

## Performance Considerations

Fonty self-hosted przez `@fontsource` (`font-display: swap` w paczce), serwowane z tej samej domeny co aplikacja — bez dodatkowego DNS/TLS do Google i bez wycieku IP. Importujemy tylko używane wagi; `unicode-range` w paczce sprawia, że przeglądarka pobiera tylko potrzebne podzbiory (latin, latin-ext). Wyspy React tylko dwie (`ThemeToggle`, `MobileNav`), obie małe. Inline script motywu ma kilka linii i nie blokuje renderu.

## Migration Notes

Brak danych. Użytkownicy z istniejącą sesją nie są dotknięci. Domyślny motyw `light`, dopóki użytkownik go nie zmieni. Komponenty shadcn dodane później, które używają usuniętych wariantów `Button` (`outline`, `secondary`), trzeba będzie przy dodawaniu przepiąć na `default` / `ghost`. `destructive` zostaje (na `--rs-danger`).

## References

- Roadmap: `context/foundation/roadmap.md` (F-01, Change ID `app-shell`)
- Specyfikacja: `context/foundation/design-system.md`
- PRD NFR (360 px, polskie znaki, przeglądarki): `context/foundation/prd.md`
- Wzorzec wyspy vs `.astro`: `src/components/auth/SignInForm.tsx` vs `src/components/Topbar.astro` (CLAUDE.md)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Tokeny, fonty i motyw

#### Automated

- [x] 1.1 Lint przechodzi: `npm run lint` — ff7f4d4
- [x] 1.2 Typy przechodzą: `npx astro check` — ff7f4d4
- [x] 1.3 Build przechodzi: `npm run build` — ff7f4d4
- [x] 1.4 `bg-cosmic` i `.dark {` zniknęły z `src/styles/global.css` — ff7f4d4
- [x] 1.5 Layout ma `lang="pl"` i skrypt motywu — ff7f4d4
- [x] 1.6 Brak żądań do Google Fonts — ff7f4d4

#### Manual

- [x] 1.7 Przełączenie motywu zmienia tło i tekst; po przeładowaniu bez mignięcia — ff7f4d4
- [x] 1.8 Fonty Manrope i Nunito załadowane; favicon SVG widoczny — ff7f4d4
- [x] 1.9 Baner braku konfiguracji czytelny w light i dark — 96a8a5c
- [x] 1.10 Widoczna obwódka focusu na linkach i przyciskach — ff7f4d4

### Phase 2: Komponenty bazowe

#### Automated

- [x] 2.1 Lint przechodzi: `npm run lint` — eb135ca
- [x] 2.2 Typy przechodzą: `npx astro check` — eb135ca
- [x] 2.3 Build przechodzi: `npm run build` — eb135ca
- [x] 2.4 W komponentach auth nie ma kolorów startera — eb135ca
- [x] 2.5 Brak angielskich komunikatów w komponentach auth — eb135ca
- [x] 2.6 Endpointy nie przekazują surowych błędów Supabase — eb135ca

#### Manual

- [x] 2.7 Pola mają stany default, hover, focus, błąd i disabled w light i dark — eb135ca
- [x] 2.8 Polskie znaki renderują się w Nunito/Manrope — eb135ca

### Phase 3: Layout publiczny i strony anonimowe

#### Automated

- [x] 3.1 Lint przechodzi: `npm run lint` — 96a8a5c
- [x] 3.2 Typy przechodzą: `npx astro check` — 96a8a5c
- [x] 3.3 Build przechodzi: `npm run build` — 96a8a5c
- [x] 3.4 Artefakty startera usunięte — 96a8a5c
- [x] 3.5 Brak stylów i tekstów startera w stronach publicznych — 96a8a5c

#### Manual

- [x] 3.6 Strony publiczne przy 360 px bez poziomego przewijania, poprawne w light i dark — 96a8a5c
- [x] 3.7 Zalogowany użytkownik na `/` widzi „Przejdź do panelu” — 96a8a5c
- [x] 3.8 Błędy logowania i rejestracji wyświetlają się po polsku w `ServerError` — 96a8a5c

### Phase 4: Powłoka aplikacji

#### Automated

- [x] 4.1 Lint przechodzi: `npm run lint` — 68efeb4
- [x] 4.2 Typy przechodzą: `npx astro check` — 68efeb4
- [x] 4.3 Build przechodzi: `npm run build` — 68efeb4
- [x] 4.4 Smoke test przechodzi: `npm run smoke` — 68efeb4
- [x] 4.5 W całym `src/` nie ma stylów startera — 68efeb4

#### Manual

- [x] 4.6 `/dashboard` poprawny na desktopie, tablecie i mobile — 68efeb4
- [x] 4.7 Szuflada otwiera się i zamyka poprawnie, fokus wraca na hamburger — 68efeb4
- [x] 4.8 Przy 360 px brak poziomego przewijania; light i dark na trzech szerokościach — 68efeb4
- [x] 4.9 Wylogowanie z topbaru przekierowuje na `/` — 68efeb4
- [x] 4.10 Przegląd w Chrome, Firefoksie i Safari — 68efeb4
