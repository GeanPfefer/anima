from __future__ import annotations

from dataclasses import dataclass
import subprocess
from pathlib import Path
import shlex
import os
import queue
import signal
import threading
import time

from .policy import evaluate_command


@dataclass(frozen=True)
class CommandResult:
    exit_code: int
    output: str
    timed_out: bool = False
    truncated: bool = False


def run_safe(command: str, cwd: Path, timeout: int, max_output: int) -> CommandResult:
    decision = evaluate_command(command)
    if not decision.allowed:
        raise PermissionError(decision.reason)
    args = [part.strip('"') for part in shlex.split(command, posix=False)]
    if args and args[0].lower() in {"git", "git.exe"}:
        args[1:1] = [
            "-c", f"safe.directory={cwd.resolve()}",
            "-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false",
            "-c", "diff.external=", "-c", "core.hooksPath=NUL",
        ]
        if "diff" in args and "--no-ext-diff" not in args:
            diff_index = args.index("diff")
            args[diff_index + 1:diff_index + 1] = ["--no-ext-diff", "--no-textconv"]
    env = None
    if args and args[0].lower() in {"git", "git.exe"}:
        env = {
            "PATH": os.environ.get("PATH", ""), "SystemRoot": os.environ.get("SystemRoot", ""),
            "TEMP": os.environ.get("TEMP", ""), "TMP": os.environ.get("TMP", ""),
            "HOME": str(cwd / ".agent" / "no-home"), "USERPROFILE": str(cwd / ".agent" / "no-home"),
            "GIT_CONFIG_NOSYSTEM": "1", "GIT_TERMINAL_PROMPT": "0",
        }
    creationflags = subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0
    process = subprocess.Popen(
        args, cwd=cwd, shell=False, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env,
        start_new_session=os.name != "nt", creationflags=creationflags,
    )

    def terminate_tree() -> None:
        if process.poll() is not None:
            return
        if os.name == "nt":
            subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"], capture_output=True, timeout=5)
        else:
            getattr(os, "killpg")(process.pid, getattr(signal, "SIGKILL", 9))
    events: queue.Queue[tuple[str, bytes | None]] = queue.Queue(maxsize=16)

    def reader(label: str, stream: object) -> None:
        while True:
            chunk = stream.read(4096)  # type: ignore[attr-defined]
            events.put((label, chunk or None))
            if not chunk:
                return

    for label, stream in (("stdout", process.stdout), ("stderr", process.stderr)):
        threading.Thread(target=reader, args=(label, stream), daemon=True).start()
    buffers = {"stdout": bytearray(), "stderr": bytearray()}
    finished = 0
    started = time.monotonic()
    timed_out = truncated = False
    while finished < 2:
        if time.monotonic() - started > timeout:
            timed_out = True
            terminate_tree()
            break
        try:
            label, chunk = events.get(timeout=0.1)
        except queue.Empty:
            continue
        if chunk is None:
            finished += 1
            continue
        remaining = max_output - sum(len(value) for value in buffers.values())
        if remaining > 0:
            buffers[label].extend(chunk[:remaining])
        truncated = truncated or len(chunk) > max(remaining, 0)
    try:
        code = process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        terminate_tree()
        code = 124
    stderr = buffers["stderr"].decode("utf-8", errors="replace")
    if args and args[0].lower() in {"git", "git.exe"}:
        stderr = "\n".join(line for line in stderr.splitlines() if "unable to access" not in line or "Permission denied" not in line)
    output = buffers["stdout"].decode("utf-8", errors="replace") + stderr
    return CommandResult(124 if timed_out else code, output[:max_output], timed_out, truncated)
