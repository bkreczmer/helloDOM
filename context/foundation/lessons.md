# Lessons Learned

> Append-only register of recurring rules and patterns. Re-read at start by /10x-frame, /10x-research, /10x-plan, /10x-plan-review, /10x-implement, /10x-impl-review.

## Sprawdzaj kontrast tokenów kolorów przy ich definiowaniu

- **Context**: Każda zmiana, która definiuje lub edytuje tokeny kolorów (design-system.md, src/styles/global.css) albo dodaje nowy kolor tekstu/ikony w komponencie.
- **Problem**: Paleta przeniesiona 1:1 ze specyfikacji miała fg-2/fg-3/fg-4 na poziomie 1.6–3.9:1 i biały tekst na przycisku accent 2.98:1. Wyszło to dopiero w impl-review app-shell (F1), po zaimplementowaniu 4 faz i odhaczeniu kroków ręcznych.
- **Rule**: Każdy token tekstu musi mieć kontrast ≥4.5:1, a ikony i obramowania elementów interaktywnych ≥3:1 względem tła, na którym leżą — w obu motywach. Kontrast sprawdzaj przy definiowaniu lub zmianie tokenu (narzędzie do kontrastu albo DevTools), a nie po implementacji.
- **Applies to**: context/foundation/design-system.md, src/styles/global.css, src/components/**

## Odhaczaj krok ręczny dopiero po zobaczeniu stanu w przeglądarce

- **Context**: Weryfikacja ręczna faz w /10x-implement — każdy krok z listy „manual verification”, szczególnie stany UI (pending, hover, disabled, error, empty, loading
- **Problem**: W app-shell odhaczyłem krok 2.7 (hover i disabled przy wysyłaniu), choć w kodzie oba stany były nieosiągalne: useFormStatus nie działa przy natywnym  POST, a pola nie miały klasy hover. Wyszło to dopiero w impl-review (F3, F5).
- **Rule**: Krok ręczny odhaczaj dopiero wtedy, gdy wywołałeś opisany stan w przeglądarce i go zobaczyłeś. Jeśli stanu nie da się wywołać (np. zbyt szybka odpowiedź), sprawdź go wymuszeniem (DevTools: throttling, :hover/:focus) albo zgłoś krok jako niezweryfikowany.
- **Applies to**: 10x-implement, 10x-impl-review, src/components/**
