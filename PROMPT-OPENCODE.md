# PROMPT-OPENCODE.md — prompt startowy dla agenta pracującego w tym repo

Plik istnieje po to, żeby prompt nie ginął w historii czatu. Treść poniżej
wkleja się w całości do OpenCode (albo dowolnego innego agenta) jako pierwsza
wiadomość.

---

```
Pracujesz w repo G:\Projects\multibot (Windows, PowerShell). Prywatny fork
OpenMausBot z silnikiem Pythona wstawionym jako engine/. Gałąź main.

== CO TO JEST ==
MultiBot ma być produktem sprzedawanym firmom: stoi na serwerze firmy, ma
własny komputer, którym klika, uczy się jak działa ta firma i pamięta wszystko.
Produkcja stoi dziś na telefonie Kacpra (Termux, 100.78.241.9:8799).

== PRZECZYTAJ, ZANIM NAPISZESZ PIERWSZĄ LINIĘ KODU ==
1. CLAUDE.md — pułapki tego repo. Każda kosztowała już cały dzień.
2. PLAN-00-INDEX.md — spis wszystkiego do zrobienia, pozycje ponumerowane,
   plus lista decyzji, których NIE otwiera się ponownie.
3. Plan obszaru, nad którym akurat pracujesz.

Czytasz CAŁE te pliki, nie pierwsze akapity. Plan zawiera odwołania plik:linia
sprawdzone wobec kodu — używaj ich zamiast szukać od zera.

== KOLEJNOŚĆ PRACY ==
Idziesz po kolei i nie przeskakujesz:

  1. PLAN-COMPUTER-USE.md, fazy K1..K10
  2. PLAN-UI.md, grupa A (narzędzia CLI)
  3. PLAN-UI.md, grupa B (szybkość i wskaźniki ładowania)
  4. PLAN-UI.md, grupa C (ustawienia)
  5. PLAN-UI.md, grupa D (grupy botów)
  6. PLAN-UI.md, grupa E (onboarding)
  7. PLAN-PAMIEC.md, fazy P3, P4, P1, P2, P5, P6, P9
  8. PLAN-STOS.md, pozycja S3 (model lokalny na serwerze firmy)
  9. PLAN-UI.md, grupa F (wygląd i polski) — NA KOŃCU, bo tłumaczenie
     napisów, które wcześniej znikną, to praca do kosza

Każda faza ma w planie napisany gate. Gate niezamknięty = nie ruszasz dalej.
Gate zamknięty = commit i NATYCHMIAST następna faza, bez pytania o zgodę.

== POZA TWOIM ZAKRESEM ==
- clients/mobile/ i repo clewkord/multibot2 — robi to kolega Kacpra.
- PLAN-BIZNES.md — to nie jest kod.
- PLAN-MOBILE-KOLEGA.md — dokument dla kolegi, tylko do czytania.

== SIEDEM RZECZY, KTÓRE CIĘ WYWRÓCĄ ==
1. Silnik Pythona jest procesem ODŁĄCZONYM. `sv restart multibot` go NIE
   przeładowuje. Zmieniłeś coś w engine/ — najpierw zabij uvicorna, potem
   restartuj usługę. Pominięcie tego daje fałszywe "naprawione".
2. Prompt systemowy ma DWIE ścieżki: server/index.ts:552-586 dla
   codex/claude/acp ORAZ engine/server/bots.py (ensure_multibot_identity,
   _COMPUTER_IDENTITY) dla silnika. Zmiana w jednej = połowa botów jej nie widzi.
3. W drzewie roboczym bywają cudze niezacommitowane zmiany. Commitujesz
   wyłącznie własne pliki, wymienione po nazwie. NIGDY `git add -A`.
4. Pliki upstreamu zmieniasz małymi, dodającymi blokami z komentarzem
   `// multibot:`. server/contracts.ts — zero zmian. Bez reformatów.
5. Zero nowych zależności npm. Jeżeli uważasz, że któraś jest konieczna —
   zatrzymaj się i zapytaj, zamiast ją dodać.
6. Zielona tura sama z siebie niczego nie dowodzi. Przy komputerze bota
   i serwerach MCP to wyścig — bez sprawdzenia logu wynik jest przypadkiem.
7. Kod, komentarze i commity po polsku, pełnymi zdaniami, z POWODEM zmiany,
   nie z opisem tego, co widać w diffie.

== JAK PRACUJESZ NAD JEDNĄ FAZĄ ==
Zawsze w tej kolejności, bez skracania:

  1. PRZECZYTAJ kod, którego zmiana dotyczy. Cały przepływ, od miejsca gdzie
     dane wchodzą, do miejsca gdzie wychodzą. Nie sam plik z planu.
  2. NAPISZ w jednym zdaniu, co jest prawdziwą przyczyną. Objaw to nie
     przyczyna. Jeżeli nie umiesz napisać tego zdania — czytaj dalej.
  3. ZMIEŃ najmniejszą rzecz, która to naprawia. Jedna zmiana na raz.
     Bez abstrakcji, których nikt nie zamawiał. Bez rusztowania "na później".
  4. URUCHOM sprawdzenie i WKLEJ jego wyjście.
  5. COMMIT, tylko własne pliki, po polsku, z powodem.

== SPRAWDZENIE ==
  pnpm build:server
  npx vitest run server/
  cd engine; .\.venv\Scripts\python -m pytest     # 291+ testów

Czerwone testy zgłaszasz razem z wyjściem. Testu nie "poprawiasz", żeby
przeszedł — chyba że sam test jest błędny, i wtedy piszesz dlaczego.
Zmiana zachowania zostawia jeden sprawdzalny check: mały test albo assert.
Bez frameworków i fikstur.

== JAK RAPORTUJESZ ==
Po każdej fazie dokładnie cztery linie, nic więcej:

  PLAN: co robię i dlaczego
  ZMIANA: pliki, których dotknąłem
  DOWÓD: wyjście komendy, która to potwierdza
  STAN: gate zamknięty czy nie, następna faza

Nie opisujesz, co zamierzasz zrobić za trzy fazy. Nie streszczasz planu, który
mam przed sobą. Nie chwalisz swojej zmiany.

== KIEDY SIĘ ZATRZYMUJESZ ==
Jedziesz bez przerwy. Zatrzymujesz się tylko w czterech przypadkach:
  - plan jest sprzeczny z kodem, który widzisz
  - trzeba by skasować cudze dane
  - w diffie jest sekret (sk-, ghp_, AKIA, BEGIN PRIVATE KEY, .env)
  - trzeba nowej zależności

Wtedy piszesz co, gdzie i dlaczego, i czekasz. W żadnym innym przypadku nie
pytasz o zgodę.

Zrobiłeś dwie rzeczy z trzech — piszesz wprost które i dlaczego trzeciej nie.
Nie zgłaszasz "gotowe", dopóki gate nie jest zamknięty wyjściem komendy.

Zaczynaj od PLAN-COMPUTER-USE.md faza K1.
```
