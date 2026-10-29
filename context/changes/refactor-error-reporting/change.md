---
change_id: refactor-error-reporting
title: Wspólna obsługa i raportowanie błędów (refaktor M4)
status: planned
created: 2026-10-29
updated: 2026-10-29
archived_at: null
---

## Notes

— Refaktor M4: wspólna obsługa i raportowanie błędów (reportError zamiast 10 kopii fail(), bind catch, middleware odróżnia awarię od braku sesji, D1 usunięcie konta not_found ≠ sukces, strony w stanie błędu → 503). Źródła: context/map/repo-map.md (strefy ryzyka access, auth) i context/audits/observability/2026-10-29_auth-offer-ranking-invitation-account-deletion.md. Decyzja użytkownika 2026-10-29: opcja A spośród A (obsługa błędów) / B (kontrakt rankingu SQL) / C (wydzielenie modułów).
