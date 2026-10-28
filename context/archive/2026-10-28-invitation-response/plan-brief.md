# Odpowiedź na zaproszenie — Plan Brief

> Full plan: `context/changes/invitation-response/plan.md`

## What & Why

Agent przyjmuje albo odrzuca zaproszenie właściciela (S-06, FR-011). Przyjęcie przenosi ofertę w „w obsłudze”. Odrzucenie przywraca jej status „szuka agenta”, a odrzucający agent na stałe wypada z jej rankingu. To domyka drugie główne kryterium sukcesu PRD i regułę „najwyżej jeden przyjęty agent na ofertę”.

## Starting Point

S-05 dał tabelę `invitations` (statusy `pending | accepted | rejected`), funkcję `invite_agent` i widok zaproszenia u agenta, ale bez akcji. `authenticated` ma tylko `select`, ranking nie wie o odrzuceniach, a zaproszenie nie zapisuje daty odpowiedzi.

## Desired End State

Na stronie oferty z zaproszeniem `pending` agent widzi „Przyjmij” i „Odrzuć”, a każdą z tych akcji potwierdza inline. Po przyjęciu widzi „Przyjęto zaproszenie {data}”, a właściciel kartę „W obsłudze”. Po odrzuceniu oferta znika z panelu agenta (404). Właściciel widzi nad nowym rankingiem „Agent odrzucił zaproszenie {data}” i może zaprosić kolejnego agenta.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Ścieżka zapisu | `security definer respond_to_invitation(p_offer_id, p_response)` z kodem wyniku | Atomowo zmienia oba statusy bez dawania agentowi UPDATE; wzorzec `invite_agent` | Plan |
| Klucz funkcji | `offer_id` + `auth.uid()` | `unique (offer_id, agent_id)` daje jedno zaproszenie, a redirecty działają jak u właściciela | Plan |
| Data odpowiedzi | Kolumna `responded_at` + check spójności ze statusem | Potrzebna do „{data}” u obu stron | Plan |
| Wykluczenie z rankingu | `not exists` odrzuconego zaproszenia w `rank_agents_for_offer` | PRD; zamyka mylące `offer_locked` (F3), a `invite_agent` sam zwróci `agent_not_ranked` | Plan |
| Kontakt po przyjęciu | Brak; do Parked w roadmapie | PRD go nie wymaga, a ujawnienie e-maila to nowa ścieżka PII przed terminem 4.11 | Plan |
| Potwierdzenie | Inline dla obu akcji, jedna wyspa `.tsx` | Obie akcje są nieodwracalne, a koszt jest ten sam co dla jednej | Plan |
| Miejsce przycisków | Tylko `/agent/offers/[id]` | Agent odpowiada po obejrzeniu oferty; jedno miejsce do testów | Plan |
| Właściciel po odrzuceniu | Informacja z datą nad rankingiem | Bez niej status po cichu się cofa | Plan |
| Testy | Test SQL + kroki smoke | Wzorzec poprzednich slice'ów, uruchamiany w CI | Plan |

## Scope

**In scope:**
- Migracja: `responded_at`, `respond_to_invitation`, nowa wersja `rank_agents_for_offer`; test SQL; typy
- `POST /api/agent/invitations`, wyspa `InvitationResponse.tsx`, banery na `/agent` i stronie oferty agenta
- Karta „W obsłudze” z datą i informacja o odrzuceniu u właściciela; kroki smoke; wpis Parked w roadmapie

**Out of scope:**
- Kontakt między stronami, cofnięcie odpowiedzi lub zaproszenia, przyciski na liście `/agent`
- Status na liście `/owner`, edycja oferty (S-04); sprzątanie po usunięciu konta (S-07)
- Grant kolumnowy na `owner_id` (F4, zaakceptowane)

## Architecture / Approach

Wyspa (natywny POST z `offerId` i `response`) → endpoint sprawdza sesję i rolę agenta → `rpc("respond_to_invitation")`. Funkcja blokuje ofertę, potem zaproszenie (kolejność jak w `invite_agent`), sprawdza `pending`/`invited` i ustawia statusy oraz `responded_at`. Kod wyniku zamienia się w redirect `?accepted=1`, `/agent?rejected=1`, `?error=<kod>` albo w 404. RLS bez zmian: po odrzuceniu `offers_select_invited_agent` sam ukrywa ofertę.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Baza — odpowiedź i ranking bez odrzuconych | Migracja, test SQL, typy | Zmiana rankingu łamie testy S-03/S-05 |
| 2. Odpowiedź agenta | Endpoint, wyspa z potwierdzeniem, banery, smoke | Fokus i stan wysyłania wyspy przy natywnym POST |
| 3. Widok właściciela | Karta „W obsłudze”, informacja o odrzuceniu, smoke, Parked | Smoke zależny od lokalnych agentów w rankingu |

**Prerequisites:** S-05 zakończony; lokalny Supabase; przed merge `npx supabase db push` na produkcję (po sprawdzeniu statusów zaproszeń).
**Estimated effort:** ~2 sesje, 3 fazy, 3 commity.

## Open Risks & Assumptions

- Przyjęcie prowadzi donikąd w realnym świecie, bo nie ma kontaktu. To świadomie zaparkowane.
- Smoke potrzebuje dwóch ofert zaproszonych do agenta smoke (A do odrzucenia, B do przyjęcia). Agent smoke wygrywa ranking dzięki unikalnej cenie przebiegu i 60 latom stażu (wzorzec S-05).
- Check `responded_at`/status zakłada, że na produkcji wszystkie zaproszenia są `pending`. Sprawdź to przed `db push`.
- S-07: odrzucone zaproszenia znikną kaskadowo przy usunięciu agenta, a agent wróci wtedy do rankingu. Po usunięciu konta to bez znaczenia.

## Success Criteria (Summary)

- Agent przyjmuje albo odrzuca zaproszenie z potwierdzeniem, a status oferty zmienia się zgodnie z PRD.
- Odrzucający agent nie wraca do rankingu tej oferty, a właściciel może zaprosić kolejnego.
- Test SQL i smoke przechodzą w CI; przepływ działa na produkcji.
