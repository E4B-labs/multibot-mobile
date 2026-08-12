"""Mock gatewaya Hermesa dla testów czatu — mini serwer OpenAI-compatible.

Udaje `POST /v1/chat/completions` platformy `api_server` (i jej multipleksowy
mirror `/p/<profile>/v1/chat/completions`), żeby testy sprawdzały NASZ kod proxy
bez odpalania prawdziwego `hermes gateway` i bez płatnego LLM-a. Prawdziwy
gateway odpala dopiero gate fazy 1 (Task 5).

`requests_seen` trzyma body każdego żądania — Task 5 asertuje na nim ciągłość
historii (czy druga wiadomość widzi poprzednią wymianę).
"""

import json
import socket  # noqa: F401  # (uvicorn sam bierze wolny port przez port=0)
import threading
import time

import uvicorn
from fastapi import FastAPI, Request
from fastapi.responses import StreamingResponse

REPLY = "mock: odpowiedz testowa"

# Na ile kawałków mock tnie `REPLY` w trybie stream — test skleja je z powrotem.
STREAM_DELTAS = ["mock: ", "odpowiedz ", "testowa"]

app = FastAPI()

# Body każdego żądania, w kolejności. Czyszczone przez test (`requests_seen.clear()`).
requests_seen: list[dict] = []


@app.post("/v1/chat/completions")
@app.post("/p/{profile}/v1/chat/completions")
async def completions(request: Request, profile: str = ""):
    """Jeden handler pod oboma ścieżkami — dokładnie jak w api_server.py:7212-7214,
    gdzie każda trasa jest rejestrowana też jako `/p/{profile}<path>`."""
    body = await request.json()
    requests_seen.append(body)
    if body.get("stream"):  # multibot (F2): wariant SSE, kształt jak api_server.py:4405-4590
        return StreamingResponse(_sse_chunks(body), media_type="text/event-stream")
    return {
        "id": "chatcmpl-mock",
        "object": "chat.completion",
        "created": 0,
        "model": body.get("model", "hermes-agent"),
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": REPLY},
                "finish_reason": "stop",
            }
        ],
        "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2},
    }


def _sse_chunks(body: dict):
    """Ramki SSE dokładnie w kolejności prawdziwego `api_server`: rola, deltas,
    tool-progress osobnym eventem, ramka finiszowa z `usage`, `[DONE]`."""
    model = body.get("model", "hermes-agent")
    base = {"id": "chatcmpl-mock", "object": "chat.completion.chunk", "created": 0, "model": model}

    def frame(payload: dict, event: str | None = None) -> str:
        head = f"event: {event}\n" if event else ""
        return f"{head}data: {json.dumps(payload)}\n\n"

    yield frame({**base, "choices": [{"index": 0, "delta": {"role": "assistant"}, "finish_reason": None}]})
    yield frame(
        {"toolCallId": "call-1", "status": "running", "name": "search"},
        event="hermes.tool.progress",
    )
    for piece in STREAM_DELTAS:
        yield frame({**base, "choices": [{"index": 0, "delta": {"content": piece}, "finish_reason": None}]})
    yield frame(
        {
            **base,
            "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 1, "completion_tokens": 3, "total_tokens": 4},
        }
    )
    yield "data: [DONE]\n\n"


def start(timeout: float = 10.0):
    """Odpal mocka w wątku na wolnym porcie. Zwraca `(base_url, stop)`."""
    server = uvicorn.Server(
        uvicorn.Config(app, host="127.0.0.1", port=0, log_level="warning")
    )
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    deadline = time.time() + timeout
    while not server.started:
        if time.time() > deadline:
            raise RuntimeError("mock_llm nie wystartował")
        time.sleep(0.02)
    port = server.servers[0].sockets[0].getsockname()[1]

    def stop() -> None:
        server.should_exit = True
        thread.join(timeout=timeout)

    return f"http://127.0.0.1:{port}", stop
