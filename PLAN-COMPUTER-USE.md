# PLAN-COMPUTER-USE.md — komputer bota ma wyglądać i działać jak trzeba

> Pozycje K1–K10 z `PLAN-00-INDEX.md`. Odwołania `plik:linia` sprawdzone wobec
> stanu repo z 15 sierpnia 2026.
>
> To najważniejszy plan z całej paczki. Computer use jest jedyną rzeczą, której
> konkurencja nie ma, a dziś na pierwszy rzut oka wygląda na zepsuty. Bez tego
> nie ma czego pokazać firmie.

---

## 0. Prompt do wklejenia

```
/goal Wykonaj PLAN-COMPUTER-USE.md w repo G:\Projects\multibot, fazy K1..K10 po
kolei, każda z gate'em. Przeczytaj CAŁY PLAN-COMPUTER-USE.md i CAŁY CLAUDE.md
przed pierwszą linią kodu. Silnik Pythona jest spawnowany jako proces odłączony
— po zmianie w engine/ ZABIJ uvicorna, zanim zrestartujesz usługę, inaczej
testujesz stary kod. Weryfikacja tylko na żywo, na realnym komputerze bota;
zielona tura bez obejrzenia ekranu nie liczy się jako dowód. Backend Opus 5,
frontend Fable 5. Subagenty nie commitują.
```

---

## 1. Stan faktyczny na dziś

Co już istnieje i działa:

- Kursor agenta rysowany **wewnątrz strony** przez wstrzyknięcie JavaScriptu
  po CDP: `engine/server/computer.py:293` (`_CURSOR_JS`), wywołanie
  `_show_cursor()` w `:336` i `:666`. Kolor bierze się z harnessu
  (`cursor_color`, `app.py:143`), domyślnie biały (`_CURSOR_DEFAULT`).
- Przejęcie i oddanie sterowania: `src/components/ComputerPanel.tsx:172`
  (`Hand back` / `Take control`), lease pilnowany po stronie serwera.
- Pełny ekran: `ComputerPanel.tsx:78` (`fullscreen`), warstwa w `:267`.
- Pulpit celowo ogołocony: `scripts/computer-desktop.sh` ustawia czarną tapetę,
  bez ikon.
- Nagrywanie skilla: `src/components/SkillsPanel.tsx:220`.

Czyli większość mechaniki jest. Problemy są w tym, **gdzie** te rzeczy siedzą
i **czego nie widać**.

---

## K1 — computer use ma realnie działać

Warunek wstępny dla wszystkiego poniżej. Dziś znany jest jeden twardy błąd:

> `screenshot` na telefonie nie wraca. Tura wisiała ponad 25 minut z
> `busy=True` po wywołaniu narzędzia. Samo narzędzie startuje.
> Podejrzenie: zrzut 1920x1080 przez CDP na s10e albo zakleszczenie w
> `engine/server/computer.py`. Niezdiagnozowane.

Zaczynać od tego, bo bot, który nie widzi ekranu, nie zrobi nic innego z tej
listy.

Sposób: zawęzić przez podstawienie. Zrzut o mniejszej rozdzielczości; zrzut
z pominięciem CDP; ta sama komenda odpalona ręcznie w prooct z pomiarem czasu.
Jedna zmiana na próbę.

**Gate:** bot na telefonie robi zrzut ekranu i tura kończy się w mniej niż
piętnaście sekund. Wyjście komendy w commicie.

---

## K2 — kursor bota widoczny w ruchu

Dziś kursor pojawia się w miejscu zdarzenia i znika. Nie widać przejazdu
z punktu do punktu, więc z boku wygląda to, jakby nic się nie działo, a strona
sama się zmieniała.

Ma być widać: przesunięcie z pozycji poprzedniej do nowej, kliknięcie (krótki
rozbłysk pierścienia — pierścień już jest, `computer.py:327`), przewijanie.

Najprostsza droga, bez nowej biblioteki: `_CURSOR_JS` pamięta ostatnią pozycję
i zamiast ustawiać nową skokowo, animuje przejście przejściem CSS
(`transition: transform 180ms ease-out`). Przeglądarka policzy klatki sama,
Python nie musi wysyłać kroków pośrednich.

> `ponytail:` to daje ruch tylko w obrębie jednej strony. Ruch po pulpicie
> (poza oknem przeglądarki) wymaga rysowania kursora po stronie serwera VNC —
> robić dopiero, jeśli demonstracja tego wymaga.

**Gate:** nagranie z ekranu, na którym widać płynny przejazd i błysk przy
kliknięciu.

---

## K3 — mysz użytkownika znika po „hand back"

Po oddaniu sterowania użytkownik nie ma już wpływu na komputer bota, ale jego
kursor dalej jest rysowany na obrazie. Myli, bo wygląda jakby sterowanie
zostało.

Kursor użytkownika ma zniknąć w tej samej chwili, w której `owner` przechodzi
z `"user"` na `"agent"` — nie po następnej klatce, nie po odświeżeniu.

**Gate:** kliknięcie `Hand back`, kursor użytkownika znika natychmiast, kursor
agenta pojawia się przy pierwszym ruchu bota.

---

## K4 — niebieski panel przy starcie pulpitu

Do zidentyfikowania przed poprawką, bo są dwaj kandydaci:

1. Panel XFCE (pasek zadań) — domyślnie niebieskawy. `computer-desktop.sh`
   czyści tapetę i ikony, ale panelu nie tyka.
2. Nakładka „Connecting…" po stronie interfejsu.

Sprawdzić zrzutem ekranu w chwili, gdy się pokazuje, i usunąć to konkretne.
Nie zgadywać — usunięcie niewłaściwej rzeczy zabierze pasek zadań, który
w nagraniu wygląda dobrze (widać go na `inspiracje.png`).

**Gate:** start pulpitu od zera, żadnego niebieskiego prostokąta na żadnej
klatce.

---

## K5 — „Record a skill" w środku pulpitu

Dziś przycisk stoi w `SkillsPanel.tsx:220`, czyli zanim użytkownik w ogóle
zobaczy komputer. Kolejność jest odwrotna do tego, co człowiek robi: najpierw
otwiera pulpit, potem stwierdza „to chcę mu pokazać".

Ma być: przycisk w panelu komputera, dostępny po wejściu w pulpit. Wzór
z `inspiracje.png` — półprzezroczysta pigułka `Learn from demonstration` na
warstwie nad ekranem, a po starcie nagrywania pasek u góry z czerwoną kropką,
licznikiem czasu i krzyżykiem.

Ten pasek jest już opisany w `engine/docs/UI-SPEC.md:66` i `:133` — użyć tego
opisu zamiast wymyślać drugi raz.

**Gate:** wejście w pulpit, kliknięcie pigułki, nagranie, wyjście — powstaje
skill. Ze `SkillsPanel` da się go odpalić.

---

## K6 — pełny ekran ma być dużym panelem, nie całym ekranem

Dziś `fullscreen` zajmuje wszystko i interfejs MultiBota znika. Kacper chce
czegoś pośredniego: **duży panel na środku, zaokrąglone rogi, MultiBot dalej
widoczny pod spodem**.

Konkretnie: warstwa `ComputerPanel.tsx:267` dostaje margines (rzędu 4–6% na
każdą stronę), promień rogów jak w kartach, cień i lekko przyciemnione tło
za sobą — na tyle, żeby oko szło na panel, ale nie na tyle, żeby nie było
widać, co jest pod spodem. Bez animacji wjazdu na start; można dołożyć
później.

**Gate:** zrzut ekranu, na którym widać jednocześnie duży komputer bota
i pasek boczny MultiBota.

---

## K7 — agent, który nie odpuszcza

Cel: bot zachowuje się jak `/goal` — dostaje cel, kombinuje do skutku,
zatrzymuje się dopiero wtedy, gdy naprawdę potrzebuje człowieka. Gdy web
search nie wystarcza, **sam** przechodzi na komputer.

To jest zmiana promptu i pętli, nie nowego narzędzia. Uwaga, bo prompt ma
w tym repo **dwie ścieżki i obie trzeba ruszyć**:

- codex / claude / acp: `server/index.ts:552-586` (pole `system` w `sendTurn`)
- slafy (silnik): `engine/server/bots.py`, `ensure_multibot_identity()` plus
  stała `_COMPUTER_IDENTITY`

Zmiana tylko w jednej ścieżce = połowa botów jej nie zobaczy. Ten błąd już raz
zabrał dzień.

W promptcie ma być wprost: jakie narzędzia bot ma, że ma komputer, że wolno mu
z niego skorzystać bez pytania i że przerwanie zadania z powodu „nie da się"
jest dopuszczalne dopiero po wyczerpaniu innych dróg.

Do tego twardy limit: licznik prób i wyraźny warunek zatrzymania. Bot, który
nie odpuszcza NIGDY, pali tokeny w nieskończoność.

> `ponytail:` limit na sztywno (np. 25 kroków narzędziowych na cel). Robić
> z tego ustawienie dopiero, gdy okaże się, że jedna liczba nie pasuje do
> różnych zadań.

**Gate:** bot dostaje zadanie, którego nie da się zrobić przez web search,
sam otwiera komputer i doprowadza je do końca. Transkrypt w commicie.

---

## K8 — podagenci

Bot ma umieć założyć własnego podagenta: chwilowego (do jednego zadania,
ginie po nim) albo stałego (zostaje na liście botów jak każdy inny).

Podstawa istnieje: harness ma `capabilities.agentsMcp` i warstwę komunikacji
między botami (`server/index.ts` w okolicach gate'u zdolności). Do zrobienia:
narzędzie, którym bot zakłada bota, i limit głębokości, żeby agent nie
rozmnożył się w pętli.

**Gate:** bot zakłada podagenta, deleguje mu zadanie, dostaje wynik. Podagent
chwilowy znika, stały zostaje w pasku bocznym.

---

## K9 — wielu botów na jednym komputerze

Wzór podany przez Kacpra: `strawberrybrowser.com` — kilka botów pracujących
razem w przeglądarce, po jednym albo po dwa naraz.

W repo jest już fundament z rundy H: **jeden komputer na instalację, wspólny
dla wszystkich botów**, z globalnym lease na wejście (jeden właściciel myszy
i klawiatury naraz). To znaczy, że współpraca jest możliwa bez przebudowy —
brakuje kolejki i widoku, kto teraz trzyma sterowanie.

Zacząć od najprostszego: kolejka na lease plus podpis „teraz działa: <bot>"
nad ekranem. Równoległa praca dwóch botów w dwóch kartach to osobna, znacznie
większa robota — nie mieszać.

**Gate:** dwa boty na zmianę wykonują kroki jednego zadania, widać kto
aktualnie prowadzi.

---

## K10 — panel komputera w grupie

Dziś panel po prawej stronie jest w rozmowie z jednym botem. W grupie ma być
też. Powiązane z U19–U21 z `PLAN-UI.md`, bo dotyczy tego samego ekranu.

**Gate:** rozmowa grupowa, po prawej działający komputer, przejęcie i oddanie
sterowania działa tak samo jak w rozmowie prywatnej.
