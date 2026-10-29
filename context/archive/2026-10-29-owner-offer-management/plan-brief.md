# Owner offer management (S-04) — Plan Brief

> Full plan: `context/changes/owner-offer-management/plan.md`
> Research: `context/changes/owner-offer-management/research.md`

## What & Why

Właściciel ma widzieć swoje oferty ze statusem, poprawiać ofertę, dopóki szuka ona agenta, i móc ją usunąć (PRD FR-004, FR-005, FR-006). Dziś może tylko dodać ofertę i ją obejrzeć, więc pomyłki w cenie czy mieście nie da się naprawić.

## Starting Point

Lista na `/owner` istnieje, ale bez statusu. Baza ma dla `authenticated` tylko `select` i kolumnowy `insert` na `offers`, bez update i delete. Status `draft` jest nieosiągalny (S-03 tworzy oferty od razu jako `seeking_agent`).

## Desired End State

Każdy wiersz listy ma pill statusu. Na stronie oferty karta „Zarządzanie ofertą” daje „Edytuj” (tylko „Szuka agenta”) i „Usuń ofertę” (każdy status, z ostrzeżeniem, że agent straci dostęp). Edycja wraca z „Zapisano zmiany”, usunięcie z „Usunięto ofertę”; zablokowana edycja, cudza oferta i zła rola kończą się komunikatem, 404 albo 403.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Status „szkic” | Pominięty; edycja w `seeking_agent` (polityka dopuszcza też `draft`) | Zgodne z decyzją S-03, bez nowej ścieżki statusu przed terminem; odstępstwo od FR-004/005 zapisane | Research / Plan |
| Usuwanie ofert z agentem | Każdy status + ostrzeżenie w potwierdzeniu | Tak rozstrzygnął Socrates przy FR-006; agent nie dostaje powiadomienia | Plan |
| Mechanizm zapisu | Kolumnowy grant (bez `status`) + polityki RLS | Wzorzec insertu oferty, sprawdzony w badaniu, bez zmian w typach | Research / Plan |
| Zablokowany update (0 wierszy) | Doczytanie oferty → 404 albo `edit_locked` | RLS nie zgłasza błędu; obsługuje też wyścig z `invite_agent` | Research |
| Lista | Zostaje limit 50, bez stronicowania | Typowy właściciel ma jedną ofertę | Plan |
| Endpointy | `/api/owner/offers/update` i `/delete` z ukrytym `offerId` | Ten sam wzorzec co zaproszenia i usuwanie konta | Plan |
| Kolory statusów | `OFFER_STATUS_TONES` w `dictionaries.ts` | Jedno źródło dla listy i podsumowania | Plan |

## Scope

**In scope:**
- Migracja: grant update (pola bez `status`), grant delete, polityki `offers_update_own_editable`, `offers_delete_own`; test SQL
- Status na liście `/owner`
- `OfferForm` w trybie edycji, strona `/owner/offers/[id]/edit`, endpoint update
- `DeleteOffer.tsx`, endpoint delete, komunikaty po akcjach
- Kroki w smoke, wdrożenie na produkcję

**Out of scope:**
- Zapis jako szkic i akcja „Opublikuj”
- Powiadomienie agenta o usunięciu oferty
- Stronicowanie i filtry listy
- Logowanie błędów (F4 z S-03, do M3) i F5 z invitation-response

## Architecture / Approach

Baza pilnuje reguł: właściciel zmienia tylko pola (nie status) swojej oferty w `draft`/`seeking_agent` i usuwa swoją ofertę w każdym statusie; zaproszenia znikają kaskadą. Strony Astro czytają przez RLS, wyspy React (`OfferForm`, `DeleteOffer`) wysyłają natywny POST, endpointy przekierowują 302 z `?error=kod` mapowanym przez allowlistę w `src/lib/services/offers.ts`.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Baza | Granty, polityki, test SQL | Polityka update przepuści zmianę zablokowanej oferty |
| 2. Lista ze statusem i edycja | Pill na liście, `/edit`, endpoint update, smoke | Mylenie `not_found` z `edit_locked` przy 0 wierszach |
| 3. Usuwanie | `DeleteOffer`, endpoint delete, smoke | Usunięcie oferty z agentem bez czytelnego ostrzeżenia |
| 4. Produkcja | `db push`, merge, sprawdzenie na produkcji | Merge przed `db push` (kod bez grantów) |

**Prerequisites:** S-03, S-05, S-06, S-07 na `main`; lokalny Supabase; dostęp do `supabase link` produkcji.
**Estimated effort:** ~1–2 sesje w 4 fazach.

## Open Risks & Assumptions

- `npx supabase db reset` w fazie 1 kasuje lokalne konta; uprzedzić użytkownika.
- Wyścig edycji z `invite_agent` jest pokryty logiką 0 wierszy, ale nie testem współbieżnym.
- Test produkcyjny bez nowej rejestracji (limit ~2 maili/h): potrzebne istniejące konto właściciela.

## Success Criteria (Summary)

- Właściciel widzi status każdej oferty na `/owner`.
- Właściciel poprawia ofertę „Szuka agenta”, a po zaproszeniu edycja jest zablokowana.
- Właściciel usuwa ofertę w każdym statusie, a agent traci do niej dostęp.
