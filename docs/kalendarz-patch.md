> **Status: wprowadzone** w `lewym90/kalendarz` (commit 12f409f). Poniżej opis zmiany.

# Poprawka w aplikacji Kalendarz (1 linia)

Poczta otwiera Kalendarz linkiem `?new=event&text=Wizyta kardiolog 28.10.2026 17:30`.
Kalendarz już umie sparsować takie zdanie (okno „Dodaj zdaniem"), brakuje tylko przekazania `text` z adresu.

W repozytorium `lewym90/kalendarz`, plik `js/app.js`, funkcja `handleLaunchParams()`:

```diff
-  if (q.get('new')) { setTimeout(() => openQuickAdd({ mode: q.get('new') === 'task' ? 'task' : 'event' }), 250); }
+  if (q.get('new')) { setTimeout(() => openQuickAdd({ mode: q.get('new') === 'task' ? 'task' : 'event', text: (q.get('text') || '').slice(0, 300) }), 250); }
```

Zmiana jest bezpieczna: bez parametru `text` zachowanie jest takie samo jak dziś. Nic nie trafia do kalendarza bez Twojego dotknięcia „Dodaj".
Do czasu wprowadzenia poprawki działa przycisk „Plik .ics" w Poczcie (iPhone otwiera go w natywnym kalendarzu).
