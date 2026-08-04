from __future__ import annotations

from dataclasses import dataclass, field
import difflib
import hashlib
from pathlib import Path

from .runner import run_safe
from .sandbox import WorkspaceSandbox


@dataclass(frozen=True)
class FileEvidence:
    sha256: str
    size: int
    mtime_ns: int
    content: bytes | None = field(default=None, repr=False, compare=True)


@dataclass(frozen=True)
class WorkspaceSnapshot:
    status: str
    diff: str
    files: dict[str, FileEvidence]
    content_not_retained: tuple[str, ...] = ()

    @property
    def dirty(self) -> bool:
        return bool(self.status.strip())

    @property
    def changed_paths(self) -> list[str]:
        return sorted(line[3:].strip().strip('"') for line in self.status.splitlines() if len(line) >= 4)

    def manifest(self) -> dict[str, object]:
        return {
            "status": self.status, "diff": self.diff,
            "files": {name: {"sha256": ev.sha256, "size": ev.size, "mtime_ns": ev.mtime_ns, "content_retained": ev.content is not None} for name, ev in self.files.items()},
            "content_not_retained": list(self.content_not_retained),
        }


def _hash(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def capture_snapshot(sandbox: WorkspaceSandbox, timeout: int, max_output: int) -> WorkspaceSnapshot:
    evidence_limit = max(max_output, 20_000_000)
    status = run_safe("git status --short", sandbox.root, timeout, evidence_limit).output
    diff = run_safe("git diff", sandbox.root, timeout, evidence_limit).output
    staged = run_safe("git diff --cached", sandbox.root, timeout, evidence_limit).output
    if staged:
        diff += "\n--- STAGED ---\n" + staged
    files: dict[str, FileEvidence] = {}
    not_retained: list[str] = []
    listed = run_safe("git ls-files --cached --others --exclude-standard", sandbox.root, timeout, evidence_limit).output
    for name in listed.splitlines():
        item = sandbox.root / name
        if not item.is_file():
            continue
        try:
            safe = sandbox.resolve(str(item))
        except (ValueError, FileNotFoundError):
            continue
        stat = safe.stat()
        content = safe.read_bytes() if stat.st_size <= 2_000_000 else None
        if content is None:
            not_retained.append(sandbox.relative(safe))
        files[sandbox.relative(safe)] = FileEvidence(_hash(safe), stat.st_size, stat.st_mtime_ns, content)
    return WorkspaceSnapshot(status, diff, files, tuple(sorted(not_retained)))


def snapshot_changes(before: WorkspaceSnapshot, after: WorkspaceSnapshot) -> list[str]:
    return sorted(name for name in set(before.files) | set(after.files) if before.files.get(name) != after.files.get(name))


def incremental_diff(before: WorkspaceSnapshot, after: WorkspaceSnapshot) -> str:
    chunks: list[str] = []
    for name in snapshot_changes(before, after):
        old = before.files.get(name)
        new = after.files.get(name)
        if old and old.content is None or new and new.content is None:
            chunks.append(f"Binary/large delta not retained: {name}\n")
            continue
        old_content = old.content if old and old.content is not None else b""
        new_content = new.content if new and new.content is not None else b""
        old_lines = old_content.decode("utf-8", errors="replace").splitlines(True)
        new_lines = new_content.decode("utf-8", errors="replace").splitlines(True)
        chunks.extend(difflib.unified_diff(old_lines, new_lines, f"a/{name}", f"b/{name}"))
    return "".join(chunks)
