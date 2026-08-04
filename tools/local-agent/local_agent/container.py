from __future__ import annotations

from dataclasses import dataclass
import os
from pathlib import Path
import queue
import subprocess
import threading
import time
import uuid
import tempfile
import tarfile

from .policy import evaluate_command
from .sandbox import SENSITIVE_NAMES, SENSITIVE_PARTS


IMAGE = "anima-local-agent-python:0.1"


@dataclass(frozen=True)
class ContainerResult:
    exit_code: int
    stdout: str
    stderr: str
    duration_ms: int
    timed_out: bool = False
    truncated: bool = False
    container_name: str = ""


def docker_available(timeout: int = 8) -> bool:
    try:
        result = subprocess.run(["docker", "info", "--format", "{{.ServerVersion}}"], capture_output=True, timeout=timeout)
        return result.returncode == 0
    except (OSError, subprocess.TimeoutExpired):
        return False


class DockerExecutor:
    def __init__(self, workspace: Path, timeout: int, max_output: int, image: str = IMAGE, workspace_limit_mb: int = 64):
        self.workspace = workspace.resolve()
        self.timeout = timeout
        self.max_output = max_output
        self.image = image
        self.workspace_limit_mb = workspace_limit_mb

    def run(self, command: str) -> ContainerResult:
        decision = evaluate_command(command)
        if not decision.allowed:
            raise PermissionError(decision.reason)
        import shlex
        inner = [x.strip('"') for x in shlex.split(command, posix=False)]
        if not inner or inner[0].lower() not in {"python", "python.exe", "pytest"}:
            raise PermissionError("Nesta rodada, o contêiner aceita somente execução Python.")
        name = "anima-agent-" + uuid.uuid4().hex[:12]
        if sum(item.stat().st_size for item in self.workspace.rglob("*") if item.is_file() and not item.is_symlink()) > self.workspace_limit_mb * 1024 * 1024:
            raise ValueError("Workspace temporária excede o limite do contêiner.")
        args = [
            "docker", "create", "--name", name,
            "--network", "none", "--user", "65532:65532", "--read-only",
            "--tmpfs", "/tmp:rw,noexec,nosuid,size=32m", "--cap-drop", "ALL",
            "--tmpfs", f"/workspace:rw,noexec,nosuid,size={self.workspace_limit_mb}m,mode=700,uid=65532,gid=65532",
            "--security-opt", "no-new-privileges", "--memory", "256m", "--cpus", "1",
            "--pids-limit", "64", "--workdir", "/workspace",
            "--env", "HOME=/tmp", "--env", "PYTHONDONTWRITEBYTECODE=1",
            self.image, "sleep", str(self.timeout + 30),
        ]
        created = False
        try:
            create = subprocess.run(args, capture_output=True, timeout=15)
            if create.returncode != 0:
                raise RuntimeError("Falha ao criar contêiner isolado.")
            created = True
            start = subprocess.run(["docker", "start", name], capture_output=True, timeout=15)
            if start.returncode != 0:
                raise RuntimeError("Falha ao iniciar contêiner isolado.")
            self._copy_into_container(name)
            return self._stream(["docker", "exec", "--user", "65532:65532", name, *inner], name)
        finally:
            if created:
                subprocess.run(["docker", "kill", name], capture_output=True, timeout=10)
                subprocess.run(["docker", "rm", "-f", name], capture_output=True, timeout=10)
                exists = subprocess.run(["docker", "inspect", name], capture_output=True, timeout=10)
                if exists.returncode == 0:
                    raise RuntimeError(f"Contêiner residual: {name}; limpeza manual: docker rm -f {name}")

    def _copy_into_container(self, name: str) -> None:
        archive_path: Path | None = None
        try:
            handle, raw = tempfile.mkstemp(prefix="anima-container-", suffix=".tar")
            os.close(handle)
            archive_path = Path(raw)
            with tarfile.open(archive_path, "w") as archive:
                for source in self.workspace.rglob("*"):
                    relative = source.relative_to(self.workspace)
                    lowered = [part.lower() for part in relative.parts]
                    sensitive = any(part in SENSITIVE_PARTS for part in lowered) or source.name.lower() in SENSITIVE_NAMES or source.name.lower().startswith(".env.")
                    if source.is_file() and not source.is_symlink() and not sensitive:
                        archive.add(source, arcname=source.relative_to(self.workspace), recursive=False)
            with archive_path.open("rb") as stream:
                copied = subprocess.run(
                    ["docker", "exec", "-i", "--user", "65532:65532", name, "tar", "-xf", "-", "-C", "/workspace"],
                    stdin=stream, capture_output=True, timeout=30,
                )
            if copied.returncode != 0:
                raise RuntimeError("Falha ao copiar workspace para tmpfs do contêiner.")
        finally:
            if archive_path is not None and archive_path.exists():
                archive_path.unlink()

    def _stream(self, args: list[str], name: str) -> ContainerResult:
        started = time.monotonic()
        process = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=False)
        events: queue.Queue[tuple[str, bytes | None]] = queue.Queue(maxsize=16)
        def reader(label: str, stream: object) -> None:
            source = stream
            while True:
                chunk = source.read(4096)  # type: ignore[attr-defined]
                events.put((label, chunk or None))
                if not chunk:
                    return
        threads = [threading.Thread(target=reader, args=("stdout", process.stdout), daemon=True), threading.Thread(target=reader, args=("stderr", process.stderr), daemon=True)]
        for thread in threads:
            thread.start()
        buffers = {"stdout": bytearray(), "stderr": bytearray()}
        finished = 0
        timed_out = truncated = False
        while finished < 2:
            if time.monotonic() - started > self.timeout:
                timed_out = True
                subprocess.run(["docker", "kill", name], capture_output=True, timeout=10)
                process.kill()
                break
            try:
                label, chunk = events.get(timeout=0.1)
            except queue.Empty:
                continue
            if chunk is None:
                finished += 1
                continue
            remaining = self.max_output - sum(len(x) for x in buffers.values())
            if remaining > 0:
                buffers[label].extend(chunk[:remaining])
            if len(chunk) > max(remaining, 0):
                truncated = True
        try:
            code = process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()
            code = 124
        return ContainerResult(124 if timed_out else code, buffers["stdout"].decode(errors="replace"), buffers["stderr"].decode(errors="replace"), int((time.monotonic() - started) * 1000), timed_out, truncated, name)
