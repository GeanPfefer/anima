from __future__ import annotations

import json
from pathlib import Path
import re

from .runner import run_safe
from .sandbox import WorkspaceSandbox
from .container import DockerExecutor
import time
import hashlib


def count_tests(command: str, stdout: str, stderr: str) -> int | None:
    # Typecheck/build são gates determinísticos sem contador de testes. Um
    # processo verde representa uma validação executada; o exit code continua
    # sendo verificado separadamente antes de virar evidência corrente.
    if command in {
        "npm run typecheck", "npm.cmd run typecheck",
        "npm run build", "npm.cmd run build",
    }:
        return 1
    output = stdout + "\n" + stderr
    patterns = {
        "python -m unittest": [r"Ran\s+(\d+)\s+tests?"],
        "python -m pytest": [r"collected\s+(\d+)\s+items?", r"(\d+)\s+passed"],
        "pytest": [r"collected\s+(\d+)\s+items?", r"(\d+)\s+passed"],
    }
    for pattern in patterns.get(command, []):
        match = re.search(pattern, output, re.IGNORECASE)
        if match:
            return int(match.group(1))
    return None


class ToolBox:
    def __init__(self, sandbox: WorkspaceSandbox, timeout: int, max_output: int, executor: DockerExecutor | None = None, known_secrets: set[str] | None = None, test_command: str = "python -m pytest"):
        self.default_test_command = test_command
        self.sandbox = sandbox
        self.timeout = timeout
        self.max_output = max_output
        self.commands: list[str] = []
        self.changed: set[str] = set()
        self.executor = executor
        self.events: list[dict[str, object]] = []
        self.allowed_writes: set[str] | None = None
        self.known_secrets = set(known_secrets or ())
        self.test_results: list[dict[str, object]] = []
        self.write_generation = 0
        self.green_test_generation: int | None = None

    @property
    def has_current_test_evidence(self) -> bool:
        """Verdadeiro somente se a última execução verde de testes cobre o estado atual dos arquivos."""
        return self.green_test_generation is not None and self.green_test_generation == self.write_generation

    def authorize_plan(self, paths: set[str]) -> None:
        self.allowed_writes = set(paths)

    def execute(self, name: str, args: dict[str, object]) -> str:
        methods = {
            "list_files": self.list_files, "read_file": self.read_file,
            "search_text": self.search_text, "write_file": self.write_file,
            "run_command": self.run_command, "git_diff": self.git_diff,
            "git_status": self.git_status, "run_tests": self.run_tests,
        }
        if name not in methods:
            raise ValueError(f"Ferramenta desconhecida: {name}")
        started = time.monotonic()
        safe_args = self._safe_arguments(name, args)
        try:
            result = methods[name](**args)  # type: ignore[arg-type,operator]
            sanitized = self._redact(result[:self.max_output])
            self.events.append({"tool": name, "arguments": safe_args, "ok": True, "duration_ms": int((time.monotonic()-started)*1000), "result": sanitized})
            return result
        except Exception as exc:
            self.events.append({"tool": name, "arguments": safe_args, "ok": False, "duration_ms": int((time.monotonic()-started)*1000), "error": type(exc).__name__})
            raise

    def _safe_arguments(self, name: str, args: dict[str, object]) -> dict[str, object]:
        if name == "write_file":
            content = args.get("content")
            encoded = content.encode("utf-8") if isinstance(content, str) else b""
            raw_path = args.get("path")
            path = raw_path if isinstance(raw_path, str) and not Path(raw_path).is_absolute() and ".." not in Path(raw_path).parts else "[invalid-path]"
            target = self.sandbox.root / path if path != "[invalid-path]" else None
            operation = "modify" if target is not None and target.is_file() else "create"
            return {"path": path, "content_bytes": len(encoded), "content_sha256": hashlib.sha256(encoded).hexdigest(), "operation": operation}
        safe: dict[str, object] = {}
        for key, value in args.items():
            if key == "command":
                safe[key] = "[configured-command]" if value in {"python -m pytest", "pytest", "python -m unittest"} else "[command-redacted]"
            elif key in {"path", "query"} and isinstance(value, str):
                safe[key] = self._redact(value[:200])
            else:
                safe[key] = f"[{type(value).__name__}]"
        return safe

    def _redact(self, text: str) -> str:
        redacted = text
        for secret in sorted((value for value in self.known_secrets if value), key=len, reverse=True):
            redacted = redacted.replace(secret, "[REDACTED]")
        return re.sub(r"(?i)(token|secret|password|api[_-]?key)\s*[:=]\s*\S+", r"\1=[REDACTED]", redacted)

    def list_files(self, path: str = ".") -> str:
        root = self.sandbox.resolve(path)
        files = []
        started = time.monotonic()
        for entry_index, item in enumerate(root.rglob("*")):
            if entry_index >= 2000 or time.monotonic() - started > 3:
                break
            if item.is_file():
                try:
                    self.sandbox.resolve(str(item))
                    files.append(self.sandbox.relative(item))
                except (ValueError, FileNotFoundError):
                    pass
            if len(files) >= 500:
                break
        return json.dumps(files, ensure_ascii=False)

    def read_file(self, path: str) -> str:
        target = self.sandbox.resolve(path)
        if target.stat().st_size > 1_000_000:
            raise ValueError("Arquivo grande demais para leitura automática.")
        return target.read_text(encoding="utf-8", errors="replace")[:self.max_output]

    def search_text(self, query: str, path: str = ".") -> str:
        root = self.sandbox.resolve(path)
        if len(query) > 200:
            raise ValueError("Consulta longa demais.")
        matches: list[str] = []
        total_bytes = 0
        started = time.monotonic()
        for file_index, file in enumerate(root.rglob("*")):
            if file_index >= 500 or total_bytes >= 5_000_000 or time.monotonic() - started > 3:
                break
            if not file.is_file():
                continue
            try:
                self.sandbox.resolve(str(file))
                size = file.stat().st_size
                if size > 500_000:
                    continue
                total_bytes += size
                for number, line in enumerate(file.read_text(encoding="utf-8", errors="ignore").splitlines(), 1):
                    if query.casefold() in line.casefold():
                        matches.append(f"{self.sandbox.relative(file)}:{number}:{line[:300]}")
                        if len(matches) >= 200:
                            return "\n".join(matches)
            except (OSError, ValueError, UnicodeError):
                continue
        return "\n".join(matches)

    def write_file(self, path: str, content: str) -> str:
        target = self.sandbox.resolve(path, for_write=True)
        rel = self.sandbox.relative(target)
        if self.allowed_writes is not None and rel not in self.allowed_writes:
            raise PermissionError("Arquivo não aprovado no plano inicial.")
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8", newline="\n")
        self.changed.add(rel)
        self.write_generation += 1
        return f"Arquivo gravado: {rel}"

    def run_command(self, command: str) -> str:
        self.commands.append(command)
        if self.executor is None:
            raise PermissionError("Docker indisponível; execução no host é proibida.")
        result = self.executor.run(command)
        return json.dumps(result.__dict__, ensure_ascii=False)

    def git_diff(self) -> str:
        return json.dumps(run_safe("git diff", self.sandbox.root, self.timeout, self.max_output).__dict__, ensure_ascii=False)

    def git_status(self) -> str:
        return json.dumps(run_safe("git status --short", self.sandbox.root, self.timeout, self.max_output).__dict__, ensure_ascii=False)

    def run_tests(self, command: str | None = None) -> str:
        command = command or self.default_test_command
        allowed = {
            "python -m pytest", "pytest", "python -m unittest",
            "npm test", "npm.cmd test", "npm run typecheck", "npm.cmd run typecheck",
            "npm run build", "npm.cmd run build", "cargo test", "go test ./...", "dotnet test",
        }
        if command not in allowed:
            raise PermissionError("Comando de teste não permitido. Use exatamente um destes: " + ", ".join(sorted(allowed)) + ".")
        result = self.executor.run(command) if self.executor is not None else None
        if result is None:
            raise PermissionError("Docker indisponível; execução no host é proibida.")
        self.commands.append(command)
        tests_count = count_tests(command, result.stdout, result.stderr)
        record = {"command": command, "exit_code": result.exit_code, "tests_count": tests_count, "timed_out": result.timed_out, "truncated": result.truncated, "write_generation": self.write_generation}
        self.test_results.append(record)
        if result.exit_code == 0 and not result.timed_out and isinstance(tests_count, int) and tests_count > 0:
            self.green_test_generation = self.write_generation
        return json.dumps({**result.__dict__, "stdout": self._redact(result.stdout), "stderr": self._redact(result.stderr)}, ensure_ascii=False)
