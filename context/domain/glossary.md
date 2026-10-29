---
artifact: domain-glossary
created: 2026-10-29
source: context/domain/domain-distillation.md
---

# Glossary: helloDOM

Use these words in code, tests, commits and conversations. When a name in
the code differs from the term, the term wins in new code; renaming old code
is a separate decision.

## Dopasowanie

| term                | means                                                                                         | name in code                                       | don't call it                                                                  |
| ------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------ |
| wynik               | punkty 0–100, które agent dostaje za dopasowanie do konkretnej oferty                         | `score`                                            | ocena, rating                                                                  |
| ranking             | posortowana lista agentów z wynikiem > 0 dla oferty                                           | `rank_agents_for_offer`, `RankedAgent`             | wyszukiwarka, lista agentów                                                    |
| top 3               | do trzech pierwszych agentów z rankingu, które widzi właściciel                               | `RankingList` (limit 3)                            | „zawsze trzech” — może być mniej                                               |
| remis               | ten sam wynik; rozstrzyga staż, potem wcześniejsza rejestracja                                | `order by … experience_years desc, created_at asc` | —                                                                              |
| profil dopasowania  | miasta, typy, przedział cen i lata doświadczenia agenta                                       | `AgentProfile` (kolumny w `profiles`)              | profil (bez dopełnienia — zob. konto)                                          |
| pełny profil        | profil z ≥1 miastem, ≥1 typem, obiema cenami i podanym stażem; tylko taki wchodzi do rankingu | `profile_complete`                                 | kompletny/zweryfikowany agent                                                  |
| miasto              | jedno z 18 miast wojewódzkich; warunek konieczny wyniku > 0                                   | `city`, `cities`, `CITIES`                         | lokalizacja, region                                                            |
| typ nieruchomości   | mieszkanie, dom albo działka                                                                  | `property_type`, `PROPERTY_TYPES`                  | kategoria, rodzaj                                                              |
| cena                | kwota oferty w PLN                                                                            | `price`                                            | wartość                                                                        |
| przedział cen       | najniższa i najwyższa cena, którą agent obsługuje (granice włącznie)                          | `price_min`, `price_max`                           | widełki budżetu                                                                |
| lata doświadczenia  | staż agenta w pełnych latach (0–60), 3 pkt za rok do 10 lat                                   | `experience_years`                                 | „staż” i „doświadczenie” oznaczają to samo — w kodzie używaj `experienceYears` |
| uzasadnienie wyniku | rozbicie wyniku na składowe dla właściciela                                                   | _missing in code_                                  | —                                                                              |

## Oferta i zaproszenia

| term                | means                                                                        | name in code                                                           | don't call it                     |
| ------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------- | --------------------------------- |
| oferta              | nieruchomość właściciela do sprzedaży lub wynajmu, dla której szukamy agenta | `offers`, `Offer`                                                      | ogłoszenie, listing               |
| status oferty       | szkic, szuka agenta, zaproszenie wysłane albo w obsłudze                     | `OfferStatus` (`draft`, `seeking_agent`, `invited`, `in_progress`)     | „status” bez dopełnienia          |
| szkic               | stan z PRD, w kodzie dziś nieosiągalny                                       | `draft`                                                                | —                                 |
| szuka agenta        | oferta zapisana, ranking widoczny, można zaprosić                            | `seeking_agent`                                                        | aktywna, opublikowana             |
| zaproszenie wysłane | właściciel zaprosił agenta i czeka na odpowiedź; edycja zablokowana          | `invited`                                                              | zablokowana (to skutek, nie stan) |
| w obsłudze          | agent przyjął zaproszenie                                                    | `in_progress`                                                          | zakończona, przypisana            |
| zaproszenie         | prośba właściciela do jednego agenta z top 3 o zajęcie się ofertą            | `invitations`, `Invitation`                                            | oferta dla agenta, lead           |
| status zaproszenia  | oczekuje na odpowiedź, przyjęte albo odrzucone                               | `pending`, `accepted`, `rejected`                                      | „status” bez dopełnienia          |
| aktywne zaproszenie | zaproszenie oczekujące albo przyjęte; oferta ma najwyżej jedno               | `status in ('pending','accepted')`, `invitations_one_active_per_offer` | otwarte, bieżące                  |
| przyjąć / odrzucić  | jednorazowa, ostateczna odpowiedź agenta                                     | `respond_to_invitation`, `accept`/`reject`                             | anulować, cofnąć                  |
| przyjęty agent      | agent z przyjętym zaproszeniem do oferty                                     | zaproszenie `accepted`                                                 | przypisany agent                  |
| blokada edycji      | po zaproszeniu właściciel nie może edytować oferty                           | `offer_locked`, `edit_locked`, `isOfferEditable`                       | —                                 |

## Konto i role

| term            | means                                                 | name in code                   | don't call it                                   |
| --------------- | ----------------------------------------------------- | ------------------------------ | ----------------------------------------------- |
| konto (rola)    | użytkownik z jedną, stałą rolą: właściciel albo agent | `profiles` (`role`), `Profile` | profil (zarezerwowane dla profilu dopasowania)  |
| właściciel      | osoba z nieruchomością, która szuka agenta            | `owner`                        | klient, użytkownik                              |
| agent           | agent nieruchomości odpowiadający na zaproszenia      | `agent`                        | pośrednik; nie mylić z agentem AI w narzędziach |
| usunięcie konta | trwałe usunięcie konta i wszystkich jego danych       | `delete_own_account`           | dezaktywacja, zawieszenie                       |
