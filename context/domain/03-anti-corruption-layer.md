---
title: "Anti-corruption layer: dostęp do danych i auth Supabase za wąskimi portami"
created: 2026-10-29
type: refactor-plan
---

# Anti-corruption layer: Supabase za wąskimi portami

Plan refaktoru. Kod produkcyjny nie jest tu zmieniany. Wszystkie `plik:linia` sprawdzone na `HEAD` gałęzi `docs/architect-m4` (`c257f0c`).

## Krok 0. Kontekst

**Stack:** Astro 7 SSR + React 19 (wyspy), TypeScript, Tailwind 4, Supabase (Postgres + Auth + RLS), Cloudflare Workers (`README.md:9`, `context/foundation/tech-stack.md:24`).

**Zależności zewnętrzne runtime** (`package.json`): `@supabase/ssr` ^0.12.7 (zainstalowane 0.12.7), `@supabase/supabase-js` ^2.99.1 (zainstalowane 2.116.0), `astro`, `@astrojs/cloudflare`, `@astrojs/react`, `react`/`react-dom`, `lucide-react`, `@radix-ui/react-slot`, `class-variance-authority`, `clsx`, `tailwind-merge`. Typy bazy generuje CLI `supabase` (`package.json` → `db:types`) do `src/db/database.types.ts` (333 linie).

**Warstwy kodu** (deklarowane w `CLAUDE.md`):

| Warstwa          | Miejsce                                                              | Deklaracja                                                                                            |
| ---------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Wejście (SSR)    | `src/middleware.ts`, `src/pages/**/*.astro`, `src/pages/api/**/*.ts` | „`/api/*` is not gated: each endpoint checks `locals.user` and reads the role from `profiles` itself” |
| Logika biznesowa | `src/lib/services/`                                                  | „**Business logic** in `src/lib/services/`; shared types and DTOs in `src/types.ts`”                  |
| Infrastruktura   | `src/lib/supabase.ts`                                                | „Supabase SSR client (`@supabase/ssr`, cookie sessions)”                                              |
| UI               | `src/components/**` (`.astro` + wyspy `.tsx`)                        | „`.tsx` only when it has state or an event handler”                                                   |

**Deklaracje wymienialności:** w `prd.md`, `tech-stack.md`, `README.md`, `infrastructure.md` nie ma zdania „żeby dało się wymienić X”. Supabase jest wybrany świadomie jako całość („ships auth, a Postgres database and edge deployment out of the box”, `tech-stack.md:24`). Jedyna intencja separacyjna to podział warstw z `CLAUDE.md` (logika w `src/lib/services/`, DTO w `src/types.ts`) — i to ją zestawiam z kodem w kroku 3. Ryzyko realne nie dotyczy więc „migracji z Supabase jutro”, tylko kosztu każdej zmiany kontraktu biblioteki (major `@supabase/ssr`, `getUser` → `getClaims`, zmiana kolumny) i tego, że reguły dostępu (rola) są skopiowane w wielu plikach.

## Krok 1. Identyfikacja przeciekających zależności

Komenda bazowa: `rg -n 'from "@supabase|database.types|\.from\(|\.rpc\(|\.auth\.' src/` + osobno `astro:*` i `lucide-react`.

### L1. Klient Supabase (query builder PostgREST + `auth`) — `@supabase/ssr` przez `createClient`

Fabryka: `src/lib/supabase.ts:1` (`createServerClient` z `@supabase/ssr`), `:6` (`createClient`). Zwracany obiekt (`SupabaseClient<Database>`) jest używany bezpośrednio w 18 plikach warstwy wejścia; 26 wywołań `.from(`/`.rpc(` (22 + 4) i 8 wywołań `.auth.*`:

| Plik                                     | `createClient` | `.from` / `.rpc`                                                         | `.auth.*`                    |
| ---------------------------------------- | -------------- | ------------------------------------------------------------------------ | ---------------------------- |
| `src/middleware.ts`                      | :8             | `.from("profiles")` :43                                                  | `getUser` :16, `signOut` :55 |
| `src/pages/api/auth/signin.ts`           | :22            | —                                                                        | `signInWithPassword` :27     |
| `src/pages/api/auth/signup.ts`           | :25            | —                                                                        | `signUp` :33                 |
| `src/pages/api/auth/signout.ts`          | :6             | —                                                                        | `signOut` :8                 |
| `src/pages/auth/callback.ts`             | :21            | —                                                                        | `exchangeCodeForSession` :26 |
| `src/pages/api/account/delete.ts`        | :17            | `profiles` :26, `rpc("delete_own_account")` :44                          | `signOut` :65                |
| `src/pages/api/agent/profile.ts`         | :9             | `profiles` :22, :48                                                      | —                            |
| `src/pages/api/agent/invitations.ts`     | :21            | `profiles` :34, `rpc("respond_to_invitation")` :53                       | —                            |
| `src/pages/api/owner/offers.ts`          | :9             | `profiles` :23, `offers` :49                                             | —                            |
| `src/pages/api/owner/offers/update.ts`   | :21            | `profiles` :34, `offers` :60, :84                                        | —                            |
| `src/pages/api/owner/offers/delete.ts`   | :20            | `profiles` :33, `offers` :52                                             | —                            |
| `src/pages/api/owner/invitations.ts`     | :20            | `profiles` :33, `rpc("invite_agent")` :52                                | —                            |
| `src/pages/owner/index.astro`            | :21            | `offers` :27                                                             | —                            |
| `src/pages/owner/offers/[id].astro`      | :25            | `offers` :42, `rpc("rank_agents_for_offer")` :62, `invitations` :78, :97 | —                            |
| `src/pages/owner/offers/[id]/edit.astro` | :24            | `offers` :34                                                             | —                            |
| `src/pages/agent/index.astro`            | :18            | `invitations` :25                                                        | —                            |
| `src/pages/agent/offers/[id].astro`      | :16            | `offers` :30, `invitations` :50                                          | —                            |
| `src/pages/agent/profile.astro`          | :19            | `profiles` :30                                                           | —                            |

Razem z wywołaniami „znają” też **schemat w snake_case** (nazwy tabel, kolumn, parametrów RPC `p_offer_id`) i semantykę PostgREST (`.maybeSingle()`, `.select("id")` po update jako licznik wierszy).

### L2. Wygenerowane typy `Database` (`src/db/database.types.ts`)

| Plik                                | Linia                | Co wyciąga                                                                          |
| ----------------------------------- | -------------------- | ----------------------------------------------------------------------------------- |
| `src/lib/supabase.ts`               | :4, :10              | generyk klienta                                                                     |
| `src/types.ts`                      | :1, :27, :31         | `ProfileRow` → `Profile` (typ `locals.profile`)                                     |
| `src/lib/services/offers.ts`        | :2, :77-78, :91, :93 | `OfferRow`, `OfferListRow`, `RankedAgentRow` (`Functions["rank_agents_for_offer"]`) |
| `src/lib/services/invitations.ts`   | :2, :108-113         | `InvitationRow`, `OfferRow`, `AgentInvitationRow` (kształt embedu `offers(...)`)    |
| `src/lib/services/agent-profile.ts` | :2, :51-52           | `AgentProfileRow`                                                                   |
| `tests/integration/helpers.ts`      | :3                   | klient testowy                                                                      |
| `tests/e2e/helpers.ts`              | :7                   | klient testowy                                                                      |

### L3. Typy i błędy `@supabase/supabase-js` poza fabryką

| Plik                              | Linia              | Co                                                                                                    |
| --------------------------------- | ------------------ | ----------------------------------------------------------------------------------------------------- |
| `src/env.d.ts`                    | :3                 | `App.Locals.user: import("@supabase/supabase-js").User` — typ biblioteki w kontrakcie całej aplikacji |
| `src/lib/report-error.ts`         | :3, :40, :60, :110 | `isAuthError`, `isAuthRetryableFetchError`, `PostgrestError` — klasyfikacja błędów                    |
| `tests/unit/report-error.test.ts` | :3                 | klasy błędów do testów                                                                                |

Konsumenci `User` przez `locals.user` (pole biblioteczne `email?: string`, stąd `?? ""`): `src/layouts/AppLayout.astro:22`, `src/pages/owner/account.astro:9`, `src/pages/agent/account.astro:9`, `src/pages/agent/index.astro:19`, `src/pages/index.astro:7`.

### L4. Kody błędów Supabase Auth w serwisie

`src/lib/services/auth-errors.ts:33-44`: „Supabase codes that have no code of their own”, `SUPABASE_CODE_ALIASES` (`over_email_send_rate_limit` → `rate_limited`) i `toAuthErrorCode`, które zakłada, że `AuthError.code` z biblioteki (`ErrorCode`, `node_modules/@supabase/auth-js/dist/module/lib/error-codes.d.ts:6`) pokrywa się z domenowym `AuthErrorCode`. Wołane z `src/pages/api/auth/signup.ts:39` (i analogicznie w `signin.ts`). Do tego `signup.ts:36` zna mechanizm Supabase `options.data` (`user_metadata`), przez który rola trafia do triggera tworzącego profil.

### L5. `astro:*`

`astro:env/server`: `src/lib/supabase.ts:3`, `src/lib/config-status.ts:1`, `src/pages/api/auth/signup.ts:2`; `astro:middleware`: `src/middleware.ts:1`. To framework, w którym żyje cała warstwa wejścia — nie przecieka przez granicę domeny (serwisy go nie importują).

### L6. `lucide-react`

29 plików (15 `.tsx`, reszta `.astro`), wyłącznie w `src/components/**` i `src/pages/**` (np. `src/components/shell/nav.ts:1` eksportuje `LucideIcon` w konfiguracji nawigacji). Jedna warstwa (UI), brak wejścia do serwisów i kontraktów danych.

## Krok 2. Klasyfikacja i wybór #1

| #   | Zależność                                                  | (a) warstwy / pliki                                                           | (b) ryzyko i koszt wymiany dziś                                                                                                               | (c) deklaracja w dokumentach                                                                                   |
| --- | ---------------------------------------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| L1  | klient Supabase (`@supabase/ssr` + query builder + `auth`) | wejście (middleware, 9 API, 7 stron, callback) — **18 plików**, 34 wywołania  | **wysoki**: każda zmiana kontraktu (`setAll(cookies, headers)`, `getClaims`, nazwa kolumny) to edycja w 18 plikach; reguła roli skopiowana 7× | `CLAUDE.md` „Business logic in `src/lib/services/`” — kod robi odwrotnie (26 zapytań w wejściu, 0 w serwisach) |
| L2  | `Database` types                                           | typy DTO + 3 serwisy + fabryka + testy — **5 plików src + 2 testy**           | średni: regeneracja typów łamie mapery w serwisach; serwisy znają kształt wierszy, ale nie zapytań, które je produkują                        | `CLAUDE.md` „shared types and DTOs in `src/types.ts`” — `src/types.ts:27` buduje DTO z typu wiersza            |
| L3  | `supabase-js` `User` / błędy                               | kontrakt `Locals` (cała aplikacja) + logger — **2 pliki src + 5 konsumentów** | średni: `User` jest w `App.Locals`, więc każdy plik czytający `locals.user` zależy od kształtu biblioteki                                     | brak                                                                                                           |
| L4  | kody Auth w serwisie                                       | 1 serwis + 2 endpointy                                                        | niski–średni                                                                                                                                  | brak                                                                                                           |
| L5  | `astro:*`                                                  | 4 pliki, warstwa wejścia/config                                               | brak (framework hosta)                                                                                                                        | brak                                                                                                           |
| L6  | `lucide-react`                                             | 29 plików, tylko UI                                                           | niski (ikony; podmiana mechaniczna)                                                                                                           | brak                                                                                                           |

**Wybór #1: L1 — klient Supabase użyty bezpośrednio w warstwie wejścia**, a L2–L4 to jego odnogi i zamykam je tym samym ACL. Uzasadnienie: największy zasięg (18 plików, 34 wywołania), jedyny przeciek, który niesie **regułę bezpieczeństwa** (sprawdzenie roli w 7 endpointach) i **wiedzę o schemacie** (listy kolumn, snake_case) rozsianą po stronach, oraz jedyny, przy którym kod rozjeżdża się z zadeklarowaną intencją warstw (`CLAUDE.md`). `lucide-react` i `astro:*` mają szeroki zasięg plikowy, ale siedzą w jednej warstwie, do której należą.

## Krok 3. Diagnoza

### 3.1 Duplikacja

**D1. Sprawdzenie roli — 7 kopii tego samego bloku** (`createClient` → `.from("profiles").select("role").eq("id", user.id).maybeSingle()` → `profile?.role !== X` → 403):

- `src/pages/api/owner/offers.ts:22-33`
- `src/pages/api/owner/offers/update.ts:33-44`
- `src/pages/api/owner/offers/delete.ts:32-43`
- `src/pages/api/owner/invitations.ts:32-43`
- `src/pages/api/agent/profile.ts:21-32`
- `src/pages/api/agent/invitations.ts:33-44`
- `src/pages/api/account/delete.ts:25-35` (wariant: rola do przekierowania, rzutowanie `profile.role as Role` :35)

Ósma, szersza kopia: `src/middleware.ts:42-46` (`select("id, role, created_at")`) z rzutowaniem `data as Profile` :63. To samo założenie („The check constraint on profiles.role guarantees a Role”) jest powtórzone w `middleware.ts:62` i `account/delete.ts:34`.

**D2. Lista kolumn pełnej oferty — 3 identyczne stringi** `"id, city, property_type, transaction, price, area_m2, rooms, description, status, created_at"`:

- `src/pages/owner/offers/[id].astro:43`
- `src/pages/owner/offers/[id]/edit.astro:35`
- `src/pages/agent/offers/[id].astro:31`

Odbiorca tych danych, `toOffer(row: OfferRow)`, jest w `src/lib/services/offers.ts:107`, a `OfferRow` (`:77-78`) to `Pick` tych samych kolumn. Wiedza o jednym kształcie jest rozcięta: kolumny w stronie, typ i mapowanie w serwisie. Analogicznie lista ofert: `src/pages/owner/index.astro:28` ↔ `OfferListRow` `offers.ts:91`; embed zaproszeń: `src/pages/agent/index.astro:26` ↔ komentarz-kopia selectu w `src/lib/services/invitations.ts:111`; profil agenta: `src/pages/agent/profile.astro:31` ↔ `AgentProfileRow` `agent-profile.ts:51-52`.

**D3. Mapowanie domena → wiersz przy zapisie oferty — 2 kopie** (`property_type: propertyType`, `area_m2: areaM2` …):

- `src/pages/api/owner/offers.ts:50-58` (insert)
- `src/pages/api/owner/offers/update.ts:61-69` (update)

Trzecie mapowanie tego typu (profil agenta): `src/pages/api/agent/profile.ts:49-55`. Odczyt (wiersz → domena) jest w serwisach, zapis (domena → wiersz) w endpointach — ACL ma dziś dwie połówki w dwóch warstwach.

**D4. „Aktywne zaproszenie” jako filtr zapytania** — `.in("status", ["pending", "accepted"])` w `src/pages/owner/offers/[id].astro:100` i `src/pages/agent/offers/[id].astro:53`; reguła domenowa wyrażona składnią PostgREST w dwóch stronach (por. agregat 3 w `context/domain/domain-distillation.md:163`).

### 3.2 Przecieki przez granice

- **Klient/serwer:** sprawdzone, że _groźny_ przypadek nie występuje. Żadna wyspa `.tsx` nie importuje `@supabase/*` ani `@/lib/supabase` (importy wysp: tylko `react`, `lucide-react`, `@/components/*`, `@/lib/dictionaries`, `@/lib/route-guard`, `@/lib/utils` i `import type` z `@/types` / `@/lib/services/agent-profile`). `src/types.ts:1` importuje `Database` wyłącznie jako typ, więc znika przy kompilacji. Ostatni build (`dist/client`, 29.10 18:10): `rg -l -i "supabase|postgrest|gotrue" dist/client` → 0 plików. Granica jest dziś trzymana **konwencją**, nie regułą: `eslint.config.js` nie ma `no-restricted-imports`, więc jeden import runtime w wyspie wciągnąłby SDK do bundla. Plan zamyka to regułą (faza 7).
- **Typ biblioteki w kontrakcie aplikacji:** `src/env.d.ts:3` — `User` z `supabase-js` jest typem `locals.user`, czyli wire-kontraktem między middleware a każdą stroną.
- **Typ wiersza w DTO:** `src/types.ts:31` — `Profile = Pick<ProfileRow, "id" | "created_at"> & { role: Role }`; DTO domenowy jest pochodną schematu bazy.
- **Wiedza o bibliotece w serwisie:** `src/lib/services/auth-errors.ts:33-44` (kody Supabase Auth).
- **Kontrakt biblioteki niedotrzymany w fabryce:** `@supabase/ssr` przekazuje do `setAll` drugi argument z nagłówkami `Cache-Control: private, no-cache, no-store…` i zaznacza, że „Responses that set auth cookies must not be cached by CDNs” (`node_modules/@supabase/ssr/dist/main/types.d.ts:23-58`, nagłówki :41). `src/lib/supabase.ts:15` ma `setAll(cookiesToSet)` — drugi argument jest ignorowany. Aplikacja działa za Cloudflare, o którym ta sama dokumentacja wspomina wprost (`types.d.ts:119-121`). To dziś trzeba by poprawiać w fabryce _i_ pamiętać o tym w 18 plikach, które tworzą klienta; po refaktorze — w jednym adapterze.

### 3.3 Intencja vs kod

`CLAUDE.md`: „**Business logic** in `src/lib/services/`”. Kod: 26 zapytań i 4 RPC w stronach/endpointach, 0 w serwisach (`context/map/evidence/3-structure.md:75`, :80 — „services contain no Supabase calls”). Reguły biznesowe zależne od danych (rola, „aktywne zaproszenie”, „0 wierszy po update = zablokowana albo cudza”, `src/pages/api/owner/offers/update.ts:57-58`, :80-95) żyją więc w warstwie wejścia i są testowalne tylko integracyjnie/E2E. `3-structure.md:75` nazywa to „a convention, not drift” — to prawda dla _sprawdzenia roli per endpoint_, ale nie dla _zapytań_: deklaracja mówi o logice w serwisach, a serwisy dostają tylko gotowe wiersze.

## Krok 4. Projekt ACL

### 4.1 Układ katalogów

```
src/lib/ports/                 ← domena: interfejsy + typy domenowe wyników (zero importów bibliotek)
  data-access.ts               DataAccess, SessionPort, ProfilesPort, OffersPort, InvitationsPort, AccountPort
  result.ts                    Result<T>, DataFailure, DataError
src/lib/adapters/supabase/     ← JEDYNE miejsce z @supabase/* i @/db/database.types
  client.ts                    createServerClient (dawne src/lib/supabase.ts) + nagłówki cache
  codecs.ts                    OfferCodec, OfferListCodec, AgentProfileCodec, InvitationCodec, ProfileCodec
  errors.ts                    toDataError(), toAuthErrorCode() (z auth-errors.ts:33-44)
  session.ts, profiles.ts, offers.ts, invitations.ts, account.ts   ← implementacje portów
  index.ts                     createDataAccess(requestHeaders, cookies): DataAccess | null
```

`src/lib/services/` zostaje czystą logiką (walidacja `zod`, `isOfferEditable`, komunikaty), ale bez `Database`. `src/types.ts` zostaje miejscem DTO, bez `Database`.

### 4.2 Codec jako jedyne miejsce wiedzy o kształcie wiersza

Encja domenowa `Offer` (`src/types.ts:46-57`) się nie zmienia. Wiedza o jej postaci w Postgresie (lista kolumn, snake_case, `numeric` jako liczba, walidacja słowników) skupia się w jednym obiekcie w adapterze:

```ts
// src/lib/adapters/supabase/codecs.ts  (pseudokod)
type OfferRow = Pick<Tables<"offers">, "id" | "city" | ... | "created_at">;

export const OfferCodec = {
  columns: "id, city, property_type, transaction, price, area_m2, rooms, description, status, created_at",
  fromRow(row: OfferRow): Offer,              // dawne toOffer (services/offers.ts:107), z tym samym rzutem przy dryfie słownika
  toWrite(input: OfferInput): OfferWriteRow,  // dawne D3: property_type, area_m2 …
} as const;

export const OfferListCodec = { columns: "id, city, property_type, transaction, price, status, created_at", fromRow(...): OfferListItem };
export const AgentProfileCodec = { columns: "...", fromRow(...): AgentProfile, toWrite(p: AgentProfileInput) };
export const InvitationCodec  = { agentListColumns: "id, status, created_at, offers(id, city, property_type, transaction, price)", fromAgentListRow(...): AgentInvitationItem };
export const ProfileCodec     = { columns: "id, role, created_at", fromRow(row): Profile };  // jedno miejsce rzutu string → Role
export const ACTIVE_INVITATION_STATUSES = ["pending", "accepted"] as const;      // D4 w jednym miejscu
```

`columns` i `fromRow` leżą obok siebie, więc zmiana kolumny to jedna edycja, a TypeScript (przez generyk `select<columns>`) pilnuje zgodności.

### 4.3 Wąski port (domena)

Port opisuje operacje domenowe, nie tabele. Bez `select`, `eq`, nazw kolumn i typów biblioteki.

```ts
// src/lib/ports/result.ts
export type DataFailure = { kind: "unavailable" | "unknown" | "contract"; cause: DataError };
export type Result<T> = { ok: true; value: T } | { ok: false; failure: DataFailure };
export class DataError extends Error {           // znormalizowany błąd biblioteki, bez treści osobowych
  constructor(readonly source: "db" | "auth" | "rpc", readonly code: string | null, readonly status: number | null, message: string);
}

// src/lib/ports/data-access.ts
export interface SessionUser { id: string; email: string }          // zastępuje User z supabase-js w App.Locals

export interface SessionPort {
  currentUser(): Promise<Result<SessionUser | null>>;               // "unavailable" = awaria Auth (dzisiejsze isAuthOutage)
  signIn(email: string, password: string): Promise<AuthOutcome>;
  signUp(email: string, password: string, role: Role, redirectTo: string): Promise<AuthOutcome & { needsConfirmation?: boolean }>;
  exchangeCode(code: string): Promise<Result<void>>;
  signOut(scope: "global" | "local"): Promise<Result<void>>;
}
type AuthOutcome = { ok: true } | { ok: false; code: AuthErrorCode; failure: DataFailure };

export interface ProfilesPort {
  current(userId: string): Promise<Result<Profile | null>>;          // middleware + wszystkie sprawdzenia roli
  agentProfile(userId: string): Promise<Result<AgentProfile | null>>;
  saveAgentProfile(userId: string, p: AgentProfileInput): Promise<Result<"saved" | "not_visible">>;
}

export interface OffersPort {
  listMine(limit: number): Promise<Result<OfferListItem[]>>;
  byId(id: string): Promise<Result<Offer | null>>;                   // null = brak albo ukryta przez RLS
  create(input: OfferInput): Promise<Result<{ id: string }>>;
  update(id: string, input: OfferInput): Promise<Result<"updated" | "unchanged">>; // "unchanged" = 0 wierszy
  remove(id: string): Promise<Result<"deleted" | "unchanged">>;
  ranking(offerId: string): Promise<Result<RankedAgent[]>>;
}

export interface InvitationsPort {
  listForAgent(limit: number): Promise<Result<AgentInvitationItem[]>>;
  activeFor(offerId: string): Promise<Result<ActiveInvitation | null>>;
  latestRejection(offerId: string): Promise<Result<string | null>>;
  invite(offerId: string, agentId: string): Promise<Result<InviteResult>>;
  respond(offerId: string, response: InvitationResponse): Promise<Result<RespondResult>>;
}

export interface AccountPort { deleteOwn(): Promise<Result<DeleteAccountResult>> }

export interface DataAccess {
  session: SessionPort; profiles: ProfilesPort; offers: OffersPort;
  invitations: InvitationsPort; account: AccountPort;
  responseHeaders(): Record<string, string>;                         // nagłówki, które adapter każe dopisać do odpowiedzi
}
```

Typy wyników RPC (`InviteResult`, `RespondResult`, `DeleteAccountResult`) już są domenowe (`src/lib/services/account.ts:4-10` i analogiczne w `invitations.ts`) — zostają w serwisach; adapter tylko zawęża `string` z RPC (`src/db/database.types.ts:180`, :196 — `Returns: string`) do tej unii, a wartość spoza listy zwraca jako `failure.kind = "contract"`.

### 4.4 Adapter i cykl życia per żądanie (RLS)

RLS potrzebuje JWT użytkownika przy każdym zapytaniu, a `@supabase/ssr` wymaga nowego klienta na każde żądanie („A new server client must be created for each request”, `node_modules/@supabase/ssr/dist/main/types.d.ts:35`). Dlatego:

```ts
// src/lib/adapters/supabase/index.ts  (pseudokod)
export function createDataAccess(headers: Headers, cookies: AstroCookies): DataAccess | null {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null; // dzisiejsze supabase.ts:7-9
  const pending: Record<string, string> = {};
  const db = createServerClient<Database>(SUPABASE_URL, SUPABASE_KEY, {
    cookies: {
      getAll: () => parseCookieHeader(headers.get("Cookie") ?? ""),
      setAll: (toSet, cacheHeaders) => {
        toSet.forEach((c) => cookies.set(c.name, c.value, c.options));
        Object.assign(pending, cacheHeaders);
      },
    },
  });
  return {
    session: supabaseSession(db),
    profiles: supabaseProfiles(db),
    offers: supabaseOffers(db),
    invitations: supabaseInvitations(db),
    account: supabaseAccount(db),
    responseHeaders: () => ({ ...pending }),
  };
}
```

- **Jedno miejsce tworzenia:** `src/middleware.ts` woła `createDataAccess(context.request.headers, context.cookies)` raz i zapisuje do `context.locals.data` (nowe pole `App.Locals.data: DataAccess | null`). Strony i endpointy czytają `Astro.locals.data` / `context.locals.data`; nie ma singletonu modułowego, więc JWT jednego użytkownika nie trafi do żądania drugiego.
- **Kolejność:** middleware najpierw woła `session.currentUser()` (jak dziś `middleware.ts:16`), zgodnie z `types.d.ts:111` („Call `getClaims()` (or `getSession()`/`getUser()`) early … before any response is generated”), żeby odświeżenie tokenu zdążyło zapisać cookie.
- **Nagłówki cache:** po `await next()` middleware dopisuje `data.responseHeaders()` do odpowiedzi. Middleware nie wie, co to za nagłówki — wie to tylko adapter.
- **Endpointy `/api/*`** nie są bramkowane (`CLAUDE.md`), ale middleware i tak działa dla każdej ścieżki (`middleware.ts:8` przed `isGated` :29), więc `locals.data` jest dostępne także tam.

### 4.5 Reguła roli jako serwis na porcie (koniec D1)

```ts
// src/lib/services/access.ts  (pseudokod; czysty, testowalny jednostkowo z fałszywym portem)
export async function requireRole(
  data: DataAccess | null,
  user: SessionUser | null,
  role: Role,
): Promise<{ ok: true } | { ok: false; reason: "unavailable" | "signin" | "forbidden"; failure?: DataFailure }>;
```

## Krok 5. Dowód izolacji i before/after

### 5.1 Co dotyka wymiana biblioteki po refaktorze

| Zmiana                                                                                                                   | Dziś (pliki)                                                                | Po refaktorze                                                                           |
| ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| major `@supabase/ssr` (np. sygnatura `setAll`)                                                                           | `src/lib/supabase.ts` + ryzyko w 18 konsumentach                            | `adapters/supabase/client.ts`                                                           |
| `getUser()` → `getClaims()`                                                                                              | `src/middleware.ts:16`                                                      | `adapters/supabase/session.ts`                                                          |
| zmiana nazwy kolumny `offers.area_m2`                                                                                    | 3 selecty (D2) + 2 zapisy (D3) + `OfferRow` w serwisie                      | `OfferCodec`                                                                            |
| nowy kod błędu Auth                                                                                                      | `services/auth-errors.ts:34`                                                | `adapters/supabase/errors.ts`                                                           |
| zamiana PostgREST na inny dostęp (np. bezpośredni Postgres przez Hyperdrive — dziś nieprzydatne, `infrastructure.md:60`) | 18 plików wejścia + 3 serwisy + `types.ts` + `env.d.ts` + `report-error.ts` | nowy katalog `src/lib/adapters/<nazwa>/` implementujący te same porty; reszta bez zmian |

Strony i komponenty dostają gotowe obiekty domenowe (`Offer`, `OfferListItem`, `RankedAgent`, `AgentInvitationItem`, `SessionUser`), nigdy wiersz ani `User`.

### 5.2 Before / after

**D1 — rola (7 endpointów)**

```ts
// before: src/pages/api/owner/offers.ts:9-33 (i 6 kopii)
const supabase = createClient(context.request.headers, context.cookies);
if (!supabase) {
  reportError(...config);
  return fail("unavailable");
}
const { user } = context.locals;
if (!user) return context.redirect("/auth/signin");
const { data: profile, error: roleError } = await supabase
  .from("profiles")
  .select("role")
  .eq("id", user.id)
  .maybeSingle();
if (roleError) {
  reportError(...role);
  return fail("unavailable");
}
if (profile?.role !== "owner") return new Response("Forbidden", { status: 403 });

// after
const { data, user } = context.locals;
const access = await requireRole(data, user, "owner");
if (!access.ok) return accessDenied(access, context, "owner.offers.create", fail); // 1 helper: signin / 403 / unavailable + reportError
```

**D2 — odczyt oferty (3 strony)**

```ts
// before: src/pages/owner/offers/[id].astro:41-52 (i edit.astro:33-43, agent/offers/[id].astro:29-40)
const { data, error } = await supabase.from("offers")
  .select("id, city, property_type, transaction, price, area_m2, rooms, description, status, created_at")
  .eq("id", offerId).maybeSingle();
if (error) {...} else if (data) { offer = toOffer(data); }

// after
const res = await Astro.locals.data!.offers.byId(offerId);
if (!res.ok) { reportError("error", "owner.offer.read", res.failure.cause, Astro, { offerId }); state = "error"; }
else if (res.value) { offer = res.value; state = "found"; }
```

**D3 — zapis oferty (2 endpointy)**

```ts
// before: src/pages/api/owner/offers.ts:48-60
await supabase
  .from("offers")
  .insert({ city, property_type: propertyType, transaction, price, area_m2: areaM2, rooms, description })
  .select("id")
  .single();
// after
await data.offers.create(parsed.data); // OfferCodec.toWrite w adapterze
```

**L3 — `locals.user`**

```ts
// before: src/env.d.ts:3            user: import("@supabase/supabase-js").User | null;
//         src/layouts/AppLayout.astro:22   const email = user.email ?? "";
// after:  src/env.d.ts               user: import("@/lib/ports/data-access").SessionUser | null; data: DataAccess | null;
//         AppLayout                  const { email } = user;      // adapter gwarantuje string
```

**L3 — klasyfikacja błędów**

```ts
// before: src/lib/report-error.ts:3,40,60 — isAuthError / PostgrestError z biblioteki
// after:  adapter zamienia każdy błąd biblioteki na DataError (source, code, status, krótki message) w errors.ts;
//         report-error.ts rozpoznaje DataError strukturalnie; isAuthOutage(e) → failure.kind === "unavailable" z SessionPort.
```

### 5.3 Otwarte pytania z kontraktu biblioteki — rozstrzygnięcia

| #   | Pytanie                                        | Źródło (node_modules)                                                                                                                                        | Decyzja                                                                                                                                                                                  | Gdzie zakodować                                            |
| --- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Q1  | Co zwraca odczyt po id, gdy RLS ukrywa wiersz? | `@supabase/postgrest-js/dist/index.d.mts:1492-1493` — `maybeSingle`: „zero or one row … otherwise this returns an error”; 0 wierszy → `data: null` bez błędu | `byId` → `Result<Offer \| null>`; `null` znaczy „brak albo cudza” (bez rozróżnienia — tak chce PRD, 404 w obu przypadkach)                                                               | `adapters/supabase/offers.ts`                              |
| Q2  | Update/delete zablokowany przez RLS            | brak błędu, 0 zwróconych wierszy (komentarz `src/pages/api/owner/offers/update.ts:57-58`)                                                                    | port zwraca `"unchanged"`; endpoint sam robi drugie `byId`, żeby odróżnić 404 od `edit_locked` (decyzja domenowa zostaje w wejściu)                                                      | `adapters/supabase/offers.ts` (`.select("id")` + `length`) |
| Q3  | Nagłówki cache przy odświeżeniu sesji          | `@supabase/ssr/dist/main/types.d.ts:23-58`, :119-121                                                                                                         | adapter zbiera drugi argument `setAll`, middleware dopisuje do odpowiedzi (`responseHeaders()`) — dziś ignorowane w `src/lib/supabase.ts:15`                                             | `adapters/supabase/client.ts` + 1 linia w middleware       |
| Q4  | `getUser()` czy `getClaims()`?                 | `@supabase/auth-js/dist/module/GoTrueClient.d.ts:1408-1413` (getSession niezaufany; zalecane `getClaims()` lub `getUser()`), :1591 `getUser(jwt?)`           | zostaje `getUser()` (weryfikacja na serwerze Auth, wykrywa usunięte konta); przejście na `getClaims()` to zmiana jednego pliku po decyzji o koszcie round-tripu (`infrastructure.md:60`) | `adapters/supabase/session.ts`                             |
| Q5  | Kody błędów Auth                               | `@supabase/auth-js/dist/module/lib/error-codes.d.ts:6` (`ErrorCode`)                                                                                         | mapowanie `ErrorCode` → `AuthErrorCode` w adapterze; serwis zna tylko domenowy zamknięty zbiór                                                                                           | `adapters/supabase/errors.ts`                              |
| Q6  | Wynik RPC typowany jako `string`               | `src/db/database.types.ts:180`, :196                                                                                                                         | adapter zawęża do unii domenowej; nieznana wartość → `failure.kind = "contract"` (dzisiejsze `error ?? data` w `api/owner/invitations.ts:53-54`)                                         | `adapters/supabase/{invitations,account}.ts`               |

## Krok 6. Weryfikacja i plan

### 6.1 Kryterium sukcesu

```bash
rg -l '@supabase/|@/db/database.types|db/database.types' src
# oczekiwane wyłącznie: src/lib/adapters/supabase/** (oraz sam src/db/database.types.ts nie importuje niczego)
rg -n '\.from\("|\.rpc\("|\.auth\.' src --glob '!src/lib/adapters/**'
# oczekiwane: 0 trafień
```

Testy `tests/integration/helpers.ts`, `tests/e2e/helpers.ts` zostają przy `supabase-js` (zakładają konta, sprawdzają RLS — to testy adaptera i bazy, nie domeny). `tests/unit/report-error.test.ts` przestaje importować bibliotekę; przypadki klasyfikacji błędów Supabase przechodzą do nowego `tests/unit/supabase-errors.test.ts`. Reguła ESLint `no-restricted-imports` dla `@supabase/*` i `@/db/database.types` poza `src/lib/adapters/supabase/**` zamienia kryterium w bramkę lint.

### 6.2 Pliki, które dziś znają zależność, a po refaktorze nie

- **Klient Supabase (L1):** `src/middleware.ts` (zna już tylko `createDataAccess` — import z adaptera, jedyny punkt składania), `src/pages/api/auth/{signin,signup,signout}.ts`, `src/pages/auth/callback.ts`, `src/pages/api/account/delete.ts`, `src/pages/api/agent/{profile,invitations}.ts`, `src/pages/api/owner/{offers,invitations}.ts`, `src/pages/api/owner/offers/{update,delete}.ts`, `src/pages/owner/index.astro`, `src/pages/owner/offers/[id].astro`, `src/pages/owner/offers/[id]/edit.astro`, `src/pages/agent/index.astro`, `src/pages/agent/offers/[id].astro`, `src/pages/agent/profile.astro` — 17 plików bez wiedzy o SDK i schemacie, 1 (middleware) z jednym importem fabryki.
- **`Database` (L2):** `src/types.ts`, `src/lib/services/offers.ts`, `src/lib/services/invitations.ts`, `src/lib/services/agent-profile.ts`.
- **`supabase-js` (L3):** `src/env.d.ts`, `src/lib/report-error.ts`, `tests/unit/report-error.test.ts`; pośrednio `src/layouts/AppLayout.astro`, `src/pages/{owner,agent}/account.astro`, `src/pages/agent/index.astro`, `src/pages/index.astro` (dostają `SessionUser`).
- **Kody Auth (L4):** `src/lib/services/auth-errors.ts`.
- `src/lib/supabase.ts` — usunięty (przeniesiony do `src/lib/adapters/supabase/client.ts`).

Poza zakresem (świadomie): `astro:*` (framework hosta), `lucide-react` (jedna warstwa UI).

### 6.3 Fazy (jedna faza = jeden commit, Conventional Commits)

Bramki po każdej fazie: `npm run lint`, `npx astro check`, `npm run test:unit`, `npm run test:integration`, `npm run smoke`, `npm run test:e2e` (lokalny Supabase uruchomiony). Brak migracji SQL, więc bez `db push` i `db:types`.

| Faza | Commit                                                                              | Zakres                                                                                                                                                                                                              | Ryzyko / dodatkowa weryfikacja                                                                                                  |
| ---- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 1    | `refactor(data): add data-access ports and per-request Supabase adapter`            | `src/lib/ports/*`, `src/lib/adapters/supabase/{client,index}.ts` (przeniesienie `supabase.ts`, zbieranie nagłówków cache), `locals.data` w middleware + `env.d.ts`; stary `createClient` re-eksportowany tymczasowo | `curl -I` po logowaniu: odpowiedź z `Set-Cookie` ma `Cache-Control: private, no-cache, no-store…`                               |
| 2    | `refactor(data): normalize Supabase errors at the adapter boundary`                 | `adapters/supabase/errors.ts` (`DataError`, mapowanie Auth z `auth-errors.ts:33-44`), `report-error.ts` bez importu biblioteki, przeniesienie testów                                                                | `test:unit` pokrywa te same przypadki co dziś                                                                                   |
| 3    | `refactor(auth): route sign-in, sign-up, sign-out and callback through SessionPort` | `session.ts`, `SessionUser` w `Locals`, 4 pliki auth, `signOut` w `account/delete.ts` i middleware                                                                                                                  | smoke (to jest dokładnie test auth)                                                                                             |
| 4    | `refactor(access): single requireRole service over ProfilesPort`                    | `profiles.ts` + `ProfileCodec`, `services/access.ts`, 7 endpointów, middleware                                                                                                                                      | `test:integration` (`isolation.test.ts`) + test jednostkowy `requireRole` na fałszywym porcie                                   |
| 5    | `refactor(offers): OffersPort with OfferCodec`                                      | `offers.ts`, `OfferCodec`/`OfferListCodec`, strony ofert właściciela i agenta, endpointy create/update/delete, `ranking()`                                                                                          | e2e critical path; `ranking.test.ts`                                                                                            |
| 6    | `refactor(invitations): InvitationsPort, agent profile and account deletion`        | `invitations.ts`, `account.ts`, `AgentProfileCodec`, `InvitationCodec`, `ACTIVE_INVITATION_STATUSES`, pozostałe strony/endpointy                                                                                    | e2e zaproszenie → odpowiedź                                                                                                     |
| 7    | `refactor(data): drop Database types from services and lock the boundary`           | mapery `to*` przeniesione do codeców, `src/types.ts` bez `Database` (`Profile` zdefiniowany wprost), usunięcie tymczasowego re-eksportu, ESLint `no-restricted-imports`, `CLAUDE.md` „Auth flow” zaktualizowany     | kryterium 6.1 = 0 trafień poza adapterem; celowy break-check: import `@supabase/supabase-js` w wyspie → `npm run lint` czerwony |

## Podsumowanie

Najgorszy przeciek w helloDOM to klient Supabase używany wprost w warstwie wejścia: 18 plików (middleware, 9 endpointów API, 7 stron, callback) wykonuje 26 zapytań/RPC i 8 wywołań `auth`, podczas gdy `CLAUDE.md` deklaruje logikę biznesową w `src/lib/services/`, a serwisy dostają tylko gotowe wiersze. Dokumenty nie obiecują wymienialności Supabase, więc koszt przecieku to nie migracja, tylko rozproszenie: sprawdzenie roli jest skopiowane w 7 endpointach, lista kolumn oferty w 3 stronach, a mapowanie zapisu oferty w 2 endpointach. Odnogi tego samego przecieku to wygenerowane typy `Database` w `src/types.ts` i trzech serwisach, `User` z `supabase-js` w `App.Locals` oraz kody Supabase Auth w `services/auth-errors.ts`. SDK nie trafia dziś do bundla klienta (`dist/client` bez trafień), ale chroni to tylko konwencja, a fabryka ignoruje nagłówki `Cache-Control`, które `@supabase/ssr` każe ustawiać przy odświeżaniu sesji. Projekt ACL to wąskie porty domenowe (`SessionPort`, `ProfilesPort`, `OffersPort`, `InvitationsPort`, `AccountPort`) oraz jeden adapter `src/lib/adapters/supabase/`, którego codeki są jedynym miejscem wiedzy o kolumnach i snake_case. Adapter powstaje raz na żądanie w middleware (`locals.data`), żeby każde zapytanie niosło JWT użytkownika dla RLS. Plan ma 7 faz po jednym commicie z pełnym zestawem bramek. Kończy się regułą ESLint, po której `rg '@supabase/|database.types' src` zwraca tylko pliki adaptera.
