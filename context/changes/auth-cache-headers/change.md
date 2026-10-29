---
change_id: auth-cache-headers
title: Nagłówki no-store na odpowiedziach ustawiających ciasteczka sesji
status: impl_reviewed
created: 2026-10-29
updated: 2026-10-29
---

## Notes

— Błąd znaleziony w M4 (`context/domain/03-anti-corruption-layer.md` §3.2): `src/lib/supabase.ts` ignoruje drugi argument `setAll` z `@supabase/ssr`, czyli nagłówki `Cache-Control`/`Expires`/`Pragma`, które muszą trafić na odpowiedź ustawiającą ciasteczka sesji. Aplikacja stoi za Cloudflare. Zmiana służy też jako PR testowy dla workflow `impl-review` (M5, 10xChampion).
