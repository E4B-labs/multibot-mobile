"""Mock gatewaya Hermesa dla testów czatu — mini serwer OpenAI-compatible.

Udaje `POST /v1/chat/completions` platformy `api_server` (i jej multipleksowy
mirror `/p/<profile>/v1/chat/completions`), żeby testy sprawdzały NASZ kod proxy
bez odpalania prawdziwego `hermes gateway` i bez płatnego LLM-a. Prawdziwy
gateway odpala dopiero gate fazy 1 (Task 5).

`requests_seen` trzyma body każdego żądania — Task 5 asertuje na nim ciągłość
historii (czy druga wiadomość widzi poprzednią wymianę).
"""

import socket  # noqa: F401  # (uvicorn sam bierze wolny port przez port=0)
import threading
import time

import uvicorn
from fastapi import FastAPI, Request

REPLY = "mock: odpowiedz testowa"

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
