from __future__ import annotations

import json
from typing import cast
from urllib.request import Request, urlopen
from urllib.error import URLError


class OllamaClient:
    def __init__(self, host: str, model: str, timeout: int = 180):
        self.host, self.model, self.timeout = host, model, timeout

    def _request(self, path: str, payload: dict[str, object] | None = None) -> dict[str, object]:
        data = None if payload is None else json.dumps(payload).encode()
        req = Request(self.host + path, data=data, headers={"Content-Type": "application/json"})
        try:
            with urlopen(req, timeout=self.timeout) as response:
                value = json.loads(response.read().decode())
                if not isinstance(value, dict):
                    raise ValueError("Resposta JSON do Ollama não é um objeto.")
                return cast(dict[str, object], value)
        except (URLError, TimeoutError) as exc:
            raise ConnectionError(f"Ollama indisponível em {self.host}: {exc}") from exc

    def tags(self) -> list[str]:
        result = self._request("/api/tags")
        models = result.get("models", [])
        if not isinstance(models, list):
            return []
        return [str(m.get("name")) for m in models if isinstance(m, dict)]

    def chat(self, messages: list[dict[str, object]], tools: list[dict[str, object]] | None = None, format: dict[str, object] | None = None) -> dict[str, object]:
        payload: dict[str, object] = {"model": self.model, "messages": messages, "stream": False}
        if tools:
            payload["tools"] = tools
        if format:
            payload["format"] = format
        return self._request("/api/chat", payload)
