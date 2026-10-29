---
title: "Cykl oferty z zaproszeniami — niezmiennik i agregat-strażnik (plan refaktoru)"
created: 2026-10-29
type: refactor-plan
---

# Cykl oferty z zaproszeniami — niezmiennik i agregat-strażnik

Plan refaktoru, nie implementacja. Ten dokument nie zmienia kodu produkcyjnego. Wszystkie odwołania `plik:linia` sprawdzono w kodzie na branchu `docs/architect-m4` (HEAD `c257f0c`).

Wejście: `context/domain/domain-distillation.md` (kandydat „Oferta z zaproszeniami”, R-01…R-06, ranking #3), `context/domain/glossary.md`, `context/domain/evidence/3-code-rules.md`, `context/foundation/prd.md`, `context/foundation/tech-stack.md`, `README.md`.

## Krok 0 — Kontekst

**Produkt.** Właściciel zapisuje ofertę. System liczy każdemu agentowi wynik 0–100 i pokazuje top 3. Właściciel zaprasza jednego agenta, a ten przyjmuje albo odrzuca zaproszenie (`context/foundation/prd.md:36`).

**Kryteria sukcesu i guardrails dotyczące cyklu oferty:**

- „Zaproszony agent przyjmuje zaproszenie, a oferta przechodzi w status „w obsłudze”” (`prd.md:40`, Primary).
- „Oferta ma najwyżej jednego przyjętego agenta” (`prd.md:48`, Guardrail).
- Wymagania funkcjonalne: FR-005 (`prd.md:77`), FR-009 (`:93`), FR-011 (`:97`) i FR-012 (`:69`).

**Stack:** Astro 7 SSR + React 19 na Cloudflare Workers oraz Supabase (Postgres + Auth); `README.md`, `tech-stack.md`. Aplikacja łączy się z bazą przez `@supabase/ssr`, czyli PostgREST po HTTP. Nie ma bezpośredniego połączenia `pg` ani transakcji obejmującej kilka wywołań.

**Warstwy, w których żyje logika biznesowa:**

| warstwa | co tam jest | przykład |
| --- | --- | --- |
| persystencja / domena (Postgres) | checki, indeks częściowy, RLS, granty kolumn, 3 funkcje RPC (`rank_agents_for_offer`, `invite_agent`, `respond_to_invitation`) i trigger | `supabase/migrations/20261028180000_create_invitations.sql:67-110` |
| serwis (TS) | parsowanie formularzy, lista kodów wyniku RPC, komunikaty, lustro reguły edycji | `src/lib/services/invitations.ts:26`, `src/lib/services/offers.ts:233-236` |
| API (Astro endpoints) | sesja, rola, parse, wywołanie RPC, mapowanie kodu na redirect | `src/pages/api/owner/invitations.ts:51-67` |
| UI (strony `.astro`) | które akcje pokazać w danym statusie; własne zapytania o „aktywne zaproszenie” | `src/pages/owner/offers/[id].astro:60`, `:100` |

Logika biznesowa żyje więc głównie w Postgresie. TS jest cienki, ale powtarza fragmenty reguł.

## Krok 1 — Niezmienniki biznesowe

| id | niezmiennik (musi być zawsze prawdziwy) | źródło w dokumentach | źródło w kodzie |
| --- | --- | --- | --- |
| N-1 | Oferta ma najwyżej jedno **aktywne** zaproszenie (`pending` albo `accepted`), a więc najwyżej jednego przyjętego agenta. | `prd.md:48`; `:93` („jednego agenta”) | `20261028180000_create_invitations.sql:21-24` |
| N-2 | **Status oferty wynika z jej aktywnego zaproszenia:** `seeking_agent` (i `draft`) ⇔ brak aktywnego; `invited` ⇔ aktywne `pending`; `in_progress` ⇔ aktywne `accepted`. | `prd.md:36`, `:40`, `:97` („po odrzuceniu oferta wraca do „szuka agenta””), `:69` (FR-012) | pilnowany przez 3 osobnych pisarzy: `20261028180000_create_invitations.sql:100-106`, `20261028200000_invitation_response.sql:110-118`, `20261028220000_account_deletion.sql:11-34` |
| N-3 | Zaprosić można tylko w stanie „szuka agenta” i tylko agenta z **aktualnego** top 3. | `prd.md:93` | `20261028180000_create_invitations.sql:87-97` |
| N-4 | Odpowiedź agenta jest jednorazowa: dotyczy tylko zaproszenia `pending` i ustawia `responded_at`. | `context/archive/2026-10-28-invitation-response/plan-brief.md:45` (R-05) | `20261028200000_invitation_response.sql:9-11`, `:106-108` |
| N-5 | Agent, który odrzucił zaproszenie, nie wraca do rankingu tej oferty. | `prd.md:97`, `:112` | `20261028200000_invitation_response.sql:46-49`; `unique (offer_id, agent_id)` `20261028180000_create_invitations.sql:18` |
| N-6 | Właściciel edytuje ofertę tylko w stanie „szkic” albo „szuka agenta”. | `prd.md:77` | `20261029100000_owner_offer_management.sql:18-22`; lustro `src/lib/services/offers.ts:233-236` |
| N-7 | Wynik liczy jedna formuła. Do top 3 trafiają tylko wyniki > 0, a remisy rozstrzyga ustalony porządek. | `prd.md:108-112` | `20261028200000_invitation_response.sql:32-53` |
| N-8 | Właściciel widzi tylko swoje oferty. Agent widzi ofertę tylko z aktywnym zaproszeniem. | `prd.md:46-47` | `20261028140000_create_offers.sql:47-50`; `20261028180000_create_invitations.sql:47-57` |
| N-9 | Status oferty zmieniają tylko RPC zaproszeń, nie właściciel. | decyzja: `20261029100000_owner_offer_management.sql:3-5` | grant kolumn bez `status`: `20261028140000_create_offers.sql:43-44`, `20261029100000_owner_offer_management.sql:14-15` |

## Krok 2 — Klasyfikacja i wybór

Skala: rdzeniowość 1–3 (3 = bez niej produkt traci sens), rozsmarowanie = liczba miejsc i warstw, egzekwowanie = **enforced** (strażnik deklaratywny albo jedyna ścieżka zapisu), **konwencja** (prawdziwe tylko dlatego, że każdy pisarz pamięta), **naruszalny** (istnieje legalna ścieżka, która łamie regułę bez błędu).

| id | rdzeniowy | rozsmarowanie | egzekwowanie | uwagi |
| --- | --- | --- | --- | --- |
| N-1 | 3 (guardrail) | 1 indeks + 2 RPC (blokada) | enforced | indeks częściowy łapie także zapisy `service_role` |
| **N-2** | **3 (kryterium sukcesu Primary + FR-011 + FR-012)** | **3 migracje, 3 pisarzy, 1 naprawa jednorazowa, 2 strony z własną definicją „aktywnego”** | **konwencja, naruszalny** | brak checku; trigger tylko na `DELETE`; historycznie naruszony (naprawa w `account_deletion.sql:36-45`) |
| N-3 | 3 | 1 RPC + strona | enforced | ranking dla ofert spoza `seeking_agent` chroni tylko strona (`[id].astro:60`), ale zapis i tak blokuje RPC |
| N-4 | 2 | 1 RPC + check | enforced | — |
| N-5 | 2 | 1 funkcja + unique | enforced | — |
| N-6 | 2 | RLS + lustro TS + 2 strony | enforced (RLS); lustro bez testu parzystości | duplikat, ale UI nie jest jedynym strażnikiem |
| N-7 | 3 | 1 funkcja | enforced | jedno źródło formuły |
| N-8 | 3 | RLS | enforced | (D-05 `owner_id` to osobny temat) |
| N-9 | 2 | granty + komentarz | enforced dla `authenticated`; trigger to wyjątek | wyjątek jest częścią problemu N-2 |

**Wybór #1: N-2, czyli status oferty zgodny z jej jedynym aktywnym zaproszeniem**, razem z N-1, które jest jego warunkiem wstępnym. Ta para jest „niezmiennikiem cyklu oferty”.

Uzasadnienie:

1. **Rdzeń.** To dosłownie kryterium sukcesu Primary (`prd.md:40`) i guardrail (`prd.md:48`). Status oferty steruje każdą decyzją UI i każdą regułą dostępu: N-3, N-6 i widocznością N-8 (`20261028180000_create_invitations.sql:55`).
2. **Najsłabiej egzekwowany spośród rdzeniowych.** Wszystkie inne reguły Core mają strażnika deklaratywnego albo jedną ścieżkę zapisu. N-2 nie ma żadnego. Status oferty i status zaproszenia to dwie zdenormalizowane kopie jednego faktu. Zgodność między nimi trzyma się tylko dlatego, że trzech pisarzy w trzech migracjach pamięta, żeby zmienić obie strony.
3. **Naruszalny i już raz naruszony.** Trigger reaguje tylko na `after delete` (`20261028220000_account_deletion.sql:31-34`). `UPDATE invitations.status` albo `UPDATE offers.status` wykonane jako `service_role` lub z panelu Supabase rozjeżdża stan bez błędu. Jednorazowa naprawa osieroconych ofert (`:36-45`) pokazuje, że do rozjazdu już doszło.
4. **Uczciwie:** dla roli `authenticated` reguła dziś się trzyma. Każda ścieżka aplikacji przechodzi przez RPC z blokadą wiersza, więc to nie jest pożar. Słabość leży w braku jednego strażnika i w tym, że błędy naruszenia są połykane (Krok 3). Bez refaktoru każdy przyszły pisarz statusu, np. wyjście z „w obsłudze” (Q-03 / D-07 w destylacji), musiałby ręcznie powtórzyć synchronizację.

## Krok 3 — Diagnoza N-2 (+N-1)

### Gdzie dziś żyje reguła

| # | warstwa | miejsce | co robi |
| --- | --- | --- | --- |
| 1 | DB: schemat | `20261028140000_create_offers.sql:18`, `:33` | domyślny status `seeking_agent` i dozwolony zbiór statusów oferty; nie wiąże statusu z zaproszeniami |
| 2 | DB: schemat | `20261028180000_create_invitations.sql:15-17` | status zaproszenia i jego zbiór |
| 3 | DB: indeks | `20261028180000_create_invitations.sql:23-24` | N-1: jedno aktywne zaproszenie na ofertę (pierwsza z 4 literalnych definicji „aktywnego”) |
| 4 | DB: RLS | `20261028180000_create_invitations.sql:47-57` (`:55`) | widoczność oferty dla agenta, druga definicja „aktywnego” |
| 5 | DB: RPC `invite_agent` | `20261028180000_create_invitations.sql:77-81`, `:87-89`, `:99-106` | blokada oferty, precondition `seeking_agent`, insert `pending` + `offers.status = 'invited'` |
| 6 | DB: RPC `respond_to_invitation` | `20261028200000_invitation_response.sql:87-90`, `:96-100`, `:106-118` | blokada oferty i zaproszenia, precondition `pending` ∧ `invited`, dwie pary aktualizacji |
| 7 | DB: trigger | `20261028220000_account_deletion.sql:11-26`, `:31-34` | po `DELETE` aktywnego zaproszenia oferta wraca do `seeking_agent`; trzecia definicja „aktywnego” (`:18`); zmienia status poza RPC wbrew `owner_offer_management.sql:3-5` |
| 8 | DB: naprawa | `20261028220000_account_deletion.sql:39-45` | jednorazowa naprawa ofert bez aktywnego zaproszenia, czwarta definicja (`:44`) |
| 9 | DB: RLS edycji | `20261029100000_owner_offer_management.sql:18-22` | N-6 wyprowadzone ze statusu, czyli zależne od N-2 |
| 10 | TS: typy | `src/types.ts:14-22` | ręcznie synchronizowane listy statusów |
| 11 | TS: serwis | `src/lib/services/invitations.ts:26`, `:79` | ręcznie synchronizowane kody wyniku RPC |
| 12 | TS: serwis | `src/lib/services/offers.ts:233-236` | `isOfferEditable` — lustro RLS #9 |
| 13 | API | `src/pages/api/owner/invitations.ts:51-67`; `src/pages/api/agent/invitations.ts:52-76` | mapowanie kodów na redirect |
| 14 | API | `src/pages/api/owner/offers/update.ts:81-96` | „0 wierszy + oferta istnieje” interpretowane jako `edit_locked` |
| 15 | UI | `src/pages/owner/offers/[id].astro:60`, `:192-207` | ranking i zaproszenie tylko dla `seeking_agent`, w innym statusie karta statusu |
| 16 | UI | `src/pages/owner/offers/[id].astro:94-106` (`:100`) | osobne zapytanie o aktywne zaproszenie; literalne `["pending","accepted"]` |
| 17 | UI | `src/pages/agent/offers/[id].astro:46-63` (`:53`, `:58`) | to samo po stronie agenta; przyciski odpowiedzi tylko dla `pending` (`:115`) |
| 18 | UI | `src/pages/owner/offers/[id]/edit.astro:57-60`; `src/pages/owner/offers/[id].astro:172` | gate edycji przez `isOfferEditable` |
| 19 | UI | `src/components/owner/DeleteOffer.tsx:15-20` | teksty per status (tylko prezentacja) |

### Luki

- **Brak strażnika deklaratywnego dla N-2.** Żaden check, constraint ani trigger nie porównuje `offers.status` z aktywnym zaproszeniem. Prawdziwość reguły zależy od trzech pisarzy (#5, #6, #7).
- **Trigger obejmuje tylko `DELETE`** (`account_deletion.sql:32`). Nie ma ścieżki dla `UPDATE invitations.status` ani `UPDATE offers.status` poza RPC. `service_role` ma `grant all` na obu tabelach (`create_offers.sql:45`, `create_invitations.sql:33`). Panel Supabase i przyszły kod administracyjny mogą więc złamać N-2 bez błędu.
- **Wyjątek od zasady „status tylko przez RPC”.** Trigger #7 to czwarty pisarz statusu, poza RPC. Zasada z `owner_offer_management.sql:3-5` jest więc tylko deklaracją.
- **Połykanie naruszeń jako błędów użytkownika:**
  - `respond_to_invitation` zwraca `already_responded`, gdy zaproszenie jest `pending`, a oferta nie jest `invited` (`invitation_response.sql:106-107`). To jest wykrycie naruszenia N-2, a endpoint pokazuje je jako zwykły komunikat „Na to zaproszenie już odpowiedziano” (`src/pages/api/agent/invitations.ts:69-71`), bez `reportError`.
  - `invite_agent` zamienia `unique_violation` na `offer_locked` (`create_invitations.sql:102-103`). Jeśli oferta jest `seeking_agent`, a ma aktywne zaproszenie (naruszenie N-2), właściciel widzi „Do tej oferty wysłano już zaproszenie” (`invitations.ts:48`), a endpoint nie loguje błędu (`src/pages/api/owner/invitations.ts:64-66`).
  - Strona właściciela: oferta `invited`/`in_progress` bez aktywnego zaproszenia daje `invitedAt = null` bez żadnego sygnału (`[id].astro:94-106`, `maybeSingle` zwraca `null` bez `error`). Karta statusu jest pokazana bez daty.
- **Niespójne kody.** `offer_locked` łączy dwie przyczyny: status ≠ `seeking_agent` (`create_invitations.sql:87-88`) i istniejące aktywne zaproszenie (`:102-103`). `already_responded` łączy „zaproszenie nie `pending`” z „oferta nie `invited`”.
- **UI jako jedyny strażnik (odczyt, nie zapis).** `rank_agents_for_offer` zwraca ranking także dla ofert `invited`/`in_progress`. Ogranicza go tylko strona (`[id].astro:59-60`). Nie łamie to N-2, bo `invite_agent` sprawdza status (`:87`), ale reguła „ranking ma sens tylko w `seeking_agent`” nie ma strażnika w domenie.
- **Pomniejsze.** `respond_to_invitation` blokuje `for update` wiersz oferty po samym `id`, przed sprawdzeniem, czy wołający ma zaproszenie (`invitation_response.sql:87-90`). Bez wycieku danych, ale dowolny agent może na chwilę zablokować cudzą ofertę.
- **Cztery literalne definicje „aktywnego zaproszenia”** w SQL (`create_invitations.sql:24`, `:55`; `account_deletion.sql:18`, `:44`) i dwie w TS (`owner/offers/[id].astro:100`, `agent/offers/[id].astro:53`). Kryterium „done when” z destylacji (ranking #3) nie jest dziś spełnione.

## Krok 4 — Projekt agregatu-strażnika

### Agregat

**`Oferta` (root `offers`) z encjami podrzędnymi `Zaproszenie` (`invitations`).** Granica agregatu to jedna oferta i wszystkie jej zaproszenia. Wszystkie zmiany `offers.status` i `invitations.status` przechodzą przez root. Ranking (N-7) jest polityką, z której agregat korzysta przy zapraszaniu, a nie częścią agregatu.

Niezmiennik agregatu (sprawdzany po każdej operacji i przy commicie):

```
active(o) = { i ∈ invitations(o) : i.status ∈ ACTIVE_INVITATION_STATUSES }   -- {pending, accepted}
|active(o)| ≤ 1                                                              -- N-1
o.status = expected_offer_status(active(o))                                  -- N-2
  gdzie expected_offer_status(∅)         ∈ {draft, seeking_agent}
        expected_offer_status({pending})  = invited
        expected_offer_status({accepted}) = in_progress
```

### Gdzie żyje agregat: Postgres czy TypeScript

| kryterium | A. agregat w TS + repozytorium | B. agregat w Postgresie, jeden moduł PL/pgSQL (**rekomendacja**) |
| --- | --- | --- |
| atomowość | Supabase JS (PostgREST) nie daje transakcji obejmującej kilka wywołań. Repozytorium musiałoby i tak zapisywać przez jedno RPC albo dostać bezpośrednie połączenie `pg` z Workera (Hyperdrive), czyli nową infrastrukturę. | Jedna transakcja na wywołanie RPC. Blokady `for update` już dziś szeregują współbieżne zaproszenia i odpowiedzi (`create_invitations.sql:65-66`, `invitation_response.sql:68-70`). |
| autoryzacja | RLS zostaje w bazie, a TS ładuje agregat jako użytkownik. Część reguł (top 3, profile agentów) wymaga `security definer`, więc i tak wraca do SQL. | `security definer` + `auth.uid()` w jednym miejscu, jak dziś. |
| ochrona przed zapisami spoza aplikacji (`service_role`, panel) | brak; TS chroni tylko ścieżki, które przez niego przechodzą | constraint trigger łapie każdy zapis |
| testowalność | vitest bez bazy (czyste funkcje), ale bez gwarancji współbieżności | testy SQL w `supabase/tests/*.sql` (CI: `.github/workflows/ci.yml:43-49`) + integracyjne vitest |
| koszt zmiany | przepisanie 3 RPC na TS + nowe połączenie + powielona logika | refaktor 3 migracji w jedną nową, endpointy prawie bez zmian |
| język wszechobecny w kodzie TS | mocny (klasy, metody) | słabszy; rekompensuje go cienka fasada TS z nazwanymi błędami |

**Rekomendacja: B.** Agregat zostaje w Postgresie jako jeden moduł: prywatny schemat `offer_lifecycle`, którego PostgREST nie wystawia. Moduł ma jedną funkcję przejścia i jeden strażnik przy commicie. Publiczne RPC stają się cienkimi wrapperami. W TS powstaje fasada `src/lib/domain/offer-lifecycle.ts`: nazwy operacji, nazwane błędy i read-only lustro macierzy uprawnień dla UI. Kompromis: logika domeny jest w SQL, który zespół (1 osoba + agent) czyta wolniej niż TS. Zyskujemy atomowość bez nowej infrastruktury i strażnika, którego nie obejdzie żaden pisarz. Decyzja należy do właściciela architektury (sekcja „Decyzje, które należą do mnie” w raporcie M4).

### Moduł agregatu (SQL, pseudokod)

```sql
create schema offer_lifecycle;                       -- nie w db.schemas PostgREST
revoke all on schema offer_lifecycle from public, anon, authenticated;

-- Jedna definicja „aktywnego”.
create function offer_lifecycle.active_invitation_statuses() returns text[]
  language sql immutable as $$ select array['pending','accepted'] $$;

create function offer_lifecycle.expected_offer_status(p_active_status text) returns text[]
  language sql immutable as $$
  select case p_active_status
    when 'pending'  then array['invited']
    when 'accepted' then array['in_progress']
    else array['draft','seeking_agent'] end $$;

-- Błędy domenowe: raise exception '<nazwa>' using errcode = 'P0001', detail = <json z kontekstem>.
--   offer_not_found, offer_not_seeking_agent, offer_has_active_invitation,
--   agent_not_in_top3, invitation_not_found, invitation_already_answered,
--   offer_state_inconsistent (naruszenie N-2 wykryte w trakcie operacji — błąd systemu, nie użytkownika)

-- Load: jedyna droga do agregatu — blokuje root, potem zaproszenia (stała kolejność = brak deadlocków).
create function offer_lifecycle.load(p_offer_id uuid) returns offer_lifecycle.offer_state as $$
  select o.id, o.owner_id, o.status from public.offers o where o.id = p_offer_id for update;
  -- + aktywne zaproszenie: select … from public.invitations where offer_id = p_offer_id
  --   and status = any(active_invitation_statuses()) for update;
  -- jeśli o.status <> expected_offer_status(active.status) → raise 'offer_state_inconsistent'
$$;

-- Metody domenowe (security definer, search_path = ''):
create function offer_lifecycle.invite(p_offer_id uuid, p_agent_id uuid, p_actor uuid) returns void as $$
  s := load(p_offer_id);
  if s is null or s.owner_id <> p_actor then raise 'offer_not_found';
  if s.status <> 'seeking_agent'         then raise 'offer_not_seeking_agent';
  if s.active is not null                then raise 'offer_state_inconsistent';   -- N-2 już złamany
  if p_agent_id not in top3(p_offer_id)  then raise 'agent_not_in_top3';          -- polityka N-7/N-5
  insert into public.invitations(offer_id, agent_id, owner_id) values (…);       -- status 'pending'
  update public.offers set status = 'invited' where id = p_offer_id;
$$;

create function offer_lifecycle.answer(p_offer_id uuid, p_actor uuid, p_answer text) returns void as $$
  -- p_answer ∈ {'accept','reject'}; najpierw zaproszenie wołającego (bez blokady cudzej oferty), potem load()
  inv := (select … from public.invitations where offer_id = p_offer_id and agent_id = p_actor);
  if inv is null then raise 'invitation_not_found';
  s := load(p_offer_id);
  if inv.status <> 'pending'  then raise 'invitation_already_answered';
  if s.status   <> 'invited'  then raise 'offer_state_inconsistent';
  if p_answer = 'accept' then
    update invitations set status='accepted', responded_at=now() where id = inv.id;
    update offers set status='in_progress' where id = p_offer_id;
  else
    update invitations set status='rejected', responded_at=now() where id = inv.id;
    update offers set status='seeking_agent' where id = p_offer_id;
  end if;
$$;

-- Zdarzenie spoza woli właściciela/agenta (usunięcie konta, panel, kaskada).
create function offer_lifecycle.release_active_invitation(p_offer_id uuid) returns void as $$
  update public.offers set status = 'seeking_agent'
   where id = p_offer_id and status in ('invited','in_progress');
$$;

-- Strażnik przy commicie: jedyne miejsce, które WIE, że N-2 jest prawdziwe.
create function offer_lifecycle.check_offer_consistency() returns trigger as $$
  -- dla NEW/OLD.offer_id (invitations) albo NEW.id (offers):
  -- jeśli oferta istnieje i status <> expected_offer_status(aktywne)
  --   → raise 'offer_state_inconsistent' using detail = json(offer_id, status, active)
$$;
create constraint trigger offers_status_matches_active_invitation
  after insert or update of status on public.offers
  deferrable initially deferred for each row execute function offer_lifecycle.check_offer_consistency();
create constraint trigger invitations_status_matches_offer
  after insert or update of status or delete on public.invitations
  deferrable initially deferred for each row execute function offer_lifecycle.check_offer_consistency();

-- Trigger usunięcia deleguje do agregatu zamiast pisać status sam:
--   restore_offer_on_invitation_delete() → offer_lifecycle.release_active_invitation(old.offer_id)
```

Uwagi do projektu:

- **Atomowość.** Każda metoda działa w transakcji wywołującego RPC. `load()` blokuje root `for update`, więc operacje na jednej ofercie są szeregowane. Constraint trigger `deferrable initially deferred` sprawdza N-2 przy commicie. Dzięki temu wolno zmienić dwie tabele w dowolnej kolejności w jednej transakcji, ale nie wolno zakończyć jej w stanie niespójnym. Indeks `invitations_one_active_per_offer` zostaje jako strażnik N-1.
- **Ograniczenie.** Strażnik przy commicie w `read committed` nie widzi równoległej, niezacommitowanej transakcji `service_role`. Pisarze spoza agregatu, którzy nie biorą blokady roota, mogą więc teoretycznie przepuścić rozjazd przy wyścigu. Akceptowalne: w aplikacji jedyni pisarze to metody agregatu.
- **Nazwane błędy zamiast kodów zwracanych.** `raise … errcode 'P0001'` + `message` = nazwa błędu. PostgREST oddaje je jako `error.code = 'P0001'`, `error.message = '<nazwa>'`.
- **Kompatybilność wsteczna.** W fazie przejściowej publiczne `invite_agent` / `respond_to_invitation` łapią wyjątki modułu i zwracają dotychczasowe kody (tabela mapowania niżej). Dzięki temu endpointy i testy działają bez zmian.

### Publiczne RPC (cienkie)

```sql
create or replace function public.invite_agent(p_offer_id uuid, p_agent_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
begin
  perform offer_lifecycle.invite(p_offer_id, p_agent_id, (select auth.uid()));
  return 'ok';
exception when sqlstate 'P0001' then
  return case sqlerrm
    when 'offer_not_found'             then 'not_found'
    when 'offer_not_seeking_agent'     then 'offer_locked'
    when 'offer_has_active_invitation' then 'offer_locked'
    when 'agent_not_in_top3'           then 'agent_not_ranked'
    else raise                      -- offer_state_inconsistent leci dalej jako błąd systemu
  end;
end $$;
```

(`else raise` w `case` to pseudokod: w PL/pgSQL realizuje się to jako `if … then return …; end if; raise;`.)

### Fasada TS i cienki endpoint

```ts
// src/lib/domain/offer-lifecycle.ts
export const ACTIVE_INVITATION_STATUSES = ["pending", "accepted"] as const satisfies readonly InvitationStatus[];

export const OFFER_LIFECYCLE_ERRORS = [
  "offer_not_found", "offer_not_seeking_agent", "offer_has_active_invitation",
  "agent_not_in_top3", "invitation_not_found", "invitation_already_answered",
  "offer_state_inconsistent",
] as const;
export type OfferLifecycleErrorName = (typeof OFFER_LIFECYCLE_ERRORS)[number];

export class OfferLifecycleError extends Error {
  constructor(readonly name: OfferLifecycleErrorName, readonly detail?: unknown) { super(name); }
}

/** Read-only lustro macierzy dla UI; źródłem prawdy jest offer_lifecycle w bazie (test parzystości w fazie 4). */
export const OFFER_CAPABILITIES: Record<OfferStatus, { edit: boolean; invite: boolean; showRanking: boolean }> = {
  draft:         { edit: true,  invite: false, showRanking: false },
  seeking_agent: { edit: true,  invite: true,  showRanking: true  },
  invited:       { edit: false, invite: false, showRanking: false },
  in_progress:   { edit: false, invite: false, showRanking: false },
};

export async function inviteAgent(supabase: SupabaseClient, offerId: string, agentId: string): Promise<void> {
  const { error } = await supabase.rpc("invite_agent_v2", { p_offer_id: offerId, p_agent_id: agentId });
  if (error) throw toLifecycleError(error);          // P0001 + znana nazwa → OfferLifecycleError, inaczej Error
}
```

```ts
// src/pages/api/owner/invitations.ts — po refaktorze (szkic)
const parsed = parseInviteForm(formData);                       // 1. parse
if (!parsed.success) return fail("invalid_input");
try {
  await inviteAgent(supabase, parsed.data.offerId, parsed.data.agentId);   // 2. metoda agregatu
  return context.redirect(`/owner/offers/${parsed.data.offerId}?invited=1`);
} catch (e) {
  return respondToLifecycleError(e, context, { offerId, agentId });        // 3. mapowanie błędu
}
// respondToLifecycleError: offer_not_found → 404; offer_not_seeking_agent / offer_has_active_invitation →
// ?error=offer_locked; agent_not_in_top3 → ?error=agent_not_ranked; offer_state_inconsistent →
// reportError("error", …) + ?error=unknown (koniec połykania).
```

Kontrola sesji i roli zostaje w endpoincie (konwencja `CLAUDE.md`: `/api/*` nie jest gated). Zmienia się tylko środek: zamiast `switch` po kodach zwracanych jest jedna funkcja mapująca błędy domenowe.

## Krok 5 — Before / after, fazy, testy, nazwy

### Before / after dla każdego miejsca reguły

| # | dziś | po refaktorze |
| --- | --- | --- |
| 1–2 | checki zbiorów statusów | bez zmian (słowniki), plus constraint triggery N-2 |
| 3 | indeks `invitations_one_active_per_offer` (literalna lista) | indeks zostaje (nie przebudowujemy go na produkcji); lista literalna dostaje komentarz „= offer_lifecycle.active_invitation_statuses()”, a test SQL porównuje predykat indeksu (`pg_get_expr(indpred, indrelid)`) z wynikiem funkcji |
| 4 | RLS `offers_select_invited_agent` z literalną listą | `i.status = any (offer_lifecycle.active_invitation_statuses())` |
| 5 | `invite_agent` zawiera całą logikę | wrapper → `offer_lifecycle.invite`; kody zwracane bez zmian (faza przejściowa) |
| 6 | `respond_to_invitation` zawiera całą logikę, blokuje cudzą ofertę | wrapper → `offer_lifecycle.answer`; najpierw zaproszenie wołającego, potem blokada roota |
| 7 | trigger sam pisze `offers.status` | trigger woła `offer_lifecycle.release_active_invitation`; zasada „status tylko przez agregat” bez wyjątków |
| 8 | jednorazowa naprawa | zostaje w historii; nowa migracja zaczyna się od zapytania wykrywającego (`offer_lifecycle.violations` jako widok) i przerywa, jeśli są naruszenia |
| 9 | RLS edycji z literalnym `('draft','seeking_agent')` | bez zmian w semantyce; komentarz wiąże ją z `OFFER_CAPABILITIES.edit` i testem parzystości |
| 10 | `src/types.ts:14-22` | bez zmian; dochodzi `ACTIVE_INVITATION_STATUSES` w module domeny |
| 11 | `INVITE_RESULTS` / `RESPOND_RESULTS` | w fazie 3 zastąpione przez `OFFER_LIFECYCLE_ERRORS`; stare kody usunięte razem z wrapperami |
| 12 | `isOfferEditable` | `OFFER_CAPABILITIES[status].edit` (ewentualnie `isOfferEditable` jako alias na czas migracji) |
| 13 | `switch` po kodach w 2 endpointach | `try { await metoda() } catch → respondToLifecycleError`; `offer_state_inconsistent` raportowany jako `error` |
| 14 | `update.ts:81-96` zgaduje `edit_locked` | bez zmian (edycja pól nie zmienia statusu; RLS #9 to wystarczający strażnik) |
| 15 | `[id].astro:60` `status === "seeking_agent"` | `OFFER_CAPABILITIES[status].showRanking` |
| 16–17 | literalne `["pending","accepted"]` w stronach | `ACTIVE_INVITATION_STATUSES`; brak aktywnego zaproszenia przy `invited`/`in_progress` → `reportError("error", "…invariant", …)` zamiast cichego `null` |
| 18 | `isOfferEditable` w 2 stronach | `OFFER_CAPABILITIES[status].edit` |
| 19 | teksty `DeleteOffer` | bez zmian |

### Fazy (test-first, jedna faza = jeden commit)

Runnery w repo: testy SQL `supabase/tests/*.sql` przez `psql` w CI (`.github/workflows/ci.yml:43-49`), vitest (`package.json`: `test:unit`, `test:integration`) i Playwright (`test:e2e`).

**Faza 0 — testy charakteryzujące (bez zmian w schemacie).** Nowy plik `supabase/tests/offer-lifecycle.sql` w stylu istniejących (`begin … rollback`, `do $$ … raise exception $$`, wzór `supabase/tests/invitation-response.sql:1-11`). Zielone dziś: wszystkie legalne przejścia i odmowy z tabeli niżej. Testy „naruszenie przez `service_role` musi rzucić błąd” mają dziś wynik czerwony. Commitujemy je zakomentowane z adnotacją `-- RED until phase 2` albo jako osobny blok `\if`, żeby CI zostało zielone.

**Faza 1 — wykrywanie, bez egzekwowania.** Migracja `…_offer_lifecycle_module.sql`: schemat `offer_lifecycle`, `active_invitation_statuses()`, `expected_offer_status()` i widok `offer_lifecycle.violations`. Przed `db push` na produkcji: `select * from offer_lifecycle.violations` przez SQL Editor. Musi być 0 wierszy; w przeciwnym razie naprawa ręczna i wpis w Addendum. Test SQL: widok pusty po każdym scenariuszu z fazy 0.

**Faza 2 — strażnik przy commicie.** Constraint triggery `offers_status_matches_active_invitation` i `invitations_status_matches_offer`. Faza 0 przechodzi na zielono, bo naruszenia `service_role` rzucają `offer_state_inconsistent` przy `set constraints all immediate`. Uwaga: istniejące testy wstawiają fixture'y z niespójnym statusem (`supabase/tests/account-deletion.sql:24-40`, np. O6 `in_progress` bez zaproszenia). Działają tylko dlatego, że kończą się `rollback`, a sprawdzenie deferred nie odpala się przed commitem. Faza musi to potwierdzić w CI. Fixture O6 (naprawa) trzeba ewentualnie przenieść do bloku z `alter table … disable trigger` w transakcji testu.

**Faza 3 — metody agregatu i cienkie RPC.** `offer_lifecycle.load/invite/answer/release_active_invitation`. `invite_agent` i `respond_to_invitation` stają się wrapperami, trigger usunięcia deleguje do agregatu, a RLS #4 używa `active_invitation_statuses()`. Wszystkie dotychczasowe testy (`supabase/tests/agent-invitation.sql`, `invitation-response.sql`, `account-deletion.sql`, `tests/integration/isolation.test.ts`, E2E `tests/e2e/critical-path.spec.ts`) przechodzą bez zmian. To jest dowód zachowania kontraktu. `npm run db:types` po zmianie sygnatur.

**Faza 4 — nazwane błędy w TS i cienkie endpointy.** Unit test `tests/unit/offer-lifecycle.test.ts` (najpierw czerwony): mapowanie `P0001` + nazwa → `OfferLifecycleError`, nieznana nazwa → zwykły `Error`, `OFFER_CAPABILITIES` zgodne z macierzą niżej. Integracyjny test parzystości `OFFER_CAPABILITIES.edit` z RLS #9: dla każdego statusu update jako właściciel zmienia 1 albo 0 wierszy. Nowe RPC `invite_agent_v2` / `respond_to_invitation_v2` (rzucające), endpointy na `try/catch`, strony na `ACTIVE_INVITATION_STATUSES` i `OFFER_CAPABILITIES`. Stare RPC usunięte w osobnej migracji po deployu (dwa kroki, bo migracje idą na produkcję przed merge).

**Faza 5 — dokumentacja.** Glosariusz: nowe nazwy (niżej). Destylacja: R-06 „wyjątek od zasady” znika, a ranking #3 dostaje „done when” spełnione (`rg "status in \('pending', ?'accepted'\)" supabase/migrations src` → tylko indeks z komentarzem + historyczne migracje).

### Przypadki testowe niezmiennika

Macierz przejść (L = legalne, N = nielegalne → nazwany błąd):

| # | stan wejściowy (oferta / aktywne) | operacja | wynik |
| --- | --- | --- | --- |
| T1 | `seeking_agent` / ∅ | `invite(A ∈ top3)` przez właściciela | L → `invited` / `pending(A)` |
| T2 | `seeking_agent` / ∅ | `invite(D ∉ top3)` | N → `agent_not_in_top3`, stan bez zmian |
| T3 | `seeking_agent` / ∅ | `invite` przez innego właściciela albo agenta | N → `offer_not_found` |
| T4 | `invited` / `pending(A)` | `invite(B)` | N → `offer_not_seeking_agent` |
| T5 | `in_progress` / `accepted(A)` | `invite(B)` | N → `offer_not_seeking_agent` |
| T6 | `invited` / `pending(A)` | `answer(A, accept)` | L → `in_progress` / `accepted(A)`, `responded_at` ustawione |
| T7 | `invited` / `pending(A)` | `answer(A, reject)` | L → `seeking_agent` / ∅; A znika z top 3; `invite(A)` → `agent_not_in_top3` |
| T8 | `invited` / `pending(A)` | `answer(B, …)` (B bez zaproszenia) | N → `invitation_not_found`; wiersz oferty niezablokowany przed tym błędem |
| T9 | `in_progress` / `accepted(A)` | `answer(A, reject)` | N → `invitation_already_answered` |
| T10 | `seeking_agent` / ∅, A ma `rejected` | `answer(A, accept)` | N → `invitation_already_answered` |
| T11 | `invited` / `pending(A)` | usunięcie konta A | L → `seeking_agent` / ∅ (przez `release_active_invitation`) |
| T12 | `in_progress` / `accepted(A)` | usunięcie konta A | L → `seeking_agent` / ∅ |
| T13 | `seeking_agent` / ∅, A ma `rejected` | usunięcie zaproszenia `rejected` | L → stan bez zmian |
| T14 | dowolny | usunięcie oferty przez właściciela | L → oferta i zaproszenia znikają, brak błędu triggera |
| T15 | `invited` / `pending(A)` | `service_role`: `update invitations set status='rejected', responded_at=now()` bez zmiany oferty + `set constraints all immediate` | N → `offer_state_inconsistent` |
| T16 | `seeking_agent` / ∅ | `service_role`: `update offers set status='in_progress'` | N → `offer_state_inconsistent` |
| T17 | `seeking_agent` / ∅ | `service_role`: insert drugiego aktywnego zaproszenia przy istniejącym aktywnym | N → `unique_violation` (indeks N-1) |
| T18 | `invited` / `pending(A)`, dwie sesje | równoległe `answer(A, accept)` i `answer(A, reject)` | dokładnie jedna L, druga → `invitation_already_answered` (wariant integracyjny vitest, dwa klienty) |
| T19 | stan niespójny wstrzyknięty z wyłączonym triggerem | `invite` / `answer` | N → `offer_state_inconsistent`, endpoint loguje `reportError("error")` (unit test mapowania) |
| T20 | dowolny | `update` pól oferty przez właściciela | L tylko dla `draft`/`seeking_agent`; zgodność z `OFFER_CAPABILITIES.edit` |

### Nowe nazwy „load-bearing”

| nazwa | gdzie | znaczenie |
| --- | --- | --- |
| `offer_lifecycle` | schemat Postgres | moduł agregatu „Oferta z zaproszeniami”, jedyny pisarz statusów |
| `offer_lifecycle.active_invitation_statuses()` | SQL | jedna definicja „aktywnego zaproszenia” |
| `offer_lifecycle.expected_offer_status()` | SQL | N-2 jako funkcja |
| `offer_lifecycle.load / invite / answer / release_active_invitation` | SQL | metody agregatu |
| `offer_lifecycle.violations` | widok SQL | wykrywanie naruszeń N-2 (operacyjne) |
| `offers_status_matches_active_invitation`, `invitations_status_matches_offer` | constraint triggery | strażnik N-2 przy commicie |
| `offer_state_inconsistent` | błąd domenowy | naruszenie N-2 — błąd systemu, zawsze raportowany |
| `offer_not_found`, `offer_not_seeking_agent`, `offer_has_active_invitation`, `agent_not_in_top3`, `invitation_not_found`, `invitation_already_answered` | błędy domenowe | nielegalne operacje użytkownika |
| `ACTIVE_INVITATION_STATUSES`, `OFFER_CAPABILITIES`, `OfferLifecycleError`, `respondToLifecycleError` | `src/lib/domain/offer-lifecycle.ts` | fasada TS i lustro dla UI |

## Podsumowanie

Najbardziej rdzeniowym i najsłabiej strzeżonym niezmiennikiem helloDOM jest zgodność statusu oferty z jej jedynym aktywnym zaproszeniem (N-2 razem z N-1). Wynika ona wprost z kryterium sukcesu „oferta przechodzi w status „w obsłudze”” i z guardrailu „najwyżej jeden przyjęty agent”. Dla zalogowanych użytkowników reguła dziś się trzyma, ale tylko z konwencji. Pilnuje jej trzech pisarzy w trzech migracjach (`invite_agent`, `respond_to_invitation` i trigger po `DELETE`, który łamie zasadę „status tylko przez RPC”), a „aktywne zaproszenie” ma cztery literalne definicje w SQL i dwie w stronach. Nic nie broni reguły przed `UPDATE` z `service_role` ani z panelu, a jednorazowa naprawa osieroconych ofert dowodzi, że rozjazd już się zdarzył. Wykryte naruszenia są połykane jako błędy użytkownika (`already_responded`, `offer_locked`), a nie raportowane. Rekomenduję agregat „Oferta z zaproszeniami” w Postgresie: moduł `offer_lifecycle` z metodami `invite`/`answer`/`release_active_invitation`, blokadą roota, nazwanymi błędami (`offer_state_inconsistent` i inne) i constraint triggerami sprawdzającymi N-2 przy commicie. Wariant TS z repozytorium odrzucam, bo PostgREST nie daje transakcji obejmującej kilka wywołań, a bezpośrednie połączenie `pg` z Workera to nowa infrastruktura. Publiczne RPC i endpointy stają się cienkie, a TS dostaje fasadę z `ACTIVE_INVITATION_STATUSES` i `OFFER_CAPABILITIES`. Refaktor idzie w pięciu fazach test-first (testy SQL w CI, potem vitest), z 20 przypadkami legalnych i nielegalnych przejść, a kontrakt dotychczasowych testów i E2E pozostaje niezmieniony aż do fazy 4.
