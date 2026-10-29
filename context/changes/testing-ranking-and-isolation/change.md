---
change_id: testing-ranking-and-isolation
title: Testy rankingu top 3 i izolacji danych (etap 1 planu testów)
status: implementing
created: 2026-10-29
updated: 2026-10-29
archived_at: null
---

## Notes

Open a change folder for rollout Phase 1 of context/foundation/test-plan.md: "Ranking i izolacja danych".
Risks covered: #1 (zły top 3: miasto, 35/35/30, remis staż → data rejestracji, odrzucony agent, niepełny profil), #2 (IDOR: B dosięga ofert/danych A przez REST, RPC albo /api/*), #6 (testy zielone mimo regresji). Test types planned: integration na lokalnym Supabase z dwoma prawdziwymi sesjami, break-check, podpięcie w CI.
Risk response intent:
- #1: właściciel dostaje dokładnie kolejność i wyniki z tabeli przypadków spisanej z PRD (granice ceny, staż 0/5/10/15, faktyczny remis), agent z wynikiem 0 nie pojawia się; wyrocznia z PRD, nie z kodu funkcji.
- #2: użytkownik B z prawdziwą sesją dostaje odmowę albo pustkę na każdej ścieżce do zasobów A, a A widzi swoje dane (kontrola pozytywna); nigdy przez service_role.
- #6: celowo zepsuta reguła (odwrócony remis, wyłączona polityka RLS) zapala nowe testy na czerwono.
Minimalny zakres pod certyfikację (termin 2026-11-04): jeden runner, kilka testów, bez rozbudowy.
