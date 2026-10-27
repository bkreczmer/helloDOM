# helloDOM

Właściciel nieruchomości, który chce ją sprzedać lub wynająć, nie wie, którego agenta wybrać. helloDOM liczy dla każdego agenta wynik dopasowania 0–100 do konkretnej oferty (miasto, typ nieruchomości, przedział cen, doświadczenie) i pokazuje trzech najlepiej dopasowanych. Właściciel zaprasza jednego z nich, a agent przyjmuje albo odrzuca zaproszenie.

Pełny zakres produktu: [`context/foundation/prd.md`](context/foundation/prd.md).

## Stack

Astro 7 (SSR) + React 19 + TypeScript + Tailwind CSS 4, Supabase (Postgres + Auth), Cloudflare Workers. Uzasadnienie wyboru: [`context/foundation/tech-stack.md`](context/foundation/tech-stack.md).

## Wymagania

- Node.js 24 (zgodnie z `.nvmrc`) i npm
- Docker (dla lokalnego Supabase, ok. 7 GB RAM)

## Setup lokalny

1. Zainstaluj zależności:

   ```bash
   npm install
   ```

2. Uruchom lokalny Supabase (przy pierwszym uruchomieniu pobierze obrazy Dockera):

   ```bash
   npx supabase start
   ```

3. Utwórz pliki z sekretami i wpisz do nich `API URL` oraz `anon key` z wyjścia poprzedniego polecenia (`SUPABASE_URL`, `SUPABASE_KEY`):

   ```bash
   cp .env.example .env
   cp .env.example .dev.vars
   ```

   `.env` służy narzędziom Node, `.dev.vars` lokalnemu runtime'owi Cloudflare. Oba pliki są w `.gitignore`. Nigdy ich nie commituj.

4. Uruchom serwer deweloperski:

   ```bash
   npm run dev
   ```

Lokalne Supabase Studio działa pod `http://localhost:54323`, a `npx supabase stop` zatrzymuje stack.

Supabase domyślnie wymaga potwierdzenia e-maila przed logowaniem. Na czas lokalnego developmentu możesz to wyłączyć w **Authentication → Email → Confirm email**.

## Skrypty

- `npm run dev` — serwer deweloperski (runtime Cloudflare workerd)
- `npm run build` / `npm run preview` — build produkcyjny i jego podgląd
- `npm run lint` / `npm run lint:fix` — ESLint z regułami opartymi na typach
- `npm run format` — Prettier
- `npx astro check` — sprawdzenie typów
- `npm run smoke` — smoke test przepływu auth na działającym serwerze (`BASE_URL`, domyślnie `http://localhost:4321`)

## Deploy

```bash
npm run build
npx wrangler deploy
```

`SUPABASE_URL` i `SUPABASE_KEY` ustaw jako sekrety w Cloudflare (`npx wrangler secret put <NAZWA>`).

## CI

GitHub Actions (`.github/workflows/ci.yml`) uruchamia dwa joby przy każdym pushu i PR do `main`:

- **ci** — lint, `astro check` i build. Wymaga sekretów repozytorium `SUPABASE_URL` i `SUPABASE_KEY`.
- **smoke** — stawia lokalny Supabase, buduje aplikację, serwuje podgląd produkcyjny i uruchamia `npm run smoke`.

## Praca nad zmianami

Dokumenty bazowe (PRD, stack) są w `context/foundation/`, a każda zmiana ma własny folder w `context/changes/<change-id>/`. Zasady dla agentów AI: [`AGENTS.md`](AGENTS.md).

## Licencja

MIT
