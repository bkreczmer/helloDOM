---
project: helloDOM
status: active
created: 2026-10-27
---

# Design system helloDOM

Specyfikacja wyglądu aplikacji. Tokeny są CSS custom properties z prefiksem `--rs-`, mapowane na Tailwind 4 przez `@theme inline` w `src/styles/global.css`. Motyw przełącza atrybut `data-theme="light|dark"` na `<html>` (zapis w `localStorage['theme']`, domyślnie `light`, inline script w `<head>` przed renderem — bez mignięcia).

## Paleta bazowa (5 kolorów)

| Token | Wartość | Rola |
|---|---|---|
| `--rs-accent` | `#2B9AF5` | kolor marki dla elementów dekoracyjnych (CTA i aktywne ikony używają `--rs-accent-strong`) |
| `--rs-accent-fg` | `#0652A9` | tekst i linki w kolorze marki, wordmark |
| `--rs-accent-on` | `#FFFFFF` | tekst na tle accent |
| `--rs-accent-2` | `#FF7AD9` | akcent kontrastowy (wyróżnienia) |
| `--rs-accent-2-soft` | `#F6B6F3` | delikatne tło akcentu kontrastowego |

Kolory pochodne liczone przez `color-mix(in oklab, …)`.

## Light (`:root`, `[data-theme="light"]`)

| Token | Wartość |
|---|---|
| `--rs-bg` | `color-mix(in oklab, white 95%, var(--rs-accent))` |
| `--rs-surface`, `--rs-surface-3` | `#FFFFFF` |
| `--rs-surface-2` | `color-mix(in oklab, white 90%, var(--rs-accent))` |
| `--rs-fg` | `#0652A9` |
| `--rs-fg-2` / `--rs-fg-3` / `--rs-fg-4` | `color-mix(in oklab, var(--rs-fg) 88% / 80% / 28%, var(--rs-surface))` — `fg-2`/`fg-3` ≥4.5:1 na surface; `fg-4` tylko dekoracja (linie, znaki bez znaczenia), nigdy tekst |
| `--rs-line` / `--rs-line-strong` | `color-mix(in oklab, var(--rs-fg) 13% / 24%, var(--rs-surface))` |
| `--rs-input-border` | `color-mix(in oklab, var(--rs-fg) 61%, var(--rs-surface))` — 3.05:1 na surface (= input-bg), najmniejszy % spełniający WCAG 1.4.11 (patrz niżej) |
| `--rs-accent-hover` / `--rs-accent-active` | `color-mix(in oklab, var(--rs-accent) 82% / 66%, black)` |
| `--rs-accent-strong` | `#1E75BC` (accent 82% w czerni, ten sam w dark) — wypełnienie CTA z białym tekstem (4.85:1) i aktywne ikony (≥3:1, WCAG 1.4.11); `--rs-accent` tylko dla elementów dekoracyjnych |
| `--rs-focus-border` | `var(--rs-accent-strong)` — ramka pola z fokusem: 4.85:1 na surface, wyraźnie mocniejsza od `--rs-input-border` (`--rs-accent` miał 2.98:1, tyle co ramka spoczynkowa) |
| `--rs-accent-ring` | `color-mix(in oklab, var(--rs-accent) 30%, transparent)` |
| `--rs-accent-soft` | `color-mix(in oklab, var(--rs-accent-2) 14%, white)` |
| `--rs-grad-brand` | `linear-gradient(to bottom right, #1E75BC, #0652A9)` (biały tekst ≥4.5:1 na całym gradiencie) |
| `--rs-dark-section-bg` | `color-mix(in oklab, var(--rs-accent-fg) 60%, black)` |
| `--rs-overlay` | `color-mix(in oklab, black 40%, transparent)` — tło pod szufladą i modalem |

Statusy (`oklch`):

| Status | bazowy | `-soft` (tło) | `-fg` (tekst) |
|---|---|---|---|
| success | `oklch(0.65 0.16 145)` | `oklch(0.94 0.05 145)` | `oklch(0.32 0.12 145)` |
| warn | `oklch(0.78 0.14 75)` | `oklch(0.96 0.06 75)` | `oklch(0.42 0.13 75)` |
| danger | `oklch(0.62 0.18 28)` | `oklch(0.95 0.04 28)` | `oklch(0.48 0.16 28)` |
| info | `oklch(0.55 0.13 250)` | — | — |

## Dark (`[data-theme="dark"]`)

| Token | Wartość |
|---|---|
| `--rs-bg` / `--rs-surface` / `--rs-surface-2` / `--rs-surface-3` | `color-mix(in oklab, var(--rs-accent) 24% / 30% / 36% / 42%, black)` |
| `--rs-fg` | `color-mix(in oklab, white 92%, var(--rs-accent))` |
| `--rs-line` / `--rs-line-strong` | `color-mix(in oklab, white 12% / 22%, var(--rs-surface))` |
| `--rs-accent` | bez zmian (`#2B9AF5`) |
| `--rs-accent-fg` | `color-mix(in oklab, var(--rs-accent) 78%, white)` |
| `--rs-accent-hover` | `color-mix(in oklab, var(--rs-accent) 88%, white)` |
| `--rs-input-bg` | `var(--rs-surface-2)` |
| `--rs-input-border` | `color-mix(in oklab, var(--rs-fg) 42%, var(--rs-surface))` — 3.37:1 na surface, 3.06:1 na input-bg (surface-2), najmniejszy % spełniający WCAG 1.4.11 |
| `--rs-focus-border` | `var(--rs-accent)` — 6.06:1 na surface, 5.49:1 na input-bg |
| `--rs-overlay` | `color-mix(in oklab, black 60%, transparent)` |
| success / danger | `oklch(0.70 0.16 145)` / `oklch(0.68 0.18 28)` |
| success-fg / warn-fg / danger-fg | `oklch(0.85 0.12 145)` / `oklch(0.86 0.11 75)` / `oklch(0.82 0.10 28)` (≥4.5:1 na `-soft`) |
| success-soft / danger-soft / warn-soft | `oklch(0.28 0.07 145)` / `oklch(0.30 0.08 28)` / `oklch(0.30 0.07 75)` |
| cienie kafli i karty głównej | `none` |

### Ramka pól i kart wyboru (WCAG 1.4.11)

`--rs-input-border` to ramka spoczynkowa pól formularza i kart wyboru roli. Ramka jest jedyną wizualną granicą pola, więc według WCAG 1.4.11 (Non-text Contrast) musi mieć ≥3:1 względem sąsiedniego tła: `--rs-surface` (karta, na której leży pole) i `--rs-input-bg` (wnętrze pola). Wartość to najmniejszy % mieszania z `--rs-fg`, który daje ≥3:1 na obu tłach, liczony osobno dla każdego motywu. Poprzednie 28% dawało 1.60:1 (light) i 2.12:1 (dark). Fokus pola używa `--rs-focus-border` (plus pierścień `shadow-focus`), a nie `--rs-accent` wprost: w light `--rs-accent` ma tyle samo kontrastu co ramka spoczynkowa, więc fokus odróżniałby się tylko odcieniem. Komponenty używają jednego tokenu (`focus:border-rs-focus-border`), a różnicę między motywami trzyma `global.css`. Hover (`--rs-fg-3`) pozostaje wyraźnie mocniejszy od ramki spoczynkowej: 4.66:1 (light) i 10.33:1 (dark) na surface.

Elementy stale ciemne (stopka, baner) używają `--rs-dark-section-bg`, nigdy `--rs-fg`/`--rs-bg` — te odwracają się w dark.

## Typografia

- **Manrope** (300–700) — font UI i nagłówków (`--rs-font-display`); **Nunito** — treść (`--rs-font-body`); cyfry: Manrope z `font-variant-numeric: tabular-nums` (`--rs-font-numeric`). Self-hosted przez `@fontsource/manrope` i `@fontsource/nunito` (bez Google Fonts — RODO), `display=swap`, licencja OFL.
- Baza: 14px, line-height 1.5, antialiasing.
- Skala: h1 22px · h2 18px · h3 15px · h4 13.5px/600 · p 13px/1.6 · label/small 11.5px.
- Tytuł strony: 600 28px/1.1, letter-spacing −0.025em (mobile 22px).
- Microlabel: 600 10.5px, uppercase, tracking 0.08em, kolor `--rs-fg-3`.
- Wagi: 500 treść i nawigacja, 600 tytuły i przyciski, 700 cena i przycisk accent.

## Kształt i ruch

- Promienie: karta 10px, przycisk/input 8px, `--rs-radius-sm` 6px, badge 4px, pill 999px, dock 20px.
- Cienie płaskie: `--rs-shadow-1: 0 1px 0 rgba(20,24,30,.02)`; karta główna `3px 3px 25px -4px #00000036`; focus `0 0 0 3px var(--rs-accent-ring)`; linki i przyciski na `:focus-visible` dostają `outline: 2px solid var(--rs-accent)` z offsetem 2px.
- Easing `cubic-bezier(.2,.7,.2,1)`, czasy 0.12 / 0.18 / 0.26s.
- Z-index: topbar 10, dock 50, modal 70, toast 80, drawer 110.

## Layout

- Strona: padding 28px 32px 60px, gap 18px, max-width 1440px (mobile: 16px 14px 92px — miejsce na dock).
- Breakpointy: ≤640px mobile, 641–980px tablet, >980px desktop; w Tailwindzie `--breakpoint-tablet: 641px` i `--breakpoint-desktop: 981px` (warianty `tablet:` / `desktop:`), bez domyślnych `sm`/`lg`.
- **Shell desktop:** grid `244px 1fr`. Sidebar sticky 100vh, tło surface, prawa ramka 1px line, padding 22px 14px; wordmark „helloDOM” (Manrope 700, kolor `--rs-accent-fg`, w dark `--rs-fg`); pozycja nawigacji 13.5px/500, padding 9px 10px, radius 6, ikona 16px; aktywna: tło surface-2, waga 600, ikona `--rs-accent-strong`.
- **Tablet:** sidebar zwinięty do ikon (64px).
- **Topbar:** sticky, padding 16px 32px, tło surface, dolna ramka line; po prawej awatar + imię (13.5px/600) + rola (11px).
- **Mobile ≤640px:** sidebar jako szuflada (86%, max 320px, z lewej, backdrop z blur 2px); topbar: hamburger 36px + wycentrowany wordmark; pływający dock: fixed, 10px od krawędzi, bottom 8px + safe-area, grid 5 kolumn, radius 20, przyciski min. 54px, etykiety 9.5px; aktywny: etykieta `--rs-accent-fg`, ikona `--rs-accent-strong`.

## Komponenty

- **Button:** 38px, padding 10×16, radius 8, 600 13px, ramka line-strong; hover: uniesienie −2px + cień `0 6px 18px rgba(15,23,42,.08)`. Warianty: `primary` (tło `--rs-fg`), `accent` (`--rs-accent-strong`, 700, hover `--rs-accent-active`), `ghost`, `link`; rozmiary `sm` 30px, `lg` 46px. Icon button 34px.
- **Card:** surface, ramka 1px line, radius 10; nagłówek padding 13×18 z ikoną 26px w kafelku surface-2 i tytułem 600 14px; treść padding 14×18.
- **Input / Select / Textarea:** 38px, padding 10×12, radius 8, ramka line, 500 13.5px; focus: ramka accent + focus ring; błąd (`data-state="error"`): ramka danger.
- **Badge:** 600 10.5px, padding 3×7, radius 4, tło accent-soft, tekst accent-fg.
- **Pill statusu:** `data-status="success|warn|danger|info|accent"`, tło `-soft`, tekst `-fg`, kropka 6px.
- **Wiersz oferty:** grid `96px 1fr auto`, kafel 4:3 (ikona typu nieruchomości zamiast zdjęcia), cena 700 17px tabular. Siatka ofert: `repeat(auto-fill, minmax(320px, 1fr))`, gap 14.

## Definition of Done dla widoku

7 stanów (default, hover, focus, disabled, error, empty, loading), light i dark, polskie znaki, 360px bez poziomego scrolla.

## Czego nie używamy

Zdjęć, logotypów ani nazw marek innych produktów. Wordmark i favicon helloDOM są własne (SVG). Tło hero: `--rs-grad-brand`.
