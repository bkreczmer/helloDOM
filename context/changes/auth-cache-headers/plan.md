# Nagłówki no-store na odpowiedziach ustawiających ciasteczka sesji — plan implementacji

## Overview

`@supabase/ssr` przy każdym zapisie ciasteczek sesji przekazuje do `setAll` drugi argument: nagłówki `Cache-Control: private, no-cache, no-store, must-revalidate, max-age=0`, `Expires: 0`, `Pragma: no-cache`. Biblioteka zaznacza, że odpowiedź ustawiająca ciasteczka auth nie może trafić do cache CDN, bo token sesji jednego użytkownika mógłby zostać podany innemu. Nasza fabryka klienta ten argument ignoruje. Poprawiamy to w jednym miejscu: fabryka zapamiętuje nagłówki dla żądania, a middleware nakłada je na odpowiedź.

Bez migracji i zmian w schemacie.

Źródła: `context/domain/03-anti-corruption-layer.md` §3.2, `node_modules/@supabase/ssr/dist/main/types.d.ts:23-58`.

## Current State Analysis

- `src/lib/supabase.ts:15` — `setAll(cookiesToSet)` bez drugiego argumentu; nagłówki giną.
- Klient powstaje w 18 plikach (middleware, 9 endpointów API, 7 stron, callback), wszystkie przez `createClient(headers, cookies)`.
- Ciasteczka sesji ustawiają: signin, signup, signout, callback, usunięcie konta oraz odświeżenie tokenu w `getUser()` w middleware.
- Middleware (`src/middleware.ts`) obsługuje każde żądanie dynamiczne i ma kilka wczesnych `return` (przekierowania).

### Key Discoveries:

- Middleware i strona/endpoint w jednym żądaniu dzielą tę samą instancję `AstroCookies`, więc może ona służyć za klucz stanu per żądanie (`WeakMap`) bez zmiany sygnatury `createClient` w 18 plikach.
- `context.redirect()` tworzy `new Response(...)` z modyfikowalnymi nagłówkami (`node_modules/astro/dist/core/middleware/index.js:48-52`).
- Nagłówki przychodzą tylko przy pierwszym zapisie ciasteczek danego klienta; przy kilku klientach w żądaniu trzeba je scalić, a nie nadpisać pustym obiektem.

## Desired End State

- Każda odpowiedź, przy której `@supabase/ssr` zapisał ciasteczka sesji, ma `Cache-Control` z `no-store` (oraz `Expires`, `Pragma`).
- Odpowiedzi bez zapisu ciasteczek sesji nie dostają tych nagłówków (bez zmian dla stron publicznych).
- Smoke sprawdza `no-store` na signup, signin i signout.

## What We're NOT Doing

- Anti-corruption layer dla klienta Supabase (`context/domain/03-anti-corruption-layer.md`) — tylko poprawka kontraktu `setAll`.
- Zmiany sygnatury `createClient` i 17 wywołań poza middleware.
- Reguł cache w panelu Cloudflare.
- Testów jednostkowych `src/lib/supabase.ts` — moduł importuje `astro:env/server`, którego Vitest nie ładuje; dowodem jest smoke na żywym serwerze.

## Implementation Approach

Jedna faza. Fabryka zapisuje nagłówki w `WeakMap<AstroCookies, Record<string, string>>` i eksportuje `applyAuthCacheHeaders(cookies, response)`. Middleware dostaje cienkie opakowanie: dotychczasowa logika staje się `guard`, a `onRequest` nakłada nagłówki na każdą odpowiedź, którą `guard` zwraca (także wczesne przekierowania).

## Phase 1: Nagłówki cache z setAll na odpowiedzi

### Overview

Przenieść nagłówki z `setAll` na odpowiedź HTTP i objąć to smoke'iem.

### Changes Required:

#### 1. Fabryka klienta

**File**: `src/lib/supabase.ts`

**Intent**: Nie gubić drugiego argumentu `setAll`; zapamiętać nagłówki dla żądania i udostępnić funkcję, która nałoży je na odpowiedź.

#### 2. Middleware

**File**: `src/middleware.ts`

**Intent**: Każda odpowiedź (z `next()` i wczesne przekierowania) przechodzi przez `applyAuthCacheHeaders`. Logika bramki bez zmian.

#### 3. Smoke

**File**: `scripts/smoke.mjs`

**Intent**: Kroki signup, signin i signout oczekują `no-store` w `Cache-Control`.

### Success Criteria:

#### Automated Verification:

- [x] Lint przechodzi: `npm run lint`
- [x] Typy przechodzą: `npx astro check`
- [x] Build przechodzi: `npm run build`
- [x] Testy jednostkowe przechodzą: `npm run test:unit`
- [x] Smoke na działającym serwerze przechodzi: `npm run smoke`
- [x] Celowe uszkodzenie (cofnięcie zmian w `src/lib/supabase.ts` i `src/middleware.ts`) czerwieni smoke na signup, signin i signout

#### Manual Verification:

- [x] Na produkcji `POST /api/auth/signin` z poprawnym hasłem zwraca `Cache-Control` z `no-store`, a `GET /` anonimowo — bez niego

## Performance Considerations

Brak: jedna operacja na `WeakMap` na żądanie; wpis znika razem z `AstroCookies`.

## Migration Notes

Brak.

## References

- `context/domain/03-anti-corruption-layer.md` §3.2
- `node_modules/@supabase/ssr/dist/main/types.d.ts:23-58`

## Addendum — odstępstwa z implementacji

- `MiddlewareHandler` zwraca `Response | void`, więc `guard` jest funkcją typowaną jako `Promise<Response>` (CI `astro check` na PR #30).
- Triage impl-review (CI), F1: `applyAuthCacheHeaders` kopiuje odpowiedź, gdy jej nagłówki są niemodyfikowalne (`Response.redirect()`, `fetch()`); Astro dokleja ciasteczka po middleware (`node_modules/astro/dist/core/middleware/astro-middleware.js:56`), więc kopia ich nie gubi.
- Krok 1.5 sprawdzony na produkcji 29.10 innym żądaniem niż w planie: `GET /owner` z nieważnym ciasteczkiem `sb-…-auth-token` (sesja czyszczona, `Max-Age=0`) zwraca `Cache-Control: private, no-cache, no-store, must-revalidate, max-age=0`, `Expires: 0`, `Pragma: no-cache`; anonimowe `GET /` — bez `Cache-Control`. Signin z prawdziwym kontem pokrywa smoke w CI (bez zakładania kont na produkcji).
- Triage impl-review (CI), F2: smoke sprawdza też brak `no-store` na anonimowym `GET /` (pozytywna strona punktu 1.5 zostaje ręczna na produkcji).

## Progress

### Phase 1: Nagłówki cache z setAll na odpowiedzi

#### Automated

- [x] 1.1 Lint, typy i build — 9dc620f
- [x] 1.2 Testy jednostkowe — 55e19ff
- [x] 1.3 Smoke na działającym serwerze — 995087d
- [x] 1.4 Celowe uszkodzenie czerwieni smoke — 995087d

#### Manual

- [x] 1.5 Nagłówki na produkcji — 995087d
