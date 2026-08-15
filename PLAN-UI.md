# PLAN-UI.md — błędy interfejsu, narzędzia CLI, onboarding, polski

> Pozycje U1–U27 z `PLAN-00-INDEX.md`. Odwołania `plik:linia` sprawdzone wobec
> stanu repo z 15 sierpnia 2026.
>
> To lista rzeczy, które widać w pierwszych trzydziestu sekundach demonstracji.
> Żadna z nich nie jest trudna. Razem decydują o tym, czy program wygląda na
> gotowy, czy na niedokończony.

---

## 0. Prompt do wklejenia

```
/goal Wykonaj PLAN-UI.md w repo G:\Projects\multibot, grupy A..F po kolei.
Przeczytaj CAŁY PLAN-UI.md i CAŁY CLAUDE.md przed pierwszą linią kodu.
Pliki upstreamu zmieniasz małymi, dodającymi blokami oznaczonymi // multibot:.
Bez nowych zależności npm. Po każdej grupie: npx vitest run server/ oraz
pnpm build:server. Frontend Fable 5, backend Opus 5.
```

---

## Grupa A — narzędzia CLI (U5–U14)

**Po co to w ogóle jest — bo z nazwy nie wynika.** Ta zakładka pozwala używać
w MultiBocie modeli, za które użytkownik **już płaci abonamentem** (Claude,
Gemini, Grok, Qwen, Kimi), bez płacenia drugi raz za API. Robi to, instalując
na urządzeniu firmowy program CLI dostawcy i logując się do niego. MultiBot
potem woła ten program zamiast API. To jest jedna z mocniejszych rzeczy
w produkcie i dziś użytkownik nie ma szans się domyślić, że tak działa.

Nazwa i opis mają to mówić wprost. Propozycja:

> **Programy dostawców na tym urządzeniu**
> Zainstaluj i zaloguj program dostawcy, żeby korzystać z modeli w ramach
> abonamentu, który już masz — bez płacenia za API.

### U5 — komunikat o braku narzędzi

`src/components/AppSettingsPanel.tsx:697` pokazuje
`No command-line tools detected.` od razu, zanim cokolwiek zostało sprawdzone.
Wygląda to jak wynik, a jest stanem początkowym.

Ma być: dopóki trwa sprawdzanie — wskaźnik ładowania. Po sprawdzeniu, jeśli
naprawdę nic nie ma — ten komunikat, na czerwono.

### U7 — „Sign in" mimo zalogowania (Claude)

Użytkownik jest zalogowany do Claude, modele działają, a przycisk dalej
zachęca do logowania. Stan logowania jest odczytywany źle albo w ogóle.

Sprawdzić, skąd panel bierze ten stan, i porównać z tym, co realnie decyduje
o działaniu modelu. Jeżeli decyduje obecność pliku z danymi logowania — czytać
ten plik.

### U8 — Gemini pokazuje logowanie zamiast instalacji

Brak zainstalowanego CLI **i** brak logowania, a widać tylko „Sign in", bez
„Install". Kolejność jest odwrotna niż w rzeczywistości: bez programu nie ma
się do czego logować.

Trzy stany, jeden na raz: **brak programu** (przycisk Zainstaluj), **jest
program, brak logowania** (przycisk Zaloguj), **gotowe** (znacznik, bez
przycisku).

### U9 — odklikany kwadracik nie klika się z powrotem

Wyłączenie dostawcy (np. Grok) jest nieodwracalne z poziomu interfejsu.
Prawdopodobnie wyłączony wpis znika z listy albo jego pole staje się martwe.
Wyłączony dostawca ma zostawać na liście, wyszarzony, z działającym
przełącznikiem.

### U10 — ikony dostawców

Te same, które są w wyborze modelu u góry. Pliki są u Kacpra:
`C:\Users\kacpe\Desktop\loga\gemini.png`, `kimi.png`, `qwen.png`. Nie rysować
nowych.

### U11, U12, U13 — trzy realne błędy instalacji i logowania

Wszystkie trzy przechodzą dziś do użytkownika surowym wyjściem programu.
Wyjście ma zostać w „szczegółach technicznych", a nad nim ma być jedno zdanie
po polsku mówiące, co zrobić.

**U11 — Kimi:**
```
$ uv tool install --python 3.13 kimi-cli
error: No interpreter found for Python 3.13 in managed installations or search path
```
`uv` nie ma Pythona 3.13 i nie umie go sam pobrać w tej wersji. Naprawa:
`uv python install 3.13` przed instalacją narzędzia, a jeśli to nie przejdzie
— `uv self update`. Zrobić to krokiem instalatora, nie instrukcją dla
użytkownika.

**U12 — Qwen:**
```
$ qwen
No auth type is selected. Please configure an auth type (e.g. via settings or `--auth-type`) before running in non-interactive mode.
```
Logowanie odpalane bez wyboru sposobu logowania. Podać `--auth-type` z tym
sposobem, który wybraliśmy w interfejsie.

**U13 — Gemini:**
```
$ gemini
When using Gemini API, you must specify the GEMINI_API_KEY environment variable.
```
Program wpadł w tryb klucza API zamiast w logowanie kontem. To jest dokładnie
ten tryb, którego chcemy uniknąć (U14 — chodzi o abonament, nie o API).
Wymusić logowanie kontem, a nie kluczem.

**Gate grupy A:** na czystym urządzeniu każdy z pięciu dostawców przechodzi
drogę brak programu → instalacja → logowanie → działający model, bez
oglądania surowego błędu.

---

## Grupa B — szybkość i wskaźniki ładowania (U2, U3, U4)

**U2 — pierwsza wiadomość do nowego bota idzie bardzo długo.** Prawdopodobna
przyczyna jest udokumentowana w `CLAUDE.md` §5: codex startuje serwery MCP
równolegle z turą, a serwer komputera to Python i na telefonie wstaje około
czterech sekund. Do tego dochodzi pierwsze uruchomienie profilu silnika.
Zmierzyć, gdzie idzie czas, ZANIM cokolwiek się zmieni — bez pomiaru poprawka
jest zgadywaniem.

**U3 — „New bot" tworzy się długo i pokazuje czarny ekran.** Czarny ekran bez
niczego to najgorszy możliwy stan, bo nie odróżnia się od zawieszenia. Rozmowa
ma się pojawić natychmiast, z widocznym stanem „przygotowuję bota", a tworzenie
profilu ma iść w tle.

**U4 — wskaźniki ładowania wszędzie.** Każde miejsce, które dociąga dane,
pokazuje, że pracuje. Najbardziej widoczne: narzędzia CLI, lista modeli, lista
wtyczek.

**Gate grupy B:** żaden ekran w programie nie stoi dłużej niż pół sekundy bez
oznaki, że coś się dzieje. Czas do pierwszej odpowiedzi nowego bota zmierzony
przed i po, obie liczby w commicie.

---

## Grupa C — ustawienia (U1, U15, U16, U17, U18, U24, U25)

**U1 — usage count liczy źle.** Ustalić najpierw, co ma liczyć: tokeny, koszt
czy tury. Potem porównać z liczbą u dostawcy dla tej samej rozmowy. Naprawa bez
tego porównania jest niesprawdzalna. Kod w okolicach `src/lib/analytics.ts`
i `src/components/SettingsPanel.tsx`.

**U15 — „Local service".** `AppSettingsPanel.tsx:246`. Dopisać jedno zdanie,
czym ta usługa jest: *„Silnik MultiBota. Trzyma boty przy życiu, gdy program
jest zamknięty — rutyny i zaplanowane zadania działają dzięki niemu."*
Zielona kropka dostaje delikatne pulsowanie — sama animacja CSS
(`@keyframes` na przezroczystości, około dwóch sekund na cykl), zero
JavaScriptu.

**U16 — „Import existing profile" do usunięcia.** `AppSettingsPanel.tsx:154`
oraz `src/components/Onboarding.tsx:262`. Służyło do przeniesienia gotowego
profilu Hermesa i jest resztką po poprzednim etapie. Usunąć oba miejsca; kod
importera po stronie silnika (`engine/server/importer.py`) może zostać, ale
bez wejścia z interfejsu.

**U17 — zasoby maszyny.** Pamięć, procesor, dyski, temperatury urządzenia,
na którym stoi serwer. Wartości bierze się z systemu — na Linuksie i Termuksie
z `/proc`, bez nowej zależności. Odświeżanie co kilka sekund, nie co sekundę.
To jest też realna funkcja sprzedażowa: firma stawia to u siebie i chce
widzieć, czy maszyna wyrabia.

**U18 — profil w lewym dolnym rogu.** Dziś kliknięcie w profil i kliknięcie
w zębatkę otwiera to samo. Profil ma przestać być klikalny i przestać się
podświetlać przy najechaniu. Klikalna zostaje sama zębatka.

**U24 — zakładka „Models".** Sprawdzić testami, czy w ogóle działa: czy lista
się ładuje, czy wybór się zapisuje, czy zapisany model jest naprawdę używany
w następnej turze. Nikt tego nigdy nie sprawdził end-to-end.

**U25 — „Install app".** `AppSettingsPanel.tsx:382-388`. To jest instalacja
strony jako aplikacji (PWA) — Chrome i Edge pozwalają dodać stronę na pulpit
i uruchamiać ją w osobnym oknie, bez paska adresu. Sensowne dla kogoś, kto
łączy się do cudzego serwera i nie chce instalować niczego z Google Play.
Zostawić, ale opisać po ludzku i pokazywać TYLKO wtedy, gdy przeglądarka to
umie — dziś instrukcja wisi także tam, gdzie nic z niej nie wyniknie.

---

## Grupa D — grupy botów (U19, U20, U21) plus K10

**U19 — ikony w grupie.** Przy każdej wypowiedzi awatar bota, przy wypowiedzi
człowieka jego awatar. Dziś są same nazwy i po trzech linijkach nie wiadomo,
kto mówi. Wzór na `inspiracje.png`: okrągły kolorowy awatar, obok pogrubiona
nazwa, obok mała szara pigułka z rolą.

**U20 — poprzedni bot zostaje podświetlony.** Wejście w grupę nie gasi
podświetlenia bota, w którym się przedtem było. Wygląda, jakby otwarte były
dwie rozmowy naraz. Zaznaczenie ma być jedno.

**U21 — `[Group room]` nie ma trafiać do prywatnych rozmów.**
`server/index.ts:1089` i `:1284` wysyłają do bota wiadomość z grupy przez
`askBotAndWait(bot.id, "[Group room] " + message, 0)`. Bot ją dostaje **swoim
zwykłym kanałem**, więc ląduje w jego prywatnym transkrypcie i wygląda tam jak
rozmowa z użytkownikiem.

Rozmowa grupowa ma mieć własny wątek. Bot dostaje z niej treść jako kontekst,
ale jego prywatny transkrypt zostaje czysty.

**S4 z indeksu należy tu:** przed pisaniem sprawdzić w dokumentacji Grok Bota,
jak u nich boty rozmawiają w grupie między sobą i z człowiekiem, i zrobić tak
samo. To jest rzecz, którą oni mają dopracowaną, a my nie.

**Gate grupy D:** trzy boty w grupie, każdy z awatarem, rozmawiają ze sobą
i z człowiekiem; po wyjściu z grupy prywatny transkrypt każdego z nich nie
zawiera ani jednego `[Group room]`; panel komputera po prawej działa (K10).

---

## Grupa E — onboarding i logowanie (U23, U27)

**Decyzja, która już zapadła: logowanie zostaje na tokenie.** Powód
w `PLAN-00-INDEX.md`. Robotą jest uproszczenie, nie zmiana sposobu.

**U23 — pierwszy ekran po instalacji.** Dwa duże przyciski i nic więcej:

- **Postaw serwer** — to urządzenie ma być serwerem. Program stawia usługę,
  pokazuje adres i kod QR, i od razu przechodzi do czatu.
- **Zaloguj się do serwera** — łączymy się z serwerem, który już gdzieś stoi.
  Skanowanie kodu QR albo wklejenie adresu z tokenem.

Dziś użytkownik dostaje ekran, który zakłada, że wie, czym jest host i token.

**U27 — logowanie prostsze.** Cel: postawienie serwera, instalacja programu
i połączenie jednego z drugim mają iść bez ani jednego ręcznie przepisanego
ciągu znaków. Serwer po stronie kodu już to umie — `POST /api/pair/start`
i `/claim` działają, brakuje **ekranu z kodem QR**. To jest najmniejsza
poprawka o największym efekcie na tej całej liście.

**Gate grupy E:** czysta instalacja na dwóch urządzeniach; drugie łączy się
z pierwszym przez zeskanowanie kodu; nikt niczego nie przepisuje.

---

## Grupa F — wygląd i język (U22, U26)

**U26 — wygląd według `inspiracje.png`.** Opis wzoru jest w
`PLAN-MOBILE-KOLEGA.md` sekcja 5 — nie przepisywać go tutaj, bo web i telefon
mają wyjść tak samo i jeden opis ma być jednym opisem. Robić razem z kolegą,
uzgadniając komponenty.

**U22 — pełny polski.** Tłumaczenie jest dziś częściowe: w kodzie widać wzorzec
`polish ? "Nagraj skill" : "Record a skill"` (`SkillsPanel.tsx:220`), ale
w wielu miejscach zostały same angielskie napisy — na przykład
`No command-line tools detected.` w `AppSettingsPanel.tsx:697` i cała ta
zakładka.

Robić na końcu tej grupy, po zmianach z grup A–E, bo tłumaczenie napisów, które
zaraz znikną, to praca do kosza.

Sposób: zebrać wszystkie napisy interfejsu przez `git grep` na literałach
w JSX, wypisać listę braków i zamknąć ją jednym przejściem. Zostawić test,
który przechodzi po plikach interfejsu i pada, gdy ktoś doda napis bez wersji
polskiej — inaczej luki wrócą przy pierwszej nowej funkcji.

**Gate grupy F:** przełączenie języka na polski nie zostawia ani jednego
angielskiego napisu na żadnym ekranie; test na brakujące tłumaczenia
w repozytorium.
