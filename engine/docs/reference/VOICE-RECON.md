# Recon warstwy głosowej Hermesa pod fazę 10 (voice, 2026-08-12)

Ścieżki bez prefiksu = `G:\Projects\hermes-agent\`.

## 0. Sprostowania do założeń zadania

1. **Gate fazy 10 NIE wymaga TTS.** `PLAN.md:175` → gate = „Dictated message sent
   from phone browser"; `docs/UI-SPEC.md:150-154` = **dyktowanie**, „No live
   conversation mode at launch". TTS = polerka, nie gate.
2. **Baseline z PLAN-u to Web Speech API w przeglądarce, nie upload do serwera**
   (`PLAN.md:120`, wiersz F; upgrade = „whisper.cpp small model server-side").
   Gate przechodzi **bez ani jednej linijki reuse Hermesa**.
3. **Hermes nie ma whisper.cpp — ma faster-whisper (CTranslate2)**
   (`pyproject.toml:196-201`); dosłowny whisper.cpp podepniesz providerem
   `local_command` (`tools/transcription_tools.py:116, 294`).
4. **Hermes MA TTS** — 11 providerów (§3). Zadanie dopuszczało, że może nie być.
5. **Hermes ma gotowy HTTP dla obu kierunków, z `?profile=`**:
   `POST /api/audio/transcribe` i `POST /api/audio/speak`
   (`hermes_cli/web_server.py:4393, 4600`) — dashboard/desktop, nie gateway, ale
   funkcje pod spodem importujemy wprost (§2, §3).

## 1. Sekcja `stt:` — klucze i domyślne

Doc: `cli-config.yaml.example:1216-1257`. Prawda: `hermes_cli/config_defaults.py:1568-1620`.

| Klucz | Default | Uwaga |
|---|---|---|
| `stt.enabled` | `True` | `:1569` |
| `stt.echo_transcripts` | `True` | echo 🎙️ transkryptu do usera, `:1573` |
| `stt.provider` | `"local"` | `:1574`; brak klucza = autodetekcja local>groq>openai (`transcription_tools.py:1006-1012`) |
| `stt.language` | `"en"` | **globalny hint dla KAŻDEGO providera**, `:1580`; `""` = auto |
| `stt.cloud_trim_silence` / `_threshold_db` / `_keep_ms` | `True` / `-40` / `300` | trym ciszy ffmpegiem przed uploadem do cloudu, `:1586-1588` |
| `stt.local.model` | `"base"` | tiny/base/small/medium/large-v3/turbo, `:1590` |
| `stt.local.language` / `initial_prompt` | `""` | `:1591-1592` |
| `stt.local.vad` / `vad_min_silence_ms` | `True` / `500` | Silero VAD, anty-halucynacja, `:1595-1596` |
| `stt.local.no_speech_prob_threshold` / `logprob_threshold` | `0.6` / `-1.0` | oba muszą trafić, `:1597-1598` |
| `stt.local.unload_after_idle_seconds` | `0` (nigdy) | zwalnia VRAM, `:1599` |
| `stt.<provider>.model` | groq `whisper-large-v3-turbo` `:1602`; openai `whisper-1` `:1606` (+ `base_url`, `transcription_tools.py:2958-2962`); mistral `voxtral-mini-latest` `:1610`; elevenlabs `scribe_v2` `:1617`; deepinfra `""` = live katalog | każdy ma też własne `language` |

**Providery wbudowane** (`transcription_tools.py:379-388`): `local`, `local_command`,
`groq`, `openai`, `mistral`, `xai`, `elevenlabs`, `deepinfra`.
`CLOUD_STT_PROVIDERS = BUILTIN − {local, local_command}` (`:2523`).
Pluginy dokładają swoje przez `agent/transcription_registry.py:17` (nazw wbudowanych nie przejmą).

| Provider | Zależność / klucz | Offline |
|---|---|---|
| `local` | `faster-whisper==1.2.1` (`pyproject.toml:198`), flaga `_HAS_FASTER_WHISPER` (`:100`) | **TAK** (po pobraniu modelu) |
| `local_command` | dowolny whisper CLI + `HERMES_LOCAL_STT_COMMAND` (`:116, 294`) | **TAK** |
| `groq` | sdk `openai` + `GROQ_API_KEY` (`:1047-1052`) — free tier | nie |
| `openai` | sdk `openai` + `OPENAI_API_KEY`/`VOICE_TOOLS_OPENAI_KEY`, **albo** `base_url` na lokalny serwer OpenAI-compatible (loopback/LAN nie wymaga klucza, `:2892-2909`) | zależnie |
| `mistral` | `mistralai` + `MISTRAL_API_KEY` (`:1063-1070`) | nie |
| `xai` | OAuth albo `XAI_API_KEY` (`:1072-1079`) | nie |
| `elevenlabs` | `ELEVENLABS_API_KEY` (`:1082-1087`) | nie |
| `deepinfra` | `DEEPINFRA_API_KEY` | nie |

W `.venv` slafy-bota **nie ma żadnego z nich** — sprawdzone: brak `faster_whisper`,
`groq`, `mistralai`, `elevenlabs`. Jest `numpy 2.5.2` i `edge_tts 7.2.7`.

## 2. Maszyneria STT

- **Wejście publiczne**: `transcription_tools.py:2853 transcribe_audio(file_path, model)` —
  blokada plików z sekretami (`agent/file_safety.get_read_block_error`, `:2859`),
  walidacja (`:2870`), preprocessing (`_prepare_audio_for_transcription`, `:1374`), dispatch.
- **Owijka do reuse**: `tools/voice_mode.py:1402 transcribe_recording(wav_path)` —
  chunkuje przy „File too large" (`:1418-1420`), filtruje halucynacje Whispera
  (`:1430-1437`), zamienia `no_speech` na sukces z pustym transkryptem (`:1441-1443`).
  **Fallback**: `transcribe_audio_local_fallback` (`:2917`) — tylko już zainstalowany
  lokalny backend, bez lazy-installu i bez cloudu.
- **Formaty**: `SUPPORTED_FORMATS = {.mp3 .mp4 .mpeg .mpga .m4a .wav .webm .ogg .oga
  .opus .aac .flac .caf}` (`:126`), `MAX_FILE_SIZE = 25 MB` (`:128`) — `.webm`
  z MediaRecordera jest na liście.
- **ffmpeg**: `_find_ffmpeg_binary` (`:231`), transkod do 16 kHz mono AAC/m4a
  (`_STT_M4A_ENCODE_ARGS` `:238-241`, `_transcode_audio_for_stt` `:263`); bez niego
  błąd „ffmpeg was not found" (`:274`), ale tylko dla kontenerów wymagających
  konwersji i trymu ciszy. Na tej maszynie ffmpeg jest (choco, w PATH).
- **Adaptery platform** idą wspólnym helperem gatewaya `gateway/run.py:22459-22540`
  (`stt_enabled` → `transcribe_audio` → `transcribe_audio_local_fallback` → wklejenie
  transkryptu w tekst usera); Discord bezpośrednio
  (`plugins/platforms/discord/adapter.py:4542`). **api_server nie ma endpointu audio** (§5).
- **Gotowy HTTP**: `POST /api/audio/transcribe?profile=<bot>` (`web_server.py:4393`),
  body `{data_url, mime_type}` (**base64 data URL, nie multipart**), limit 25 MB
  (`:1437`), MIME→sufiks (`_AUDIO_MIME_EXTENSIONS` `:1422-1442`, fallback `.webm`),
  scope przez `_config_profile_scope` (`:14025-14056`), praca w executorze.
  Klient: `apps/desktop/src/hermes.ts:1711-1725`; capture:
  `apps/desktop/src/app/chat/composer/hooks/use-mic-recorder.ts:186-202`
  (`getUserMedia({echoCancellation, noiseSuppression})`, preferencja
  `audio/webm;codecs=opus` → `audio/mp4` → `audio/ogg` → `audio/wav`).

## 3. TTS — jest, i duży

`tools/tts_tool.py` (4502 linie). Wejście: `text_to_speech_tool(text, output_path,
speed, instructions, provider)` (`:3484-3515`) → JSON `{success, file_path, file_paths}`
+ tag `MEDIA:<path>`.

- **Providery** (`config_defaults.py:1489-1565`): `edge` (**default**, `:1492`, głos
  `en-US-AriaNeural` `:1494`), `elevenlabs`, `openai`, `gemini`, `xai`, `mistral`,
  `minimax`, `kittentts`, `neutts`, `piper`, `deepinfra`; plus command-providery
  `tts.providers.<name>` (`transcription_tools.py:390-397`). `_get_provider` nie robi
  auto-upgradu do płatnych — „Inference credentials do not imply consent to paid
  speech generation" (`tts_tool.py:648-654`).
- **`edge_tts 7.2.7` już jest w `.venv` slafy-bota**; lazy import `tts_tool.py:108-118`,
  synteza `_generate_edge_tts` (`:1718-1740`). Darmowe, **bez klucza**, **wymaga internetu**.
- Offline TTS: `piper` (`:1547-1560`, cache `~/.hermes/cache/piper-voices/`),
  `kittentts` (25-80 MB, `:1538-1541`), `neutts` (`:1542-1546`) — nowe ciężkie
  zależności (onnxruntime).
- **Wyjście**: domyślnie `.mp3` w `<HOME>/audio_cache/<timestamp>.mp3` (`tts_tool.py:4460`);
  `/api/audio/speak` mapuje `.mp3/.ogg/.opus/.wav/.flac` → MIME (`web_server.py:4652-4658`).
- **Gotowy HTTP**: `POST /api/audio/speak?profile=<bot>` (`web_server.py:4600-4676`),
  `{text}` → `{ok, data_url, mime_type, provider}`, plik **kasowany po odczycie**
  (`:4665-4668`). Klient `apps/desktop/src/hermes.ts:1727-1737`. Streaming:
  `/api/audio/speak-stream` (WS, int16 PCM) — `apps/desktop/src/lib/voice-playback.ts:94-118`,
  `gateway/streaming_tts_consumer.py`.

## 4. Katalogi `audio_cache/`

- `AUDIO_CACHE_DIR = get_hermes_dir("cache/audio", "audio_cache")`
  (`gateway/platforms/base.py:983`), rozwiązywane na żywo przez `get_audio_cache_dir()`
  (`:986-989`, `mkdir` przy każdym wołaniu) → **per profil**, pod `HERMES_HOME` bota.
  Ta sama ścieżka dla TTS (`tools/tts_tool.py:264`).
- **Kto pisze**: inbound `cache_audio_from_bytes` (`:1005-1021`, nazwa
  `audio_<uuid12><ext>`, ext sniffowany z magic bytes przez `tools/audio_container`)
  i `cache_audio_from_url` (`:1024`, SSRF-guard + limit). Outbound — TTS domyślnie.
- **Lifecycle**: `cleanup_audio_cache(max_age_hours=24)` (`:1088-1094`), wołane z crona
  sprzątającego gatewaya (`gateway/run.py:27292, 27312`).
- Na liście struktury profilu (`hermes_cli/profiles.py:225`) i na denyliście
  źródeł obrazów (`tools/image_source.py:235`).

## 5. api_server — brak multimodal audio (potwierdzone)

Parser części wiadomości: `gateway/platforms/api_server.py:595-654`. Akceptowane:
`_TEXT_PART_TYPES = {text, input_text, output_text}` (`:599`),
`_IMAGE_PART_TYPES = {image_url, input_image}` (`:546, 610`).
`_FILE_PART_TYPES` → jawny `ValueError` (`:645-648`); **każdy inny typ (czyli
`input_audio`) leci w** `raise ValueError("unsupported_content_type:Unsupported
content part type ... Only text and image_url/input_image parts are supported.")`
(`:651-653`). Miękka ścieżka `_normalize_chat_content` pomija nie-tekst po cichu (`:521`).
Brak `multipart`/`UploadFile`/`File(` w całym pliku.

**Jedyną drogą jest transkrypcja PRZED `gateway.chat()`** — potwierdzone.

Wstecznie tak samo: `_resolve_media_to_data_urls` (`api_server.py:1031-1079`)
inline'uje **wyłącznie obrazy** (`_MEDIA_IMG_EXT`, limit 5 MB `:1028`);
`MEDIA:<path>.mp3` zostaje surową ścieżką lokalną w tekście. Toolset `tts`
(`toolsets.py:230-234`, narzędzie `text_to_speech`) jest na naszej ścieżce
bezużyteczny — TTS wołamy sami po stronie serwera.

## 6. Voice-mode UX w Hermesie (koncepcyjnie)

- `tools/voice_mode.py`: `AudioRecorder` (`:812`) z progiem
  `_silence_threshold = SILENCE_RMS_THRESHOLD` (`:847`) i logiką „mówił → cisza → stop"
  (`:920, :972`); `create_audio_recorder()` (`:1201`). **VAD po RMS, nie ML.**
  Anty-echo: `is_whisper_hallucination` (`:1249`), `is_voice_stop_phrase` (`:1294`),
  `is_tts_echo` (`:1337`).
- Wake word „Hey Hermes": `tools/wake_word.py` (1508 l.), `gateway/wake.py`, config
  `wake_word.capture: auto|local|client` (`cli-config.yaml.example:1275-1283`) —
  desktop bez mikrofonu streamuje PCM przez RPC `wake.feed`. **Domyślnie off.**
- Przeglądarkowy odpowiednik już napisany: `apps/desktop/src/lib/voice-barge-in.ts:60-102`
  (MediaRecorder na pre-rollu). CLI push-to-talk: `hermes_cli/voice.py` (1061 l.).

## 7. Pułapki

1. **`stt.language: "en"` jest domyślne i globalne** (`config_defaults.py:1581`;
   rozwiązywanie `transcription_tools.py:181-200`: per-provider > `stt.language` >
   `HERMES_LOCAL_STT_LANGUAGE` > auto). User mówi po polsku → dyktowanie wraca po
   angielsku. **Ustawić `"pl"` per profil.** Bliźniaczo `tts.edge.voice = "en-US-AriaNeural"` (`:1494`).
2. **Model faster-whisper ląduje na C:.** `WhisperModel(...)` wołany bez `download_root`
   (`transcription_tools.py:1604, 1607, 1616, 1807`), a w całym repo zero ustawień
   `HF_HOME`/`HUGGINGFACE_HUB_CACHE`/`download_root` (grep = 0 poza testami). Domyślny
   cache HF = `%USERPROFILE%\.cache\huggingface` → **łamie regułę „nic na C:"**.
   Przed włączeniem local STT trzeba wystawić `HF_HOME` na D:.
3. **`tempfile.NamedTemporaryFile` w `/api/audio/transcribe`** (`web_server.py:4432-4438`)
   pisze do `%TEMP%` = C:. Kopiując ten endpoint 1:1 kopiujemy zapis na C:.
   Nasz temp → `profiles/<bot>/audio_cache/` albo `D:\tmp`.
4. **Silent refusal — rodzina.** `stt.enabled: false` → gateway nie transkrybuje, wkleja
   tylko notkę „[The user sent a voice message: <path>]" (`run.py:22459-22477`), bez błędu.
   `_get_provider` przy braku zależności/klucza **loguje warning i zwraca `"none"`**
   (`transcription_tools.py:1022-1034, 1047-1052, 1063-1070, 1082-1087`) — HTTP 200,
   pusty transkrypt. Ten sam wzorzec co `check_fns` z faz poprzednich.
5. **Root vs profil — dwa różne mechanizmy.** `stt_enabled` gatewaya parsowany z
   **rootowego** configu (`gateway/config.py:959, 1174-1176`, użycie `run.py:22459`).
   Ale `_load_stt_config`/`_load_tts_config` idą przez `load_config()` → żywe
   `get_hermes_home()` (`transcription_tools.py:164-169`, `tts_tool.py:629-640`) →
   **contextvar `set_hermes_home_override` działa**. Nasze własne wołanie pod overridem
   (wzorzec `server/routines.py:58-63`) czyta per profil; ścieżka gatewaya — nie.
6. **Lazy install faster-whisper** (`transcription_tools.py:337-370`) odpala `uv pip
   install` w tle przy `security.allow_lazy_installs`. Pakiet pójdzie do `.venv` (G:),
   ale model — patrz pułapka 2.
7. **25 MB to limit dwóch warstw naraz**: `MAX_FILE_SIZE` (`:128`) i
   `_MAX_TRANSCRIPTION_UPLOAD_BYTES` (`web_server.py:1437`). Base64 puchnie o 33% —
   realny sufit body ≈ 33 MB (dlatego my bierzemy multipart).

---

# Konsekwencje dla fazy 10

**Reuse 1:1 (import, nie kopia):**
`tools.voice_mode.transcribe_recording` (`voice_mode.py:1402`) — nie surowe
`transcribe_audio`, bo dostajemy filtr halucynacji i „cisza = pusty string";
`transcribe_audio_local_fallback` (`:2917`) jako drugi strzał, jak gateway
(`run.py:22501-22508`); `tools.tts_tool.text_to_speech_tool` (`tts_tool.py:3484`)
+ mapa rozszerzeń→MIME (`web_server.py:4652-4658`); `_audio_extension_for_mime`
(`web_server.py:1422-1442`); `hermes_constants.set_hermes_home_override` — wzorzec
mamy już w `server/routines.py:58-63`.

**Cienka warstwa slafy-bota:**
1. `server/voice.py` (~80 l.): `transcribe(bot_id, audio_bytes, mime)` i
   `speak(bot_id, text)`, obie pod `set_hermes_home_override(profile_dir(bot_id))`,
   temp w `profiles/<bot>/audio_cache/` (nie `tempfile` — pułapka 3).
2. `POST /api/bots/{id}/voice` — **multipart** (`UploadFile`) zamiast base64 data URL
   Hermesa: MediaRecorder → `FormData`, o 33% mniej bajtów; `to_thread` jak reszta
   `server/app.py`. Zwraca `{transcript}`; UI wkleja do kompozera, user wysyła
   normalnym `/api/bots/{id}/chat`. To pokrywa gate (`PLAN.md:175`).
3. `_ensure_stt_config(bot_id)` w `server/gateway.py` obok `_ensure_memory_config`
   (`gateway.py:248`): merge `stt.language: "pl"`, nie podmiana.
4. TTS (poza gate'em): `POST /api/bots/{id}/speak` → `{data_url}` + `<audio>` w UI.
   Domyślnie **wyłączone**, przełącznik per bot.
5. UI: mikrofon w kompozerze — **najpierw Web Speech API** (`SpeechRecognition`,
   `lang="pl-PL"`): zero backendu, pokrywa baseline `PLAN.md:120`; fallback na (2), gdy
   przeglądarka nie wspiera albo user wybrał self-hosted. Pigułka głosowa wg
   `UI-SPEC.md:152-154` (zielone słupki + `^` + `■`).

**Config per profil:** `stt.language: "pl"` obowiązkowo (pułapka 1); `stt.provider`
tylko gdy user coś wybierze; `tts.edge.voice: "pl-PL-ZofiaNeural"` gdy włączy TTS.
**Nie ruszać** `stt.enabled: false` ani rootowego `stt_enabled` gatewaya (pułapka 5).

**Matryca offline vs klucz — user ma TYLKO OpenRouter:**

| | Działa dziś | Warunek |
|---|---|---|
| Web Speech API (przeglądarka) | **TAK** | Chrome/Edge, online, zero kluczy i zależności |
| STT `local` (faster-whisper) | nie | `pip install faster-whisper` + `HF_HOME` na D:; potem **offline** |
| STT `local_command` (whisper.cpp) | nie | binarka + `HERMES_LOCAL_STT_COMMAND`; **offline** |
| STT `groq` | nie | darmowy `GROQ_API_KEY` — najtańsze wejście w serwerowe STT |
| STT `openai`/`mistral`/`xai`/`elevenlabs`/`deepinfra` | nie | płatny klucz |
| TTS `edge` | **TAK** | `edge_tts 7.2.7` już w `.venv`, bez klucza, wymaga internetu |
| TTS `piper`/`kittentts`/`neutts` | nie | nowe ciężkie zależności; za to offline |

**OpenRouter nie robi ani STT, ani TTS.** Brak `openrouter` w `BUILTIN_STT_PROVIDERS`
(`transcription_tools.py:379-388`) i w liście providerów TTS
(`config_defaults.py:1489-1565`). Klucz OpenRoutera nie odblokowuje tu niczego
(`stt.openai.base_url` da się przestawić, ale na lokalny serwer OpenAI-compatible —
OpenRouter nie wystawia `/v1/audio/transcriptions`).

**Top 3 pułapki:** (1) `stt.language: "en"` jako default → polskie dyktowanie wraca po
angielsku; (2) faster-whisper ściąga model do cache HF na **C:**; (3) `input_audio`
odbija się od `api_server` twardym `unsupported_content_type` (`api_server.py:651`),
a `MEDIA:` z audio nie wraca do klienta (`:1031-1047`) — oba kierunki dźwięku muszą
iść obok gatewaya.

**Czego NIE piszemy:** własnego wrappera Whispera, chunkowania >25 MB, filtra
halucynacji, providera TTS, endpointu audio w gatewayu.
