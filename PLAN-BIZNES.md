# PLAN-BIZNES.md — sprzedaż, strona, sprawy prawne

> Pozycje B1–B5 z `PLAN-00-INDEX.md`.
>
> Nie jestem prawnikiem. Sekcja 4 opisuje, co mówią licencje i gdzie leżą
> ryzyka — przed podpisaniem pierwszej umowy z firmą warto to pokazać
> prawnikowi. Reszta dokumentu to praca do zrobienia, nie porada.

---

## 1. Co właściwie sprzedajemy

Nie „bota AI". Tego każdy ma.

Sprzedajemy: **pracownika, który siedzi na serwerze firmy, ma własny komputer,
uczy się jak działa ta konkretna firma i robi klikaninę, której nikt nie chce
robić.** Nie wychodzi z firmy. Nie wysyła danych do chmury, jeśli firma tego nie
chce. Nie odchodzi po pół roku i nie zabiera ze sobą wiedzy.

Trzy rzeczy odróżniają to od tego, co firma już zna:

1. **Stoi u nich.** Dane nie wychodzą. To jest pierwsze pytanie, które padnie,
   i jedyna odpowiedź, po której rozmowa idzie dalej.
2. **Ma komputer.** Nie tylko odpowiada — klika. Wchodzi do systemu, którego
   nikt nigdy nie zintegruje przez API, bo dostawca API nie daje.
3. **Uczy się od nich.** Pokazujesz mu raz, jak wystawiacie fakturę u siebie,
   i od tej pory robi to po waszemu. Nie po ogólnemu.

**Kto to kupuje.** Firma 10–100 osób, która ma robotę powtarzalną i systemy,
których nie da się połączyć: biuro rachunkowe, agencja, hurtownia, firma
transportowa, przychodnia. Znak rozpoznawczy: ktoś przepisuje dane z jednego
ekranu do drugiego.

**Kto tego nie kupi.** Firma bez własnego serwera i bez kogokolwiek od IT.
Instalacja jest dziś za trudna, żeby to sprzedawać na masówkę.

---

## 2. Jak wygląda wejście do firmy

Kacper pytał wprost: idę do firmy, mówię, że zbudowałem coś takiego — i co
dalej, kto z tego korzysta poza prezesem.

### Rozmowa

Nie zaczynać od pokazywania programu. Zacząć od jednego pytania:

> „Co u was ktoś robi ręcznie co tydzień, chociaż to jest zawsze to samo?"

Odpowiedź na to pytanie jest całą sprzedażą. Firma sama nazwie zadanie, a Ty
pokazujesz TO zadanie zrobione przez bota. Prezentacja programu bez ich zadania
jest prezentacją funkcji i nikogo nie interesuje.

### Pierwszy tydzień — jedno zadanie, nie wdrożenie

Nie sprzedawać „systemu dla firmy". Sprzedawać jedno zadanie i pokazać, że
zniknęło. Serwer stawiasz Ty, nie oni. Konfiguracja jest dziś za trudna, żeby
oddać ją komukolwiek — i to jest w porządku, bo za to się płaci.

### Kto dostaje dostęp poza prezesem

Trzy role, w tej kolejności:

1. **Prezes albo właściciel** — podejmuje decyzję o zakupie, korzysta rzadko.
2. **Osoba, której robotę bot przejął** — korzysta codziennie i ona zdecyduje,
   czy to zostanie na dłużej. To jej trzeba pokazać, jak poprawić bota, gdy
   zrobi coś nie tak. Jeżeli poczuje, że bot zabiera jej pracę, umrze to w dwa
   tygodnie. Jeżeli poczuje, że zabiera jej najgorszą część pracy — obroni to
   sama.
3. **Ktoś od IT** — chce wiedzieć, gdzie to stoi, co ma dostęp do sieci i jak
   to wyłączyć. Dla niego jest zakładka z zasobami maszyny (U17) i możliwość
   podłączenia własnego modelu (S3).

Każda z nich instaluje aplikację na telefonie i loguje się do tego samego
serwera. Bot jest jeden, ludzi jest kilku.

### Czego dziś w produkcie brakuje, żeby to sprzedać

Wymienione uczciwie, bo bez tego rozmowa się urwie:

- **Nie ma kont ani uprawnień.** Jeden token daje pełną władzę: wszystkie boty,
  wszystkie pliki, terminal komputera bota, klucze API. Firma o to zapyta.
  Do zrobienia przed pierwszą prawdziwą sprzedażą.
- **Nie ma zapisu, kto co zrobił.** Firma z księgowością tego będzie chciała.
- **Instalacja wymaga człowieka od IT.** Na dziś tym człowiekiem jesteś Ty.

---

## 3. Cennik i strona

### Cennik

Nie liczyć za zapytania. Firma nie wie, ile ich zrobi, więc nie wie, ile
zapłaci, więc nie kupi. Liczyć za coś przewidywalnego.

Trzy poziomy, do rozstrzygnięcia liczbami przy pierwszych rozmowach:

- **Sam program** — licencja roczna, firma stawia i utrzymuje sama.
- **Program plus wdrożenie** — postawienie serwera, nauczenie bota pierwszego
  zadania, szkolenie ludzi. Jednorazowo plus abonament.
- **Program plus opieka** — jak wyżej, plus zmiany na życzenie i reagowanie,
  gdy przestanie działać.

Modele AI firma opłaca sama, swoim abonamentem albo swoim kluczem. To jest
argument sprzedażowy, nie luka: koszt jest u nich, przewidywalny i widoczny.

### Strona (B2)

Jedna strona, nie serwis. Kolejność ekranów:

1. Nagranie, na którym bot robi prawdziwe zadanie na prawdziwym ekranie.
   Bez lektora, bez animacji. To jest cała strona, reszta to podpisy.
2. Trzy zdania: stoi u ciebie, ma komputer, uczy się twojej firmy.
3. Trzy przykłady zadań z nazwami z życia.
4. Cennik.
5. Formularz: nazwa firmy i jedno zdanie „co robicie ręcznie co tydzień".

Reklamy Meta (B3) **dopiero po tym**, jak strona zamieni pierwsze wejścia
w rozmowy. Kupowanie ruchu na stronę, która nie konwertuje, to płacenie za
naukę czegoś, co widać za darmo.

---

## 4. Sprawy prawne (B5)

### Licencje — sprawdzone, nie z pamięci

| Projekt | Licencja | Co z tego wynika |
|---|---|---|
| `milind-soni/OpenMausBot` | MIT | fork i sprzedaż wolno |
| `NousResearch/hermes-agent` | MIT | to samo |
| `PrimeIntellect-ai/prime-agent` | MIT | to samo |

**Licencja MIT pozwala na sprzedaż komercyjną, w tym zamkniętą.** Wolno
zmieniać kod, wolno nie publikować zmian, wolno brać pieniądze. Nie trzeba
otwierać MultiBota.

Obowiązki, których nie wolno pominąć — są krótkie i darmowe, a ich pominięcie
jest jedynym realnym ryzykiem w tej całej sekcji:

1. **Zostawić treść licencji i informację o prawach autorskich** w produkcie,
   który trafia do klienta. `LICENSE` z linią
   `Copyright (c) 2026 Milind Soni and OpenMausBot contributors` zostaje
   w paczce. To dotyczy każdego projektu MIT, którego kod wchodzi do środka,
   nie tylko OpenMausBot.
2. **Dodać własną informację o prawach autorskich** obok, nie zamiast.
3. **Zrobić listę licencji zależności** i dołączyć ją do produktu. Zależności
   są setki i ktoś w nich może mieć inną licencję niż MIT. Do zrobienia
   automatem (`license-checker` po stronie npm, `pip-licenses` po stronie
   Pythona), nie ręcznie.

### Czego robić nie wolno

- **Nie używać nazwy „OpenMausBot" ani „Hermes" jako nazwy produktu.** Licencja
  MIT daje prawa do kodu, nie do nazwy. Nazwa to znak towarowy i to osobna
  sprawa. `MultiBot` jest własną nazwą i tak ma zostać.
- **Nie sugerować, że autorzy oryginału popierają produkt** ani że są z nim
  związani.
- **Sprawdzić, czy „MultiBot" nie jest już czyimś zarejestrowanym znakiem**
  w Polsce i Unii — wyszukiwarki urzędów są darmowe i publiczne. Zrobić to
  ZANIM powstanie strona i logo, bo zmiana nazwy po wydaniu kosztuje.

### Do sprawdzenia z prawnikiem przed pierwszą umową

To nie są problemy z forkiem — to są zwykłe sprawy sprzedaży oprogramowania
firmie, i akurat one mogą kosztować, jeśli się je pominie:

- **Odpowiedzialność za to, co bot zrobi.** Bot ma komputer i klika. Kto
  odpowiada, gdy skasuje coś w systemie klienta albo wyśle nie tę wiadomość.
  Umowa musi to ograniczać wprost, licencja MIT chroni Ciebie przed autorami
  oryginału, ale nie chroni Ciebie przed Twoim klientem.
- **Dane osobowe (RODO).** Bot przetwarza dane firmy, w tym prawdopodobnie dane
  osobowe. Nawet gdy wszystko stoi na ich serwerze, potrzebna jest umowa
  powierzenia. To, że dane nie wychodzą, upraszcza sprawę — nie kasuje jej.
- **Model AI od zewnętrznego dostawcy.** Jeżeli firma używa Claude albo
  Gemini, jej dane wychodzą do dostawcy. Musi o tym wiedzieć i się zgodzić.
  To jest też najmocniejszy argument za S3 (własny model na serwerze firmy)
  — tam ten problem znika w całości.
