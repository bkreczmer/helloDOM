---
project: "helloDOM"
version: 1
status: draft
created: 2026-10-27
context_type: greenfield
product_type: web-app
target_scale:
  users: large
  qps: medium
  data_volume: medium
timeline_budget:
  mvp_weeks: 1
  hard_deadline: 2026-11-04
  after_hours_only: true
---

# helloDOM — PRD

## Vision & Problem Statement

Właściciel nieruchomości, który postanowił ją sprzedać lub wynająć, nie wie, którego agenta wybrać. Dziś pyta znajomych albo szuka w Google, a potem traci czas na rozmowy z wieloma agentami, bez wspólnych kryteriów porównania. Wybór opiera się na poleceniach i przypadku, a nie na dopasowaniu.

Wgląd: dopasowanie do konkretnej oferty liczy się bardziej niż popularność agenta. Katalogi i portale pokazują agentów według reklamy lub opinii, a nikt nie dopasowuje agenta do miasta, typu nieruchomości i przedziału cen oferty. helloDOM dobiera właścicielowi trzech najlepiej dopasowanych agentów. Wgląd przy skali 100×: gdy w jednym mieście jest wielu agentów z wynikiem 100, reguła przestaje ich różnicować i o kolejności decyduje wyłącznie staż.

## User & Persona

**Persona główna: właściciel nieruchomości.** Ma nieruchomość i właśnie postanowił ją sprzedać lub wynająć. Sięga po helloDOM w chwili, gdy potrzebuje agenta i nie ma podstaw, żeby któregoś wybrać.

### Secondary persona

**Agent nieruchomości.** Prowadzi profil opisujący, czym się zajmuje, i odpowiada na zaproszenia właścicieli.

## Success Criteria

Pierwszy przepływ (3 akcje do widocznej wartości): 1. rejestracja jako właściciel → 2. dodanie oferty → 3. ranking top 3 agentów z wynikiem 0–100. Przepływ domyka zaproszenie: właściciel zaprasza agenta, a agent przyjmuje albo odrzuca. Statusy oferty: szkic → szuka agenta → zaproszenie wysłane → w obsłudze (po odrzuceniu oferta wraca do „szuka agenta”).

### Primary
- Właściciel przechodzi od rejestracji do rankingu top 3 agentów dla swojej oferty w 3 akcjach.
- Zaproszony agent przyjmuje zaproszenie, a oferta przechodzi w status „w obsłudze”.

### Secondary
- Właściciel rozumie, dlaczego agent dostał dany wynik.

### Guardrails
- Właściciel nie widzi ani nie edytuje cudzych ofert.
- Agent nie widzi ofert, do których nie został zaproszony.
- Oferta ma najwyżej jednego przyjętego agenta.

## User Stories

### US-01: Właściciel dostaje ranking agentów dla swojej oferty

- **Given** zalogowany właściciel
- **When** zapisuje ofertę
- **Then** widzi top 3 agentów z wynikiem 0–100

#### Acceptance Criteria
- Agent obsługujący miasto oferty jest w rankingu wyżej niż agent spoza tego miasta.

## Functional Requirements

### Authentication
- FR-001: Niezalogowany może zarejestrować się e-mailem i hasłem, wybierając rolę właściciel albo agent. Priority: must-have
  > Socrates: Rozważone kontrargumenty: stała rola blokuje agenta z własną nieruchomością; brak weryfikacji agentów. Rozstrzygnięcie: zostaje bez zmian.
- FR-002: Użytkownik może zalogować się i wylogować. Priority: must-have
  > Socrates: Kontrargument: „brak resetu hasła zablokuje użytkownika, który je zapomni”. Rozstrzygnięcie: FR-002 zostaje; reset hasła dodany jako FR-014 (nice-to-have), ryzyko akceptowane w MVP.
- FR-014: Użytkownik może zresetować zapomniane hasło. Priority: nice-to-have
- FR-012: Użytkownik może usunąć swoje konto razem ze swoimi danymi; gdy agent usuwa konto, jego przyjęta oferta wraca do statusu „szuka agenta” bez przypisanego agenta. Priority: must-have
  > Socrates: Kontrargument: „agent usuwa konto z przyjętą ofertą, a oferta zostaje »w obsłudze« bez agenta”. Rozstrzygnięcie: oferta wraca do gry jako nowa, bez przypisanego agenta.

### Offers
- FR-003: Właściciel może dodać ofertę; wymagane są pola rankingu (miasto, typ, cena) i transakcja, a metraż, liczba pokoi i opis są opcjonalne. Priority: must-have
  > Socrates: Kontrargument: „do rankingu potrzeba tylko miasta, typu i ceny; pozostałe pola wydłużają pierwszą akcję”. Rozstrzygnięcie: wymagane tylko pola rankingu, reszta opcjonalna.
- FR-004: Właściciel może przeglądać listę swoich ofert z ich statusem (szkic → szuka agenta → zaproszenie wysłane → w obsłudze). Priority: must-have
  > Socrates: Rozważone kontrargumenty: typowy właściciel ma jedną ofertę; status „szkic” wydłuża drogę do rankingu. Rozstrzygnięcie: zostaje bez zmian.
- FR-005: Właściciel może edytować swoją ofertę, gdy ma ona status „szkic” albo „szuka agenta”. Priority: must-have
  > Socrates: Kontrargument: „edycja po zaproszeniu zmienia ofertę, którą agent już ocenił”. Rozstrzygnięcie: po wysłaniu zaproszenia oferta jest zablokowana do edycji.
- FR-006: Właściciel może usunąć swoją ofertę. Priority: must-have
  > Socrates: Rozważony kontrargument: usunięcie oferty „w obsłudze” znika agentowi bez śladu. Rozstrzygnięcie: zostaje bez zmian.

### Agent profile
- FR-007: Agent może edytować swój profil: obsługiwane miasta, typy nieruchomości, przedział cen, lata doświadczenia. Priority: must-have
  > Socrates: Kontrargument: „agent bez uzupełnionego profilu nigdy nie trafi do top 3”. Rozstrzygnięcie: akceptowane, to właściwe zachowanie.

### Matching
- FR-008: Właściciel może zobaczyć do 3 najlepszych agentów dla swojej oferty z wynikiem 0–100; agenci z wynikiem 0 nie są pokazywani, a gdy jest ich mniej niż 3, właściciel widzi komunikat. Priority: must-have
  > Socrates: Kontrargument: „przy małej liczbie agentów top 3 zawiera agentów, którzy w ogóle nie pasują”. Rozstrzygnięcie w fazie 4: zawsze 3. Zmienione w fazie 5, gdy miasto stało się warunkiem koniecznym: w top 3 trafiają tylko agenci z wynikiem > 0, a gdy jest ich mniej, pojawia się komunikat.
- FR-013: Właściciel może zobaczyć uzasadnienie wyniku każdego agenta z top 3. Priority: nice-to-have
  > Socrates: Kontrargument: „bez uzasadnienia wynik 0–100 wygląda arbitralnie”. Rozstrzygnięcie: zostaje nice-to-have, ryzyko akceptowane w pierwszej wersji.

### Invitations
- FR-009: Właściciel może zaprosić jednego agenta z top 3 swojej oferty. Priority: must-have
  > Socrates: Kontrargument: „jedno zaproszenie naraz wydłuża szukanie, gdy agent zwleka”. Rozstrzygnięcie: akceptowane w MVP; limit czasu na odpowiedź poza zakresem.
- FR-010: Agent może zobaczyć oferty, do których został zaproszony, oraz swoje zaproszenia. Priority: must-have
  > Socrates: Kontrargument: „agent widzi ofertę z top 3, choć nikt go nie zaprosił”. Rozstrzygnięcie w rundzie: zostaje. Zmienione po przeglądzie notatek: agent widzi tylko oferty, do których został zaproszony. Powody: widoczność w top 3 jest niestabilna, bo ranking się zmienia; właściciel sam decyduje, komu pokazać ofertę; reguła dostępu i jej test są jednoznaczne.
- FR-011: Agent może przyjąć albo odrzucić zaproszenie; po odrzuceniu oferta wraca do statusu „szuka agenta”, a agent, który odrzucił, wypada z rankingu tej oferty. Priority: must-have
  > Socrates: Kontrargument: „po odrzuceniu ten sam agent znowu jest w top 3”. Rozstrzygnięcie: agent, który odrzucił, wypada z rankingu tej oferty, a jego miejsce zajmuje kolejny.

## Non-Functional Requirements

- Każdy widok jest używalny na ekranie o szerokości 360 px bez poziomego przewijania i poprawnie wyświetla polskie znaki.
- Po usunięciu konta w produkcie nie zostają żadne dane tego konta.
- Produkt działa w dwóch najnowszych głównych wersjach Chrome, Firefoksa, Safari i Edge.

## Business Logic

System liczy dla każdego agenta wynik 0–100 dopasowania do oferty (miasto jest warunkiem koniecznym, a punkty dają typ nieruchomości, przedział cen i doświadczenie) i pokazuje właścicielowi do trzech agentów z najwyższym wynikiem większym od 0.

Dane wejściowe to miasto, typ i cena z oferty właściciela oraz z profilu agenta: obsługiwane miasta, typy nieruchomości, przedział cen i lata doświadczenia. Agent, który nie obsługuje miasta oferty, dostaje 0. W pozostałych przypadkach punkty się sumują. Typ nieruchomości daje 35 pkt, jeśli agent go obsługuje. Cena daje 35 pkt, jeśli mieści się w przedziale agenta, a 0 poza nim. Doświadczenie daje do 30 pkt, liniowo do 10 lat (10 lat i więcej to pełne 30).

Ranking jest malejący według wyniku. Przy remisie wygrywa agent z większą liczbą lat doświadczenia, a potem ten, który zarejestrował się wcześniej. Agent, który odrzucił zaproszenie do danej oferty, nie występuje już w jej rankingu. Agent z niepełnym profilem nie trafia do rankingu. Właściciel widzi ranking po zapisaniu oferty i wybiera z niego agenta do zaproszenia.

## Access Control

Logowanie e-mailem i hasłem. Rolę (właściciel albo agent) użytkownik wybiera przy rejestracji, na stałe: jedno konto ma jedną rolę.

| Rola | Może |
|---|---|
| Niezalogowany | landing, rejestracja, logowanie; każda inna trasa przekierowuje do logowania |
| Właściciel | CRUD **swoich** ofert; ranking top 3 agentów dla swojej oferty; zaproszenie agenta |
| Agent | swój profil; oferty, do których został zaproszony; swoje zaproszenia (przyjęcie lub odrzucenie) |

Właściciel nie widzi cudzych ofert. Agent widzi ofertę dopiero wtedy, gdy został do niej zaproszony.

## Non-Goals

### Functional
- Czat między właścicielem a agentem: nie w MVP.
- Zdjęcia ofert: nie w MVP.
- Mapa: nie w MVP.
- Wycena nieruchomości przez AI: nie w MVP.
- Płatności: nie w MVP.
- Powiadomienia: nie w MVP.
- Weryfikacja agentów (licencja, doświadczenie): dane z profilu są przyjmowane tak, jak je podał agent.
- Firmy i zespoły agentów: jeden agent to jedno konto.
- Eksport ofert na portale: nie w MVP.
- Limit czasu na odpowiedź agenta na zaproszenie: zaproszenie czeka bez limitu (zob. Socrates do FR-009).

### Non-functional
- Aplikacja mobilna: nie w MVP; produkt jest aplikacją webową.

## Open Questions

Brak otwartych pytań. Shape zakończył się kontrolą jakości `accepted`, a oba pytania otwarte w trakcie (limit czasu na zaproszenie, `target_scale.qps` / `data_volume`) rozstrzygnięto przed przekazaniem.
