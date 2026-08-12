# Faza 10 — Voice (dyktowanie + głos odpowiedzi) — plan wykonawczy

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.
> Task 1 (UI, **Fable 5**) + Task 2 (backend, **Opus 5**) RÓWNOLEGLE — niezależne
> pliki. Task 3 gate na końcu. Subagenty NIE commitują. Fakty:
> docs/reference/VOICE-RECON.md (PRZECZYTAJ — matryca providerów, miny C:).

**Goal (gate PLAN.md §5 fazy 10):** "Dictated message sent from phone browser".
UI-SPEC §10: samo dyktowanie, "No live conversation mode at launch". PLAN.md
wiersz F: baseline = **Web Speech API w przeglądarce** — gate przechodzi bez
linijki backendu; serwerowe STT to fallback/upgrade, nie ścieżka główna.

**Architecture (z recon):** Dyktowanie: `webkitSpeechRecognition` w Composerze
(zero zależności). Fallback (Firefox/brak API): MediaRecorder + nasz
`POST /api/bots/{id}/voice` (multipart — NIE base64 jak Hermes, 33% mniej
bajtów) → `tools/voice_mode.py:transcribe_recording()` pod scope profilu →
`gateway.chat`. Głos odpowiedzi: `POST /api/bots/{id}/speak` na
`edge_tts` (JUŻ w .venv, darmowe, bez klucza, wymaga netu) — NIE przez toolset
`tts` Hermesa (api_server odrzuca audio w obie strony: `input_audio` →
`unsupported_content_type`, api_server.py:651-653). OpenRouter nie odblokowuje
żadnego STT/TTS (BUILTIN_STT_PROVIDERS bez niego); serwerowe STT działa dopiero
z GROQ_API_KEY (darmowy) albo `pip install faster-whisper` (offline).

## Global Constraints

- ZAKAZ C:. Miny z recon: (a) NIE kopiować hermesowego `/api/audio/transcribe` —
  jego `tempfile.NamedTemporaryFile` pisze do %TEMP% (u nas D: przez env, ale
  jawnie podać dir); (b) local faster-whisper ściąga model do cache HF na C: —
  NIE instalować/włączać bez `HF_HOME` na D: (poza zakresem fazy — tylko
  odnotować w README przy sekcji STT); (c) `stt.language` default "en" i jest
  globalne — per profil ustawić "pl" (ponytail: hardcode, upgrade = pole w
  ustawieniach bota).
- Nie psuć 153 pytest + 3 spec Playwright.

---

### Task 1 (Fable 5): dyktowanie w Composerze + odtwarzacz odpowiedzi

**Files:** Modify: `ui/src/components/Composer.tsx`, `ui/src/components/MessageBubble.tsx`,
`ui/src/lib/api.ts`

- Composer: przycisk mikrofonu (ikona Mic z lucide) po prawej w polu.
  Web Speech API: `const SR = window.SpeechRecognition || window.webkitSpeechRecognition`.
  Nagrywanie: czerwona pulsująca kropka na przycisku, `interimResults: true` —
  tekst wpada do inputu na żywo (interim jako szary sufiks albo nadpisywanie
  wartości — wybierz prostsze), `lang` z `navigator.language`. Stop: drugi klik
  albo `onend`. `onerror`/brak `SR` → fallback: MediaRecorder (audio/webm) →
  `sendVoice(botId, blob)` → transkrypt wpada do inputu; endpoint 501 (brak
  STT na serwerze) → tooltip "Dictation needs Chrome/Edge, or configure server
  STT" i przycisk disabled do końca sesji.
- MessageBubble (wiadomości bota): mała ikona głośnika (hover) → `speak(botId,
  text)` → odtwórz zwrócone audio przez `new Audio(URL.createObjectURL(blob))`;
  spinner w trakcie; 501/błąd → toast i ikona znika (TTS nieskonfigurowany =
  nie pokazuj martwego przycisku po pierwszym 501 — stan modułowy).
- `api.ts`: `sendVoice(botId, blob) -> {transcript}` (multipart POST
  /api/bots/{id}/voice?transcribe_only=1), `speak(botId, text) -> Blob` (POST
  /api/bots/{id}/speak, response audio/mpeg).
- Gates: `npm run build` zielony (PowerShell). Nie dotykaj backendu/e2e.
  UWAGA typy: `SpeechRecognition` nie ma w lib.dom — mała deklaracja ambient
  w `ui/src/types/` (wzorzec d3-force.d.ts).

### Task 2 (Opus 5): voice backend — STT fallback + TTS edge

**Files:** Create: `server/voice.py`; Modify: `server/app.py`, `server/gateway.py`;
Test: `tests/test_voice.py`

**Interfaces (PINOWANE):**
- `voice.transcribe(bot_id, audio_bytes, filename) -> str` — zapis do
  `$SLAFY_DATA_DIR/voice/` (jawny dir, nie %TEMP%), pod
  `set_hermes_home_override(profile_dir(bot_id))` wołaj
  `tools.voice_mode.transcribe_recording()` (sprawdź realną sygnaturę w klonie
  — VOICE-RECON §2). Brak skonfigurowanego providera STT → `LookupError`
  (mapowane na 501 w app.py — nowy handler exception). Filtr halucynacji
  Whispera jest w środku helpera (nie duplikuj).
- `voice.tts(text, voice=None) -> bytes` — `edge_tts.Communicate(text,
  voice or "pl-PL-MarekNeural").save(...)` do pliku w `$SLAFY_DATA_DIR/voice/`
  (edge_tts ma tylko save-do-pliku; przeczytaj i skasuj plik). Zwraca mp3
  bytes. Błąd sieci → RuntimeError (502).
- `gateway._ensure_stt_config(bot_id)` — profil: `stt: {language: "pl"}`
  (merge, idempotentne, wzorzec `_ensure_memory_config`; provider NIE ustawiany
  — wybór providera to decyzja usera/instalacji, my tylko język).
- REST (app.py): `POST /api/bots/{id}/voice` (multipart `file`; query
  `transcribe_only=1` → `{"transcript"}`; bez flagi → transkrypt do
  `gateway.chat`, zwrot `{"transcript", "reply", "session_id"}` + eventy WS jak
  w POST /chat), `POST /api/bots/{id}/speak {text, voice?}` → Response
  audio/mpeg. Handler LookupError → 501.
- TDD: transcribe woła helper pod właściwym scope (spy na override), brak
  providera → 501 przez API; tts: mock `edge_tts.Communicate` (zapisuje
  bajty-markery) → endpoint oddaje audio/mpeg z markerami; voice bez flagi
  robi chat (mock gateway.chat) i emituje eventy; plik tymczasowy sprzątnięty.
  ŻADNYCH realnych wywołań sieci w testach.

### Task 3: Gate fazy 10

**Files:** Test: `ui/e2e/voice.spec.ts`

- "Dictated message sent from phone browser": Playwright z emulacją mobilną
  (devices['iPhone 14'] — viewport/touch/UA). Headless chromium nie ma realnego
  SpeechRecognition (usługa Google) — `addInitScript` stubuje
  `webkitSpeechRecognition` klasą emitującą po `start()` result
  "wiadomosc dyktowana testowo" (interim + final). Flow: otwórz bota → klik
  mikrofonu → tekst pojawia się w composerze → wyślij → bąbel usera z tym
  tekstem + odpowiedź mocka SSE. To dowodzi NASZEGO okablowania (przycisk,
  wpis, wysyłka); samo rozpoznawanie to własność przeglądarki-vendora —
  odnotuj w LOOP.
- Pełny pytest + WSZYSTKIE specy Playwright zielone. LOOP.md: #38/#39 (jeśli
  taki numer w checkliście §2 — sprawdź; wiersz F), UI-SPEC §10 done
  (dyktowanie; live mode = poza launchem jak w spec). Odnotuj: serwerowe STT
  wymaga GROQ_API_KEY albo faster-whisper + HF_HOME na D: (README sekcja).
  FAZA: 11.
