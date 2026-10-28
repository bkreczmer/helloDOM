# Zaproszenie agenta — Plan Brief

> Full plan: `context/changes/agent-invitation/plan.md`
> Research: `context/changes/agent-invitation/research.md`

## What & Why

Właściciel zaprasza jednego agenta z top 3 swojej oferty, a oferta przechodzi w „zaproszenie wysłane”. Agent widzi swoje zaproszenia i tylko te oferty, do których go zaproszono (S-05, FR-009, FR-010). To pierwszy dostęp agenta do cudzych danych, więc RLS musi dopuścić wyłącznie oferty z zaproszeniem.

## Starting Point

Oferta ma status `seeking_agent`, a check dopuszcza już `invited`, ale nikt nie ma prawa zmienić statusu. Ranking `rank_agents_for_offer` zwraca `agent_id`, którego UI nie pokazuje. Tabeli zaproszeń nie ma, agent nie widzi żadnej oferty, a `/agent` to placeholder.

## Desired End State

Na stronie oferty w statusie „szuka agenta” każdy agent z top 3 ma przycisk „Zaproś”. Po zaproszeniu ranking znika, a w jego miejscu jest karta „Zaproszenie wysłane {data}”, w podsumowaniu pill statusu. Agent na `/agent` widzi listę zaproszeń, a na `/agent/offers/[id]` ofertę bez danych właściciela. Każda inna oferta daje mu 404.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Ścieżka zapisu | Funkcja `security definer invite_agent` zwracająca kod wyniku | Atomowo sprawdza właściciela, status i top 3 bez dawania właścicielowi UPDATE na `status` | Research |
| Przekazanie agenta | `agentId` w ukrytym polu, top 3 sprawdzane ponownie w funkcji | `agent_id` i tak jest w RPC, a ponowna kontrola zamyka wyścig ze zmianą rankingu | Research |
| RLS bez rekursji | `owner_id` zdenormalizowany w `invitations` | Polityki zaproszeń nie dotykają `offers`, więc nie ma cyklu polityk | Research |
| Unikalność | `unique (offer_id, agent_id)` i częściowy unikalny indeks aktywnego zaproszenia | Jedno zaproszenie naraz, a w S-06 najwyżej jeden przyjęty agent | Research |
| Kontakt | Brak danych kontaktowych w S-05 | PRD go nie wymaga, kontakt po przyjęciu rozstrzyga S-06 | Plan |
| Strona oferty po zaproszeniu | Karta statusu zamiast rankingu | Stabilna, bo nie zależy od zmian rankingu, i zgodna z „jedno zaproszenie naraz” | Plan |
| Widok agenta | Lista na `/agent` + `/agent/offers/[id]`, bez nowej pozycji nawigacji | Najmniej tras, a szczegół daje jednoznaczny test IDOR po URL | Plan |
| Widoczność oferty dla agenta | Tylko przy zaproszeniu `pending`/`accepted` | Najmniejsze uprawnienia, a S-06 nie musi zmieniać polityki | Plan |
| Testy | Test SQL + kroki smoke | Wzorzec poprzednich slice'ów, uruchamiany w CI | Plan |

## Scope

**In scope:**
- Tabela `invitations`, funkcja `invite_agent`, polityka `offers_select_invited_agent`, test SQL, typy
- `POST /api/owner/invitations`, przycisk „Zaproś”, karta statusu, pill statusu, banery sukcesu i błędów
- Lista zaproszeń na `/agent`, strona `/agent/offers/[id]`, `OfferSummary` przeniesiony do `src/components/offers/`
- Kroki smoke: role, cudza oferta, agent spoza rankingu, ponowne zaproszenie, IDOR

**Out of scope:**
- Przyjęcie i odrzucenie zaproszenia, wykluczenie odrzuconego agenta z rankingu (S-06)
- Dane kontaktowe, snapshot zaproszonego agenta, cofnięcie zaproszenia, okno potwierdzenia
- Status na liście `/owner`, edycja oferty (S-04); przywracanie statusu po usunięciu konta (S-07)

## Architecture / Approach

Formularz w karcie rankingu (`.astro`, natywny POST) → endpoint sprawdza sesję i rolę → `rpc("invite_agent")`. Funkcja blokuje wiersz oferty (`for update`), sprawdza status `seeking_agent` i obecność agenta w `rank_agents_for_offer`, wstawia zaproszenie i ustawia `invited`. Kod wyniku zamienia się w redirect `?invited=1`, `?error=<kod>` albo w 404. Agent czyta zaproszenia przez własną politykę, a oferty przez `exists` na aktywnym zaproszeniu.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Baza — zaproszenia i RLS | Tabela, funkcja, polityka agenta, test SQL, typy | Rekursja polityk albo luka RLS |
| 2. Zaproszenie przez właściciela | Endpoint, przycisk „Zaproś”, karta statusu, smoke | Smoke zaprasza złego agenta (lokalni agenci w top 3) |
| 3. Widok agenta | Lista zaproszeń, oferta dla agenta z 404 bez zaproszenia, smoke IDOR | Wyciek danych właściciela w widoku agenta |

**Prerequisites:** S-03 zakończony (ranking z `agent_id`); lokalny Supabase; przed merge `npx supabase db push` na produkcję.
**Estimated effort:** ~2–3 sesje, 3 fazy, 3 commity.

## Open Risks & Assumptions

- Smoke-agent musi być „Agentem 1” także lokalnie (starsi smoke-agenci wygrywają remisy). Daje mu to unikalna cena przebiegu i staż 60 lat, a id smoke czyta z formularza „Zaproś”.
- S-07: kaskada skasuje zaproszenie usuniętego agenta, ale oferta zostanie w `invited`. S-07 musi przywrócić `seeking_agent`.
- S-04: grant UPDATE na `offers` nie może obejmować `status`.
- Przypadkowe kliknięcie „Zaproś” blokuje ofertę do odpowiedzi agenta, bo w S-05 nie ma cofnięcia zaproszenia.

## Success Criteria (Summary)

- Właściciel jednym kliknięciem zaprasza agenta z top 3 i widzi „Zaproszenie wysłane”; drugie zaproszenie jest odrzucone z komunikatem.
- Agent widzi swoje zaproszenia i ofertę, do której go zaproszono; każda inna oferta daje 404.
- Test SQL i smoke przechodzą w CI.
