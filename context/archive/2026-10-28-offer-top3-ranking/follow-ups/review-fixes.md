# Review follow-ups: offer-top3-ranking

Źródło: `reviews/impl-review.md` (2026-10-28).

- [ ] **F3 → M3 test-plan**: ryzyko enumeracji agentów przez `rank_agents_for_offer` (wiele ofert w różnych miastach/typach/cenach → UUID, staż, miasta pełnych profili). Rozważyć limit ofert na właściciela i test, że RPC nie zwraca nic poza `agent_id, score, experience_years, cities`.
- [ ] **F4 → M3 observability**: `console.error` z `error.code` w gałęziach błędu `src/pages/owner/offers/[id].astro:28-49`, `src/pages/owner/index.astro:22-27`, `src/pages/api/owner/offers.ts:58-60` (wzorzec dla całego repo); stan `error` na stronie oferty → HTTP 503 zamiast 200.
- [ ] **F6 → /10x-archive**: po archiwizacji S-03 w `context/foundation/roadmap.md` (:50, :125) ma status `done`; jeśli skill tego nie zrobi, poprawić ręcznie w commicie archiwizacji.
