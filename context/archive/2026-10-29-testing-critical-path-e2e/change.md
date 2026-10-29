---
change_id: testing-critical-path-e2e
title: Test E2E ścieżki krytycznej w przeglądarce (rollout Phase 2)
status: archived
created: 2026-10-29
updated: 2026-10-29
archived_at: 2026-10-29T15:01:46Z
---

## Notes

Open a change folder for rollout Phase 2 of context/foundation/test-plan.md: "Ścieżka krytyczna w przeglądarce".
Risks covered: #1 (zły top 3 / kolejność), #2 (IDOR / izolacja danych), #3 (cykl statusów oferty). Test types planned: e2e (Playwright, Chromium), CI.
Risk response intent:

- #1: właściciel w przeglądarce widzi w top 3 dokładnie oczekiwanych agentów w kolejności wynikającej z reguły PRD (wyrocznia z PRD, nie z kodu), a agent z wynikiem 0 się nie pojawia.
- #2: agent widzi tylko ofertę, do której go zaproszono; drugi użytkownik nie dosięga cudzej oferty przez UI.
- #3: po zaproszeniu i przyjęciu status oferty w UI i w bazie zgadza się z PRD (tylko jeden przyjęty agent, brak edycji po zaproszeniu) — nie tylko odpowiedź 200.
  After creating the folder, follow the downstream continuation rule.
