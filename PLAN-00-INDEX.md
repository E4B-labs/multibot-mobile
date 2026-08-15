# PLAN-00-INDEX.md — spis wszystkiego, co ma powstać

> Spisane 15 sierpnia 2026 z jednej długiej wypowiedzi Kacpra. Cel dokumentu:
> nic nie zginęło i wiadomo, w którym pliku tego szukać. To NIE jest plan
> wykonawczy — plany wykonawcze to pliki wymienione niżej.
>
> Każda pozycja ma numer. Numer się nie zmienia. Skreślone pozycje zostają
> skreślone z powodem, nie kasowane.

---

## Cel, do którego to wszystko zmierza

MultiBot ma być **produktem sprzedawanym firmom**: firma stawia go na swoim
serwerze, podłącza własne narzędzia i buduje własne automatyzacje, zamiast
zatrudniać ludzi do klikania. Bot sam się uczy, sam kombinuje, sam sięga po
komputer, gdy inaczej się nie da, i pamięta wszystko o użytkowniku.

Do tego dochodzi strona internetowa i sprzedaż (reklamy Meta), więc bieżąca
wersja musi dojść do stanu, w którym da się ją komuś pokazać bez tłumaczenia,
czego akurat nie ruszać.

---

## Pliki planów

| Plik | Zakres |
|---|---|
| `PLAN-MOBILE-KOLEGA.md` | Aplikacja na Androida, repo `multibot2`, praca kolegi. **Gotowe, oddane.** |
| `PLAN-COMPUTER-USE.md` | Komputer bota: widoczna mysz, panele, nagrywanie skilla, wielu botów naraz, upór agenta |
| `PLAN-PAMIEC.md` | Pamięć, RAG, pętla uczenia z hermes-agenta, graf, `prime-agent` |
| `PLAN-UI.md` | Błędy interfejsu, narzędzia CLI, onboarding, polski, zasoby maszyny |
| `PLAN-BIZNES.md` | Model sprzedaży, cennik, strona, sprawy prawne (fork MIT) |
| `PLAN-STOS.md` | Przegląd cudzych repozytoriów: co brać, czego nie |

Stare plany (`GOAL.md`, `PLAN-CLIENTS.md`, `PLAN-COMPUTER.md`) opisują rundy
już zamknięte. Zostają jako zapis, co i dlaczego jest tak zbudowane.

---

## Kolejność

**Teraz:** `PLAN-MOBILE-KOLEGA.md` — oddane, kolega startuje.

**Zaraz po:** `PLAN-COMPUTER-USE.md` razem z pozycjami U1–U9 z `PLAN-UI.md`.
Powód: computer use to jedyna rzecz, której nie ma konkurencja, a dzisiaj
wygląda na zepsutą (niewidoczna mysz, niebieski panel, pełny ekran zasłania
wszystko). Bez tego nie ma czego pokazywać firmie. Błędy U1–U9 to rzeczy,
które widać w pierwszych trzydziestu sekundach demonstracji.

**Potem:** `PLAN-PAMIEC.md`. Największa robota i największa przewaga, ale nie
da się jej pokazać na spotkaniu w piętnaście minut.

**Równolegle, bo nie blokuje kodu:** `PLAN-BIZNES.md` i `PLAN-STOS.md`.

---

## Spis pozycji

### K — komputer bota (`PLAN-COMPUTER-USE.md`)

| Nr | Rzecz |
|---|---|
| K1 | Computer use ma realnie działać, potwierdzone na żywo, nie „tura wyszła zielona" |
| K2 | Kursor myszy bota WIDOCZNY: przejazd z punktu do punktu, kliknięcie, przewijanie |
| K3 | Mysz użytkownika znika natychmiast po kliknięciu „hand back" |
| K4 | Niebieski panel przy starcie pulpitu — usunąć |
| K5 | „Record a skill" przenieść do środka pulpitu, jako opcja po wejściu |
| K6 | Pełny ekran = duży panel na środku z zaokrąglonymi rogami, interfejs MultiBota nadal widoczny pod spodem |
| K7 | Agent nie odpuszcza: cel jak przy `/goal`, kombinuje do skutku, sam sięga po komputer, gdy web search nie wystarcza |
| K8 | Agent zakłada własnych podagentów: chwilowych do jednego zadania i stałych |
| K9 | Wielu botów pracujących na jednym zadaniu (wzór: `strawberrybrowser.com`) |
| K10 | Panel komputera dostępny także w rozmowie grupowej |

### P — pamięć i uczenie (`PLAN-PAMIEC.md`)

| Nr | Rzecz |
|---|---|
| P1 | Pętla uczenia z `hermes-agent`: zadanie, wnioski, poprawa przy powtórzeniu, korekta gdy użytkownik chce inaczej |
| P2 | Wynik uczenia ląduje w **faktach pamięci**, nie w skillach. Skille zostają osobną rzeczą |
| P3 | `MEMORY.md` — skasować |
| P4 | RAG nad wszystkim: fakty, rozmowy, skille, pliki. Ma pamiętać WSZYSTKO o użytkowniku |
| P5 | Graf w zakładce Pamięć łączy wszystkie informacje ze sobą |
| P6 | Widoczne w grafie, że bot się uczy (inspiracja: `prime-agent` od Prime Intellect) |
| P7 | Do obejrzenia przed projektowaniem: film `https://www.youtube.com/watch?v=R1TNGOZAOZs` (skill `/watch`) |
| P8 | Do przeczytania przed projektowaniem: pętla ucząca w `NousResearch/hermes-agent` |
| P9 | Każdy bot ma własną pamięć |

### U — interfejs i błędy (`PLAN-UI.md`)

| Nr | Rzecz |
|---|---|
| U1 | Usage count liczy źle |
| U2 | Pierwsza wiadomość do nowego bota idzie bardzo długo |
| U3 | „New bot" tworzy się długo, czarny ekran, brak wskaźnika ładowania |
| U4 | Wskaźnik ładowania wszędzie, gdzie coś się dociąga (najbardziej: narzędzia CLI) |
| U5 | „No command-line tools detected." dopiero PO realnym sprawdzeniu, wtedy na czerwono |
| U6 | Narzędzia CLI: nazwa i opis mają mówić, że to instalacja CLI na urządzeniu pod istniejące subskrypcje |
| U7 | Zalogowany do Claude, a nadal widać przycisk „Sign in" |
| U8 | Gemini: brak CLI i brak logowania, a widać tylko „Sign in", bez „Install" |
| U9 | Odklikany kwadracik (np. wyłączony Grok) nie daje się kliknąć z powrotem |
| U10 | Ikony dostawców przy narzędziach CLI, te same co w wyborze modelu u góry |
| U11 | Błąd Kimi: `uv tool install --python 3.13 kimi-cli` — `No interpreter found for Python 3.13` |
| U12 | Błąd Qwen: `No auth type is selected` przy logowaniu |
| U13 | Błąd Gemini: `you must specify the GEMINI_API_KEY environment variable` |
| U14 | Cel narzędzi CLI: używać Claude i reszty w MultiBocie BEZ płacenia za API |
| U15 | „Local service" — opisać, jak działa; zielona kropka ma delikatnie pulsować |
| U16 | „Import existing profile" — usunąć |
| U17 | Zasoby maszyny hosta: RAM, procesor, dyski, temperatury |
| U18 | Lewy dolny róg: profil nieklikalny i niepodświetlany, klikalna tylko zębatka |
| U19 | Grupa: ikony przy botach i przy użytkowniku, nie same nazwy |
| U20 | Grupa: poprzedni bot zostaje podświetlony po wejściu w grupę |
| U21 | Grupa: `[Group room]…` nie ma trafiać do prywatnych rozmów botów |
| U22 | Pełne tłumaczenie na polski, wszędzie |
| U23 | Onboarding: „Postaw serwer" albo „Zaloguj się do serwera" |
| U24 | Zakładka „Models" w ustawieniach — sprawdzić testami, czy w ogóle działa |
| U25 | „Install app" — opisać po co jest i jak ma działać |
| U26 | Wygląd całości według `inspiracje.png` |
| U27 | Logowanie zostaje na tokenie, ale ma być znacznie prostsze |

### B — biznes (`PLAN-BIZNES.md`)

| Nr | Rzecz |
|---|---|
| B1 | Sprzedaż firmom: instalacja na własnym serwerze, własne integracje, własne automatyzacje |
| B2 | Strona internetowa MultiBota |
| B3 | Reklamy Meta — później |
| B4 | Jak wygląda wdrożenie w firmie poza prezesem: kto dostaje dostęp i jak |
| B5 | Sprawy prawne: fork `OpenMausBot` (MIT), sprzedaż w Polsce, licencje zależności |

### S — cudzy kod (`PLAN-STOS.md`)

| Nr | Rzecz |
|---|---|
| S1 | Przegląd listy repozytoriów Kacpra: co bierzemy, co odpada, co tylko podglądamy |
| S2 | `prime-agent` jako warstwa pod spodem — sprawdzić, czy to w ogóle ma sens |
| S3 | **Połączenie MultiBota z modelem uruchomionym lokalnie na serwerze firmy** |
| S4 | Dokumentacja Grok Bota: jak boty rozmawiają w grupie; zrobić u nas tak samo |

---

## Decyzje już zapadłe — nie otwierać ich ponownie

**Logowanie zostaje na tokenie.** Kacper najpierw poprosił o logowanie Google
przez Firebase (wzorem TaskTree), a potem sam się wycofał: *„aha nie bo czekaj
bo przecież to ma być lokalnie. hmm no to nie to jednak zostajemy kompletnie
przy tokenie tylko trzeba jakoś prościej to logowanie zrobić"*. Wygrywa druga
wypowiedź. Firebase się nie stawia. Robotą jest **uproszczenie** logowania
tokenem (U27, U23), a nie zmiana sposobu logowania.

Powód, dla którego to jest dobra decyzja, a nie kompromis: produkt sprzedajemy
firmom jako rzecz stojącą na ICH serwerze. Konto Google jako warunek działania
oznaczałoby, że serwer firmy nie zadziała bez zewnętrznej usługi Google —
dokładnie to, za co firma nie chce płacić.

**Logowanie Google w aplikacji mobilnej jest niemożliwe w obecnej formie.**
Android odrzuca OAuth w WebView (`disallowed_useragent`). Nawet gdyby wrócić
do tego pomysłu, wymagałby natywnego `expo-auth-session` i własnej domeny do
nazwanego tunelu Cloudflare.

**Skille i fakty pamięci to dwie różne rzeczy** (P2). Wnioski z pętli uczenia
idą do faktów. Skille zostają tym, czym są — nagranym sposobem wykonania
zadania.
