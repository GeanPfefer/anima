from __future__ import annotations

from dataclasses import dataclass
import os
from pathlib import Path


@dataclass(frozen=True)
class Config:
    workspace: Path
    host: str
    model: str
    max_iterations: int
    command_timeout: int
    max_output: int
    workspace_limit_mb: int
    known_secrets: tuple[str, ...]
    test_command: str

    @classmethod
    def load(cls, workspace: str, model: str | None = None) -> "Config":
        root = Path(workspace).expanduser().resolve(strict=True)
        if not root.is_dir():
            raise ValueError("A workspace precisa ser um diretório existente.")
        host = os.getenv("OLLAMA_HOST", "http://127.0.0.1:11434").rstrip("/")
        if host in {"0.0.0.0:11434", "http://0.0.0.0:11434"}:
            host = "http://127.0.0.1:11434"
        elif host == "127.0.0.1:11434":
            host = "http://127.0.0.1:11434"
        elif host == "localhost:11434":
            host = "http://localhost:11434"
        if host not in {"http://127.0.0.1:11434", "http://localhost:11434"}:
            raise ValueError("Este POC aceita apenas Ollama local em 127.0.0.1/localhost:11434.")
        selected_model = model or os.getenv("OLLAMA_MODEL") or "qwen2.5-coder:14b"
        test_command = os.getenv("LOCAL_AGENT_TEST_COMMAND", "python -m unittest")
        if test_command not in {
            "python -m unittest", "python -m pytest", "pytest",
            "npm test", "npm.cmd test", "npm run typecheck", "npm.cmd run typecheck",
            "npm run build", "npm.cmd run build",
        }:
            raise ValueError("Comando do gate de testes não permitido.")
        return cls(
            root, host, selected_model,
            int(os.getenv("LOCAL_AGENT_MAX_ITERATIONS", "24")),
            int(os.getenv("LOCAL_AGENT_COMMAND_TIMEOUT", "120")),
            int(os.getenv("LOCAL_AGENT_MAX_OUTPUT", "20000")),
            int(os.getenv("LOCAL_AGENT_WORKSPACE_LIMIT_MB", "64")),
            tuple(value for value in os.getenv("LOCAL_AGENT_KNOWN_SECRETS", "").split(";") if value),
            test_command,
        )
