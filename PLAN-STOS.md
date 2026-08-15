# PLAN-STOS.md — cudzy kod: co bierzemy, czego nie

> Pozycje S1–S4 z `PLAN-00-INDEX.md`.
>
> Kacper podał długą listę repozytoriów z uwagą: *„jest tak dużo repozytoriów,
> które już mają dużą część zrobioną tego co chcę zrobić, więc najlepiej byłoby
> wziąć ich kod i przerobić pod nasze potrzeby"*. Zgoda co do zasady. Ten
> dokument mówi, które konkretnie i po co — bo lista jako całość jest zbiorem
> narzędzi Kacpra do pracy, a nie składników MultiBota, i wzięcie wszystkiego
> zamieniłoby produkt w sklep z częściami.

---

## Zasada doboru

Bierzemy tylko wtedy, gdy spełnione są trzy warunki naraz:

1. Rozwiązuje pozycję, która stoi w `PLAN-00-INDEX.md`.
2. Licencja pozwala sprzedawać (MIT, Apache 2.0, BSD). AGPL i SSPL odpadają
   — zmuszają do otwarcia naszego kodu, gdy produkt chodzi po sieci.
3. Wchodzi jako zależność albo skopiowany kawałek, a nie jako druga
   architektura obok naszej.

Warunek trzeci ucina najwięcej. MultiBot ma już harness (OpenMausBot), silnik
(hermes-agent) i komputer bota. Czwarty framework „pod spodem" to nie jest
przewaga, tylko trzy razy więcej rzeczy, które mogą się zepsuć, i nikt nie wie,
w której warstwie szukać.

---

## S3 — własny model na serwerze firmy (**najwyższy priorytet z tego pliku**)

Kacper oznaczył to jako jedną z ważniejszych rzeczy i słusznie. To jest **cały
argument sprzedażowy** rozmowy z firmą: dane nie wychodzą nigdzie, także do
dostawcy modelu.

Dobra wiadomość: to nie jest nowy kod. Silnik dostaje dostawcę modelu przez
adres bazowy i klucz (BYOK). Serwer z modelem lokalnym — Ollama, vLLM,
llama.cpp, LM Studio — wystawia to samo API co OpenAI. Czyli wystarczy wpisać
jego adres w miejsce, które już jest.

Do zrobienia jest w praktyce:

1. **Sprawdzić, czy to działa dziś**, wpisując adres lokalnego serwera jako
   `base_url`. Możliwe, że wystarczy to udokumentować.
2. **Gotowe wpisy w interfejsie**, żeby nikt nie musiał zgadywać portu:
   Ollama `http://localhost:11434/v1`, vLLM `http://localhost:8000/v1`,
   LM Studio `http://localhost:1234/v1`.
3. **Wykrycie, czego model nie umie.** Mniejsze modele lokalne słabo radzą sobie
   z wywoływaniem narzędzi, a bot bez narzędzi jest czatem. Sprawdzić przy
   podłączeniu i powiedzieć wprost, zamiast pozwolić botowi cicho głupieć.
4. **Test na czystej maszynie bez internetu**: model lokalny, czat, pamięć,
   skille, rutyny. To, co przejdzie, jest tym, co wolno obiecać firmie.

**Gate:** MultiBot rozmawia i używa narzędzi na modelu z Ollamy, przy
odłączonej sieci zewnętrznej.

---

## S2 — `prime-agent` pod spodem

Kacper chce tego, bo *„to się uczy jakoś i od razu można by było zrobić tak,
żeby wizualnie było widoczne, że się uczy"*.

Odpowiedź: **cel jest dobry, droga nie.** Widoczne uczenie to pozycje P5 i P6
z `PLAN-PAMIEC.md` i wychodzą z danych, które MultiBot już ma — z bazy faktów,
z `helpful_count`, z grafu fakt↔encja. Podłożenie drugiego frameworka pod
istniejący silnik nie doda ani jednej informacji, której nie ma.

Do zrobienia: **przeczytać ich pętlę uczenia** (licencja MIT, więc wolno
przepisać kawałek) i wziąć z niej pomysły do fazy P1. Nie wstawiać całości.

Jeżeli po przeczytaniu okaże się, że mają coś, czego Hermes nie ma — wtedy
wracamy do tej decyzji z konkretem na stole. Nie wcześniej.

---

## S4 — jak boty rozmawiają w grupie

Sprawdzić dokumentację Grok Bota i zrobić u nas tak samo. Robota jest opisana
w `PLAN-UI.md`, grupa D — tam siedzą pozycje U19, U20 i U21, które dotyczą tego
samego ekranu. Ten punkt to tylko przypomnienie, żeby przed pisaniem przeczytać
ich rozwiązanie zamiast wymyślać własne.

---

## S1 — przegląd listy Kacpra

### Bierzemy

| Projekt | Licencja | Po co |
|---|---|---|
| `NousResearch/hermes-agent` | MIT | już wewnątrz, jako `engine/` |
| `milind-soni/OpenMausBot` | MIT | już wewnątrz, jako harness |
| Ollama / vLLM / llama.cpp | otwarte | S3, model lokalny |

### Warte wzięcia, gdy dojdziemy do właściwej fazy

| Projekt | Po co u nas | Kiedy |
|---|---|---|
| `PrimeIntellect-ai/prime-agent` | pomysły do pętli uczenia, nie kod w całości | faza P1 |
| `strawberrybrowser.com` | wielu botów w jednej przeglądarce | K9 |
| `unclecode/crawl4ai` | bot ma sam czytać strony, zamiast zgadywać z wyszukiwarki | po K7 |
| `langfuse/langfuse` | podgląd, co bot robi i ile pali; przyda się przy sprzedaży opieki | po pierwszym kliencie |
| `headroomlabs-ai/headroom` | ścinanie kosztu tokenów bez zmian w kodzie | gdy rachunek zacznie boleć |
| `musistudio/claude-code-router` | jeden punkt na wszystkich dostawców, klucze i zapasowe modele | gdy dostawców będzie więcej niż pięciu |
| `plausible/analytics` | statystyki strony bez zgody na ciasteczka | razem z B2 |

### Nie bierzemy — i dlaczego

- **`mnemosyne-oss/mnemosyne`** — warstwa pamięci na SQLite. Dokładnie to samo
  co pamięć holograficzna Hermesa, którą już mamy w środku i która czeka
  włączona. Druga baza pamięci obok pierwszej to gwarantowany dzień szukania,
  w której z nich siedzi odpowiedź.
- **`ScrapeGraphAI`, `EasySpider`, `Scrapling`, `Dub`, `Listmonk`,
  `Chatterbox`, `Vane`, `Strix`, `code-review-graph`, `OmniRoute`,
  `d2-obsidian`, `Excalidraw`, `HeroUI`, skille Matta Pococka, `doctrine`,
  `scroll-world`, `motion-dev-animations-skill`, `ADHD`** — to są narzędzia do
  pracy Kacpra albo składniki innych jego projektów. Nie mają miejsca
  w produkcie sprzedawanym firmie. Część z nich (`HeroUI`,
  `motion-dev-animations-skill`, `Plausible`) może się przydać przy stronie
  z `PLAN-BIZNES.md` — ale to strona, nie MultiBot.

To nie jest ocena tych projektów. To pilnowanie, żeby produkt dało się
zainstalować u kogoś i naprawić, gdy zadzwoni o dwudziestej drugiej.

---

## Praca do zrobienia w tym pliku

Przed fazą P1 i przed K9 przeczytać `prime-agent` i `strawberrybrowser` i
**dopisać tutaj wnioski** — co konkretnie mają, czego my nie mamy. Dziś w tym
dokumencie jest decyzja podjęta z opisu, nie z przeczytanego kodu, i tak jest
oznaczona.
