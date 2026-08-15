# PLAN-PAMIEC.md — pamięć, RAG i pętla uczenia

> Pozycje P1–P9 z `PLAN-00-INDEX.md`.
>
> Dobra wiadomość na start: **większość tego już leży w repo**. Silnik stoi na
> `hermes-agent`, a jego warstwa pamięci i pętla uczenia zostały w tym projekcie
> rozpoznane co do pliku i linii przy okazji faz 8 i 9. Zamiast projektować od
> zera, ten plan włącza i przestawia rzeczy, które są.
>
> Źródła, przeczytać przed pracą: `engine/docs/reference/MEMORY-RECON.md`
> (pełny schemat bazy) i `engine/docs/HERMES-FACTS.md`, sekcja 6 (pętla uczenia).

---

## 0. Prompt do wklejenia

```
/goal Wykonaj PLAN-PAMIEC.md w repo G:\Projects\multibot, fazy P1..P9 po kolei.
Przeczytaj NAJPIERW engine/docs/reference/MEMORY-RECON.md i sekcję 6
engine/docs/HERMES-FACTS.md — tam jest schemat bazy i prawdziwe zachowanie
pętli uczenia Hermesa. Nie projektuj niczego, co już tam działa.
Silnik jest procesem odłączonym: po zmianie w engine/ zabij uvicorna przed
restartem usługi. Pytest silnika (291+) musi zostać zielony po każdej fazie.
```

---

## 1. Co dziś jest — i dlaczego akurat tak

Hermes ma **dwie niezależne pamięci** i dziś w MultiBocie działa ta gorsza.

| | pamięć markdown | pamięć „holograficzna" |
|---|---|---|
| Gdzie trzyma | `$HERMES_HOME/memories/MEMORY.md`, `USER.md` | `$HERMES_HOME/memory_store.db` (SQLite) |
| Kod | `tools/memory_tool.py` | `plugins/memory/holographic/` |
| Jak trafia do modelu | cały plik wklejany do promptu | dobierane fakty, per tura |
| Domyślnie | **włączona** | **wyłączona** |

Schemat tej drugiej (`store.py:16-76`):

```sql
facts(fact_id, content UNIQUE, category, tags, trust_score, retrieval_count,
      helpful_count, created_at, updated_at, hrr_vector)
entities(entity_id, name, entity_type, aliases, created_at)
fact_entities(fact_id, entity_id)
facts_fts(...)          -- wyszukiwanie pełnotekstowe
memory_banks(...)
```

To jest dokładnie to, o co Kacper prosi: fakty, encje, powiązania fakt↔encja
(czyli graf), wyszukiwanie pełnotekstowe i ocena, czy fakt się przydał
(`helpful_count`, `trust_score`). Wszystko lokalnie, w jednym pliku SQLite,
bez usługi w chmurze i bez nowej zależności.

**Czyli nie budujemy RAG-a. Włączamy ten, który leży wyłączony.**

Przy okazji dwa mity do wyrzucenia z głowy, oba sprawdzone gdy powstawał
`MEMORY-RECON.md`:

- Nie ma w Hermesie żadnego wyzwalacza „zrób skill po trzeciej próbie". Jest
  przypomnienie co N iteracji narzędziowych (`skills.creation_nudge_interval`,
  domyślnie 15) i przegląd po turze.
- Graf jest dwudzielny fakt↔encja. Krawędź nie ma typu ani wagi. Jeśli chcemy
  wagę na krawędzi, to jest nasza robota, nie ich.

---

## P3 — kasujemy `MEMORY.md`

Pierwsza faza, bo określa wszystkie następne.

`MEMORY.md` to płaski plik doklejany do promptu w całości. Rośnie, przestaje
się mieścić, nikt go nie przycina, a modelowi zabiera miejsce nawet wtedy, gdy
w zadaniu nie ma nic wspólnego z jego zawartością. Baza faktów robi to samo
lepiej, bo dobiera do tury tylko to, co pasuje.

Do zrobienia: `memory_enabled: false`, `memory.provider: holographic`,
migracja tego, co już leży w `MEMORY.md`, na fakty (jedna linia = jeden fakt),
usunięcie narzędzia `memory` z listy dostępnej botom, żeby nie zapisywały
w miejsce, którego już nie czytamy.

Usunąć też `src/components/MemoryPanel.tsx` w części pokazującej plik i to, co
w harnessie na niego wskazuje.

**Gate:** świeży bot nie ma `MEMORY.md`; fakty ze starego pliku są w bazie
i wychodzą z wyszukiwania; pytest silnika zielony.

---

## P4 — RAG nad wszystkim

Baza faktów pokrywa fakty. Kacper chce, żeby pamiętane było **wszystko**:
rozmowy, pliki, skille, wyniki rutyn.

Do bazy trafiają ŹRÓDŁA, a nie surowa treść — jeden fakt to jedno zdanie,
które będzie prawdziwe także jutro, z odnośnikiem do miejsca, skąd pochodzi.
Przeciwieństwo: wrzucanie całych transkryptów, co daje bazę pełną „ok",
„dzięki" i „zrób to jeszcze raz".

Kolejność wdrożenia, od najtańszego:

1. **Rozmowy.** Po każdej turze przegląd: czy padło coś trwałego (osoba, cena,
   decyzja z powodem, preferencja, nazwa własna, powiązanie). Jest tak — zapis
   przez `fact_store`. Hermes ma na to hook po turze, nie trzeba pisać pętli.
2. **Pliki.** Plik wrzucony do bota: streszczenie plus fakty, z odnośnikiem do
   ścieżki. Treść zostaje na dysku, do bazy idzie tylko to, co się indeksuje.
3. **Skille i rutyny.** Fakt o tym, że skill istnieje, do czego służy i kiedy
   ostatnio zadziałał. Sam skill zostaje plikiem.

**Gate:** rozmowa sprzed tygodnia, pytanie o szczegół, który padł w niej raz —
bot odpowiada i pokazuje, z czego to wziął.

---

## P1 i P2 — pętla uczenia, ale wynik idzie do faktów

Pętla Hermesa wygląda dziś tak (`HERMES-FACTS.md` §6):

1. **Przypomnienie** co N iteracji narzędziowych: „warto to zapisać".
2. **`/learn`** — agent zbiera źródła i pisze skill przez `skill_manage`.
3. **Kurator** (`agent/curator.py`) — odpalany bezczynnością, przegląda skille
   utworzone przez agenta: przypina, archiwizuje, łączy, poprawia. Nigdy nie
   kasuje, archiwum zostaje. Skille przypięte są nietykalne.
4. **Graf uczenia** (`agent/learning_graph.py`) — węzeł `SkillNode(name,
   category, source, timestamp, use_count, state, created_by, pinned, related)`.

Kacper chce tej pętli, ale z jednym rozstrzygnięciem: **wnioski idą do faktów,
nie do skilli**. Skill zostaje osobną rzeczą — nagranym sposobem wykonania
zadania.

Podział, który z tego wychodzi:

| Rodzaj wiedzy | Gdzie ląduje |
|---|---|
| „Kacper woli krótkie odpowiedzi po polsku" | fakt |
| „Faktura do Orange idzie 12-tego" | fakt |
| „Klient X płaci przelewem, nie kartą" | fakt |
| „Żeby wystawić fakturę: otwórz…, kliknij…, wpisz…" | skill |

Prosta reguła do wpisania w prompt kuratora: **jak to zrobić — skill. Co jest
prawdą — fakt.**

Poprawianie przy powtórzeniu: gdy bot robi zadanie drugi raz, a użytkownik go
koryguje, korekta idzie do faktów jako nowy fakt unieważniający stary. Baza ma
na to `trust_score` i `updated_at` — nie trzeba kasować, wystarczy obniżyć
zaufanie do poprzedniego. Kasowanie historii to najprostsza droga do bota,
który zapomniał, dlaczego coś robi tak, a nie inaczej.

**Gate:** bot robi zadanie, użytkownik mówi „następnym razem inaczej", bot
robi to samo zadanie po raz drugi już poprawnie i umie powiedzieć, skąd wie.

---

## P5 i P6 — graf, który pokazuje uczenie

Zakładka Pamięć dostaje graf nad bazą faktów: węzły to encje, krawędzie
prowadzą przez wspólne fakty (`fact_entities`).

Waga węzła: liczba faktów plus liczba powiązań. Cięższy węzeł jest większy
i rysowany na wierzchu.

> **Uwaga, ten sam błąd został już popełniony w TaskTree Desktop i pojechał do
> wydania.** Symulacja sił trzyma krawędzie jako INDEKSY do tablicy węzłów.
> Posortowanie tej tablicy w miejscu, żeby ustawić kolejność rysowania, sprawia,
> że każda krawędź zaczyna ciągnąć inną parę węzłów i układ się rozsypuje.
> Sortować KOPIĘ. Zostawić na to test, który sprawdza, że tablica wejściowa jest
> nietknięta.

Widoczne uczenie (P6, inspiracja `prime-agent`): nowy fakt zapala się na
chwilę, fakt użyty w odpowiedzi pulsuje, fakt o rosnącym `helpful_count`
rośnie. Bez nowej biblioteki — to są te same dane, które graf już rysuje, plus
znacznik czasu.

**Gate:** graf renderuje realną bazę; po turze widać na nim, które fakty bot
wykorzystał.

---

## P9 — pamięć per bot

Hermes kotwiczy pamięć i cron na `get_hermes_home()`, czyli **per profil**.
Jeden bot to jeden profil, więc rozdzielenie jest darmowe — trzeba tylko
sprawdzić, czy MultiBot nie każe wszystkim botom siedzieć w jednym profilu.

Otwarte pytanie do rozstrzygnięcia w tej fazie: czy firma chce, żeby boty
miały **wspólną** pamięć organizacji obok własnej. Prawdopodobnie tak (bot od
sprzedaży powinien wiedzieć, co bot od księgowości ustalił z klientem). Baza ma
na to `memory_banks` — zajrzeć tam, zanim ktokolwiek zacznie pisać drugą bazę.

**Gate:** dwa boty, każdy z własnymi faktami, żaden nie widzi prywatnych faktów
drugiego.

---

## P7 i P8 — materiały do przerobienia przed projektowaniem

- **P8, w większości zrobione.** Pętla ucząca Hermesa jest rozpisana
  w `engine/docs/HERMES-FACTS.md` §6, a jego pamięć w
  `engine/docs/reference/MEMORY-RECON.md`. Do świeżego sprawdzenia zostaje
  `agent/curator.py` i `agent/learning_graph.py` w oryginalnym repo —
  z powodu P2 kurator dostanie inne zadanie niż u nich.
- **P7, do zrobienia.** Film `https://www.youtube.com/watch?v=R1TNGOZAOZs`,
  wskazany jako wzór działania RAG-a. Obejrzeć skillem `/watch` PRZED fazą P4
  i dopisać tutaj, co z niego wynika. Jeżeli okaże się, że opisuje inne
  podejście niż baza faktów Hermesa — decyzję o zmianie podjąć wtedy, nie
  teraz. Póki co plan idzie po tym, co w repo już leży i działa.
