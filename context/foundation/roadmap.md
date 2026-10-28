---
project: helloDOM
version: 1
status: draft                    # draft | active | locked
created: 2026-10-27
updated: 2026-10-28
prd_version: 1
main_goal: speed
top_blocker: time
milestone_id: mvp-owner-agent-loop
milestone_seq: 1
milestone_status: open           # open | done
---

# Roadmap: helloDOM

> Derived from `context/foundation/prd.md` (v1) + auto-researched codebase baseline.
> Edit-in-place; the next milestone continues this file. Archive only when an independent roadmap replaces it.
> Slices below are listed in dependency order. The "At a glance" table is the index.

## Milestone

**M-1: MVP — od rejestracji do przyjętego zaproszenia** — Status: open

- **Intent:** Właściciel rejestruje się, dodaje ofertę, widzi top 3 dopasowanych agentów i zaprasza jednego z nich; agent przyjmuje albo odrzuca zaproszenie. Cały przepływ działa w design systemie helloDOM, z regułami dostępu z PRD (Guardrails).
- **Source materials:** `context/foundation/prd.md` (v1)
- **Done when:** every F-NN and S-NN below is `done`.
- **Scope anchors:** US-01; FR-001 – FR-012 (wszystkie wymagania konieczne). FR-013 i FR-014 (nice-to-have) są w `## Parked`.
- **Decisions:**
  - 2026-10-27 — Wygląd: design system helloDOM wg `context/foundation/design-system.md` (pełna specyfikacja tokenów light/dark, typografii, layoutu i komponentów).
  - 2026-10-27 — Miasta i typy nieruchomości to zamknięte listy. Typy: mieszkanie, dom, działka. Miasta: 18 miast wojewódzkich. Jeden wspólny słownik używają formularz oferty, profil agenta i ranking; wprowadza go pierwszy wycinek, który go potrzebuje (S-02).

## Vision recap

Właściciel nieruchomości, który chce ją sprzedać lub wynająć, nie wie, którego agenta wybrać, i wybiera z polecenia albo przypadkiem. helloDOM liczy dla każdego agenta wynik dopasowania 0–100 do konkretnej oferty (miasto jest warunkiem koniecznym; punkty dają typ nieruchomości, przedział cen i doświadczenie) i pokazuje trzech najlepszych. Właściciel zaprasza jednego, a agent przyjmuje albo odrzuca zaproszenie.

## North star

**S-03: Właściciel zapisuje ofertę i od razu widzi top 3 agentów z wynikiem 0–100** — to główne kryterium sukcesu z PRD („od rejestracji do rankingu w 3 akcjach”); przy celu `speed` dowozimy je jako pierwszą wartość widoczną dla użytkownika.

> „North star” (gwiazda przewodnia) to najmniejszy przepływ end-to-end, którego dostarczenie dowodzi, że produkt działa. Stoi tak wcześnie, jak pozwalają zależności, bo reszta ma sens tylko wtedy, gdy on działa.

## At a glance

| ID   | Change ID                  | Outcome (user can …)                                                                 | Prerequisites | PRD refs                        | Status   |
| ---- | -------------------------- | ------------------------------------------------------------------------------------ | ------------- | ------------------------------- | -------- |
| F-01 | app-shell                  | (foundation) aplikacja ma tokeny, fonty i powłokę design systemu helloDOM (sidebar/dock, light/dark) | —             | NFR (360 px, polskie znaki, przeglądarki) | done |
| S-01 | role-based-signup          | użytkownik rejestruje się jako właściciel albo agent i trafia na swój panel           | F-01          | FR-001, FR-002                  | done |
| S-02 | agent-profile              | agent uzupełnia profil: miasta, typy, przedział cen, lata doświadczenia              | S-01          | FR-007                          | done |
| S-03 | offer-top3-ranking         | właściciel zapisuje ofertę i widzi top 3 agentów z wynikiem 0–100                    | S-01, S-02    | US-01, FR-003, FR-008           | in-progress |
| S-04 | owner-offer-management     | właściciel przegląda swoje oferty ze statusem, edytuje je i usuwa                    | S-03          | FR-004, FR-005, FR-006          | proposed |
| S-05 | agent-invitation           | właściciel zaprasza agenta z top 3, a agent widzi zaproszenie i ofertę               | S-03          | FR-009, FR-010                  | proposed |
| S-06 | invitation-response        | agent przyjmuje albo odrzuca zaproszenie, a status oferty się zmienia                | S-05          | FR-011                          | proposed |
| S-07 | account-deletion           | użytkownik usuwa konto razem ze wszystkimi swoimi danymi                             | S-06          | FR-012                          | proposed |

## Baseline

What's already in place in the codebase as of `2026-10-27` (auto-researched + user-confirmed).
Foundations below assume these are present and do NOT re-scaffold them.

- **Frontend:** present — Astro 7 + React 19 + Tailwind 4 + shadcn/ui (`components.json`, `src/components/ui/button.tsx`). Wygląd to wciąż style startera; design systemu helloDOM jeszcze nie ma w kodzie (dopisane przez użytkownika).
- **Backend / API:** partial — są tylko endpointy auth (`src/pages/api/auth/{signin,signup,signout}.ts`); brak `src/lib/services/`.
- **Data:** absent — Supabase jest skonfigurowany (`supabase/config.toml`), ale nie ma migracji, tabel aplikacji ani RLS.
- **Auth:** partial — działa rejestracja, logowanie i wylogowanie e-mailem; rejestracja nie zapisuje roli (`src/pages/api/auth/signup.ts:15`), middleware chroni tylko `/dashboard`, nie ma usuwania konta.
- **Deploy / infra:** present — `wrangler.jsonc`, GitHub Actions z jobami ci, smoke i deploy (auto-deploy po merge do `main`); produkcja na https://hellodom.hellodom.workers.dev.
- **Observability:** partial — włączone logi Workers (`wrangler.jsonc:12`); brak narzędzia do śledzenia błędów.

## Foundations

### F-01: Powłoka aplikacji w design systemie helloDOM

- **Outcome:** (foundation) aplikacja ma tokeny, fonty, tryb light/dark i powłokę (sidebar 244 px na desktopie, dock na mobile) zgodne ze specyfikacją [`design-system.md`](design-system.md); istniejące strony auth z niej korzystają.
- **Change ID:** app-shell
- **PRD refs:** NFR (każdy widok używalny przy 360 px, poprawne polskie znaki; dwie najnowsze wersje Chrome, Firefoksa, Safari i Edge)
- **Unlocks:** S-01, S-02, S-03, S-04, S-05, S-06, S-07 — każdy wycinek z UI buduje widoki w tej powłoce zamiast w stylach startera.
- **Prerequisites:** —
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:** — (pełna specyfikacja tokenów light/dark rozstrzygnięta w `context/foundation/design-system.md`)
- **Risk:** Stoi przed wycinkami, bo bez niego każdy widok trzeba by przestylować drugi raz. Ryzyko: rozrośnie się w kompletny katalog komponentów, więc zakres to tylko tokeny, fonty, powłoka i motyw; komponenty dochodzą w wycinkach, które ich używają.
- **Status:** done

## Slices

### S-01: Rejestracja z rolą właściciel/agent

- **Outcome:** użytkownik rejestruje się e-mailem i hasłem, wybierając rolę właściciel albo agent na stałe, loguje się, wylogowuje i trafia na panel swojej roli; niezalogowany jest przekierowywany do logowania.
- **Change ID:** role-based-signup
- **PRD refs:** FR-001, FR-002
- **Prerequisites:** F-01
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Pierwsze tabele i RLS w projekcie; rola jest podstawą wszystkich późniejszych reguł dostępu, więc błąd tutaj przenosi się do każdego wycinka.
- **Carried over (app-shell impl review F2, F5, F6, F10):** przy przepisywaniu endpointów auth (`src/pages/api/auth/signin.ts`, `signup.ts`):
  - `?error=` niesie kod błędu (np. `invalid_credentials`, `unavailable`), a nie tekst; strony auth mapują kod przez allowlist w `src/lib/services/auth-errors.ts`, nieznany kod → ogólny polski komunikat (dziś dowolny tekst z URL trafia do `ServerError`).
  - wejście walidowane `z` z `astro/zod` (`safeParse`), `request.formData()` i wywołania Supabase w `try/catch` z przekierowaniem `?error=` zamiast 500.
  - (F10) `src/pages/auth/confirm-email.astro` wybiera komunikat po `import.meta.env.DEV`, a nie po tym, czy Supabase wymaga potwierdzenia; decyduj na podstawie `session` zwróconej przez `signUp` (null = wymaga potwierdzenia) i przekaż to w przekierowaniu.
  - (F5) pola formularza (`src/components/auth/FormField.tsx`) dostają stan hover z DoD design systemu: ciemniejsza ramka niż domyślna `--rs-input-border` (np. `--rs-fg-3`), focus i błąd mają pierwszeństwo.
- **Status:** done

### S-02: Profil agenta

- **Outcome:** agent może edytować swój profil (obsługiwane miasta, typy nieruchomości, przedział cen, lata doświadczenia); agent z niepełnym profilem nie trafia do rankingu.
- **Change ID:** agent-profile
- **PRD refs:** FR-007
- **Prerequisites:** S-01
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Stoi przed gwiazdą przewodnią, bo ranking bez profili agentów nie ma czego liczyć. Wprowadza wspólny słownik miast (18 wojewódzkich) i typów (mieszkanie, dom, działka), z którego potem korzystają S-03 i ranking (zob. Decisions w `## Milestone`).
- **Status:** done

### S-03: Oferta i ranking top 3

- **Outcome:** zalogowany właściciel dodaje ofertę (wymagane: miasto, typ, cena, transakcja; opcjonalne: metraż, pokoje, opis) i po zapisaniu widzi do 3 agentów z wynikiem 0–100 albo komunikat, gdy dopasowanych agentów jest mniej niż 3.
- **Change ID:** offer-top3-ranking
- **PRD refs:** US-01, FR-003, FR-008
- **Prerequisites:** S-01, S-02
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:**
  - Kiedy oferta przechodzi ze „szkicu” do „szuka agenta”: od razu po zapisaniu czy po osobnej akcji właściciela? — Owner: user. Block: no.
- **Risk:** Formularz oferty używa słownika miast i typów z S-02, więc dopasowanie po mieście to porównanie pozycji słownika, nie tekstu. To gwiazda przewodnia i miejsce, w którym żyje reguła wyniku (miasto jako warunek konieczny, 35/35/30 pkt, remisy według stażu, potem daty rejestracji); błąd w regule podważa cały produkt.
- **Status:** in-progress

### S-04: Zarządzanie ofertami właściciela

- **Outcome:** właściciel przegląda listę swoich ofert ze statusem, edytuje ofertę w statusie „szkic” albo „szuka agenta” i może usunąć ofertę.
- **Change ID:** owner-offer-management
- **PRD refs:** FR-004, FR-005, FR-006
- **Prerequisites:** S-03
- **Parallel with:** S-05, S-06, S-07
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Poza ścieżką gwiazdy przewodniej, więc może iść równolegle; blokada edycji po zaproszeniu zależy od statusów wprowadzanych w S-05, więc trzeba uzgodnić zestaw statusów.
- **Status:** proposed

### S-05: Zaproszenie agenta

- **Outcome:** właściciel zaprasza jednego agenta z top 3 swojej oferty (oferta przechodzi w „zaproszenie wysłane”), a agent widzi swoje zaproszenia i tylko te oferty, do których go zaproszono.
- **Change ID:** agent-invitation
- **PRD refs:** FR-009, FR-010
- **Prerequisites:** S-03
- **Parallel with:** S-04
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Pierwszy dostęp agenta do cudzych danych; RLS musi dopuścić wyłącznie oferty z zaproszeniem (PRD Guardrails).
- **Status:** proposed

### S-06: Odpowiedź na zaproszenie

- **Outcome:** agent przyjmuje zaproszenie (oferta przechodzi w „w obsłudze”) albo je odrzuca (oferta wraca do „szuka agenta”, a ten agent znika z jej rankingu).
- **Change ID:** invitation-response
- **PRD refs:** FR-011
- **Prerequisites:** S-05
- **Parallel with:** S-04
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Domyka drugie główne kryterium sukcesu; musi pilnować reguły „najwyżej jeden przyjęty agent na ofertę”.
- **Status:** proposed

### S-07: Usunięcie konta

- **Outcome:** użytkownik usuwa konto razem ze wszystkimi swoimi danymi; gdy robi to agent z przyjętą ofertą, oferta wraca do „szuka agenta” bez przypisanego agenta.
- **Change ID:** account-deletion
- **PRD refs:** FR-012
- **Prerequisites:** S-06
- **Parallel with:** S-04
- **Blockers:** —
- **Unknowns:**
  - Usunięcie użytkownika z Supabase Auth wymaga uprawnień serwisowych; czy akceptujemy dodatkowy sekret Worker’a z takimi uprawnieniami? — Owner: user. Block: no.
- **Risk:** Ostatni, bo musi sprzątać dane ze wszystkich wcześniejszych tabel (oferty, profile, zaproszenia); NFR wymaga, żeby po usunięciu nie zostały żadne dane konta.
- **Status:** proposed

## Backlog Handoff

| Roadmap ID | Change ID              | Suggested issue title                                       | Ready for `/10x-plan` | Notes |
| ---------- | ---------------------- | ----------------------------------------------------------- | --------------------- | ----- |
| F-01       | app-shell              | Powłoka aplikacji w design systemie helloDOM                | yes                   | Run `/10x-plan app-shell` |
| S-01       | role-based-signup      | Rejestracja z rolą właściciel/agent i panele ról            | no                    | Czeka na F-01 |
| S-02       | agent-profile          | Agent edytuje profil dopasowania                            | no                    | Czeka na S-01 |
| S-03       | offer-top3-ranking     | Właściciel dodaje ofertę i widzi top 3 agentów              | no                    | Gwiazda przewodnia; czeka na S-01, S-02 |
| S-04       | owner-offer-management | Lista, edycja i usuwanie ofert właściciela                  | no                    | Czeka na S-03 |
| S-05       | agent-invitation       | Zaproszenie agenta z top 3 i widok zaproszeń agenta         | no                    | Czeka na S-03 |
| S-06       | invitation-response    | Agent przyjmuje albo odrzuca zaproszenie                    | no                    | Czeka na S-05 |
| S-07       | account-deletion       | Usunięcie konta razem z danymi                              | no                    | Czeka na S-06 |

## Open Roadmap Questions

Brak otwartych pytań. Pytania o tokeny design systemu i o format miast/typów zostały rozstrzygnięte 2026-10-27 (zob. Decisions w `## Milestone`).

## Parked

- **Uzasadnienie wyniku agenta (FR-013)** — Why parked: nice-to-have; przy celu `speed` poza ścieżką wymagań koniecznych.
- **Reset hasła (FR-014)** — Why parked: nice-to-have; PRD akceptuje to ryzyko w MVP.
- **Osobne przedziały cen dla sprzedaży i najmu** — Why parked: reguła wyniku w PRD zakłada jeden przedział cen agenta, niezależny od transakcji (decyzja 2026-10-28, S-02 agent-profile); wraca, gdy jeden przedział okaże się za mało, by rozróżnić agentów sprzedaży i najmu.
- **Narzędzie do śledzenia błędów** — Why parked: PRD go nie wymaga, a logi Workers wystarczą na start; wraca po MVP.
- **Czat właściciel–agent** — Why parked: PRD §Non-Goals.
- **Zdjęcia ofert** — Why parked: PRD §Non-Goals.
- **Mapa** — Why parked: PRD §Non-Goals.
- **Wycena nieruchomości przez AI** — Why parked: PRD §Non-Goals.
- **Płatności** — Why parked: PRD §Non-Goals.
- **Powiadomienia** — Why parked: PRD §Non-Goals.
- **Weryfikacja agentów** — Why parked: PRD §Non-Goals; dane z profilu przyjmujemy tak, jak je podał agent.
- **Firmy i zespoły agentów** — Why parked: PRD §Non-Goals; jeden agent to jedno konto.
- **Eksport ofert na portale** — Why parked: PRD §Non-Goals.
- **Limit czasu na odpowiedź agenta** — Why parked: PRD §Non-Goals; zaproszenie czeka bez limitu.
- **Aplikacja mobilna** — Why parked: PRD §Non-Goals; produkt jest aplikacją webową.

## Milestone History

## Done

- **F-01: (foundation) aplikacja ma tokeny, fonty, tryb light/dark i powłokę (sidebar 244 px na desktopie, dock na mobile) zgodne ze specyfikacją [`design-system.md`](design-system.md); istniejące strony auth z niej korzystają.** — Archived 2026-10-27 → `context/archive/2026-10-27-app-shell/`. Lesson: —.
- **S-01: użytkownik rejestruje się e-mailem i hasłem, wybierając rolę właściciel albo agent na stałe, loguje się, wylogowuje i trafia na panel swojej roli; niezalogowany jest przekierowywany do logowania.** — Archived 2026-10-28 → `context/archive/2026-10-27-role-based-signup/`. Lesson: —.
- **S-02: agent może edytować swój profil (obsługiwane miasta, typy nieruchomości, przedział cen, lata doświadczenia); agent z niepełnym profilem nie trafia do rankingu.** — Archived 2026-10-28 → `context/archive/2026-10-28-agent-profile/`. Lesson: —.
