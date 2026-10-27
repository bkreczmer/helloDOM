# Pierwsze wdrożenie helloDOM na Cloudflare Workers + auto-deploy z CI

## Context

`context/foundation/infrastructure.md` wybrał Cloudflare Workers (static assets), a `tech-stack.md` zapisuje `deployment_target: cloudflare-workers` i `ci_default_flow: auto-deploy-on-merge`. Worker `hellodom` jeszcze nie istnieje (`wrangler deployments list --name hellodom` → błąd), `wrangler.jsonc` ma już `"name": "hellodom"`. Lokalny wrangler 4.152 jest zalogowany na konto `b084c91e…` (potwierdzone jako właściwe). W repo są sekrety `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`; brak `SUPABASE_URL`/`SUPABASE_KEY` (niepotrzebne do buildu — w `astro.config.mjs` są `optional: true`, czytane w runtime przez `astro:env/server`). Cel: publiczny URL `hellodom.<subdomain>.workers.dev` z produkcyjnym Supabase oraz deploy po każdym zielonym pushu do `main`.

Niezacommitowane zmiany w working tree (wejdą do tej samej gałęzi): `wrangler.jsonc` (rename), `context/foundation/tech-stack.md`, nowy `context/foundation/infrastructure.md`.

## Kroki

### 0. Zapis planu jako artefakt projektu
- Skopiować ten plan do `context/deployment/deploy-plan.md` (utworzyć katalog `context/deployment/`).
- Plik wchodzi do commita z kroku 5.

### 1. Pierwszy deploy lokalny (zatwierdzony przez człowieka — zgodnie z „Approval” w infrastructure.md)
- `npm run build && npx wrangler deploy` — tworzy Workera `hellodom`, wypisuje URL i `<subdomain>`.
- Zanotować dokładny URL (potrzebny w kroku 3 i 4).

### 2. Sekrety Supabase (wpisuje użytkownik, wartości nie trafiają do czatu)
- Użytkownik uruchamia w promptcie:
  - `! npx wrangler secret put SUPABASE_URL`
  - `! npx wrangler secret put SUPABASE_KEY` (anon key produkcyjnego projektu, nigdy service-role)
- Każdy `secret put` publikuje nową wersję Workera; osobny redeploy niepotrzebny. Sekrety przetrwają kolejne `wrangler deploy` z CI.
- Weryfikacja bez ujawniania wartości: `npx wrangler secret list --name hellodom` (tylko nazwy).

### 3. Job `deploy` w `.github/workflows/ci.yml`
Dodać trzeci job do istniejącego workflow (wzorzec kroków jak w jobie `ci`):
- `needs: [ci, smoke]`, `if: github.event_name == 'push' && github.ref == 'refs/heads/main'`
- `concurrency: { group: deploy-production, cancel-in-progress: false }`
- kroki: `actions/checkout@v4` → `actions/setup-node@v4` (`node-version-file: .nvmrc`, `cache: npm`) → `npm ci` → `npm run build` → `npx wrangler deploy` z `env: CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}`, `CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}`
- krok po deployu: `curl -sf -o /dev/null https://hellodom.<subdomain>.workers.dev/` (subdomain z kroku 1). Bez `npm run smoke` na produkcji — smoke rejestruje konta i zaśmieciłby produkcyjny Supabase.
- Używa wranglera przypiętego w `package.json` (nie `wrangler-action`), więc lokalnie i w CI działa ta sama wersja.

### 4. Dokumentacja (drobne, edycja w miejscu)
- `README.md` sekcja CI: dopisać trzeci job **deploy** (po zielonych `ci` + `smoke`, tylko push do `main`, sekrety `CLOUDFLARE_*`) i URL produkcyjny.
- `AGENTS.md` (= `CLAUDE.md`) linia CI: dopisać „deploy job on push to `main` after ci + smoke”.
- `infrastructure.md` „Getting Started”: bez zmian merytorycznych; ewentualnie wpisać faktyczny URL.

### 5. Commit / PR
Zgodnie z zasadą użytkownika nie commituję sam bez prośby. Propozycja: gałąź `ci/first-deploy`, commit `ci: deploy to Cloudflare Workers on push to main` (+ `docs:` dla README/AGENTS i foundation docs), PR do `main`. Merge PR uruchamia pierwszy deploy z CI.

## Pliki
- `context/deployment/deploy-plan.md` — kopia tego planu (nowy)
- `.github/workflows/ci.yml` — nowy job `deploy`
- `README.md`, `CLAUDE.md` (AGENTS.md to symlink) — opis deployu
- `wrangler.jsonc`, `context/foundation/tech-stack.md`, `context/foundation/infrastructure.md` — już zmienione, do commita

## Weryfikacja
1. Po kroku 1: `curl -s -o /dev/null -w '%{http_code}' https://hellodom.<subdomain>.workers.dev/` → `200`.
2. Po kroku 2: strona główna nie pokazuje banera „Supabase nie jest skonfigurowany” (`curl -s <URL>/ | grep -c "nie jest skonfigurowany"` → `0`); `/auth/signin` → `200`; `/dashboard` bez sesji → `302` na `/auth/signin`.
3. `npx wrangler tail hellodom --format pretty` podczas ręcznego logowania — brak błędów (w tym 1102 / CPU limit).
4. Na PR: joby `ci` i `smoke` zielone, `deploy` pominięty (`if` dla pull_request).
5. Po merge: `gh run watch` → job `deploy` zielony; `npx wrangler deployments list --name hellodom` pokazuje nową wersję z czasem merge; curl z punktu 1 nadal `200`.
6. Rollback sprawdzony na sucho: `npx wrangler deployments list --name hellodom` zwraca ≥2 wersje (rollback możliwy przez `npx wrangler rollback <version-id>`).

## Ryzyka do obserwacji
- Token `CLOUDFLARE_API_TOKEN` bez uprawnienia „Workers Scripts: Edit” → job `deploy` padnie z 10000/auth error; naprawa po stronie tokenu w dashboardzie Cloudflare.
- Produkcyjny Supabase: logowanie wymaga potwierdzenia e-maila (domyślne ustawienie) — do decyzji użytkownika, nie zmieniam.
