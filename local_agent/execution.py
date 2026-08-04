from __future__ import annotations

from dataclasses import asdict, dataclass
import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
import tempfile
from typing import Callable
import zipfile

from .sandbox import SENSITIVE_NAMES, SENSITIVE_PARTS, WorkspaceSandbox


COPY_SUFFIXES = {".py", ".toml", ".txt", ".md", ".json", ".yaml", ".yml"}
CACHE_PARTS = {
    ".venv", "venv", "__pycache__", ".pytest_cache", ".mypy_cache", ".ruff_cache",
    "node_modules", ".git", ".next",
}
SECRET_SUFFIXES = {".pem", ".key", ".p12", ".pfx", ".jks", ".keystore"}


def _hash(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _is_reparse(path: Path) -> bool:
    info = path.lstat()
    return path.is_symlink() or bool(getattr(info, "st_file_attributes", 0) & 0x400)


def _walk_no_reparse(root: Path) -> list[Path]:
    found: list[Path] = []
    pending = [root]
    while pending:
        directory = pending.pop()
        with os.scandir(directory) as entries:
            for entry in entries:
                item = Path(entry.path)
                found.append(item)
                # A raiz do cache permanece auditável, mas seus artefatos
                # gerados não são atravessados, copiados ou hashados.
                if (entry.is_dir(follow_symlinks=False)
                        and not _is_reparse(item)
                        and entry.name.lower() not in CACHE_PARTS):
                    pending.append(item)
    return found


def _validate_path_chain(root: Path, destination: Path) -> None:
    relative = destination.relative_to(root)
    current = root
    for part in relative.parts:
        current = current / part
        if current.exists() or current.is_symlink():
            if _is_reparse(current):
                raise RuntimeError(f"Reparse point recusado: {relative.as_posix()}")
            state = file_state(current)
            if current != destination and state.kind != "directory":
                raise RuntimeError(f"Componente não diretório: {relative.as_posix()}")


@dataclass(frozen=True)
class FileState:
    exists: bool
    kind: str
    size: int = 0
    mtime_ns: int = 0
    sha256: str | None = None
    hash_reason: str | None = None


def file_state(path: Path) -> FileState:
    if not path.exists() and not path.is_symlink():
        return FileState(False, "missing")
    try:
        info = path.lstat()
        if _is_reparse(path):
            return FileState(True, "reparse", info.st_size, info.st_mtime_ns, None, "reparse_point")
        if stat.S_ISREG(info.st_mode):
            return FileState(True, "file", info.st_size, info.st_mtime_ns, _hash(path))
        if stat.S_ISDIR(info.st_mode):
            return FileState(True, "directory", 0, info.st_mtime_ns, None, "directory")
        return FileState(True, "special", info.st_size, info.st_mtime_ns, None, "special_file")
    except OSError as exc:
        return FileState(True, "unreadable", 0, 0, None, type(exc).__name__)


@dataclass(frozen=True)
class CompleteBaseline:
    root: Path
    files: dict[str, FileState]

    def state(self, relative: str) -> FileState:
        return self.files.get(relative, FileState(False, "missing"))


def capture_complete_baseline(root: Path) -> CompleteBaseline:
    resolved = root.resolve(strict=True)
    files: dict[str, FileState] = {}
    for item in _walk_no_reparse(resolved):
        relative = item.relative_to(resolved).as_posix()
        files[relative] = file_state(item)
    return CompleteBaseline(resolved, files)


@dataclass(frozen=True)
class CopyRecord:
    path: str
    copied: bool
    reason: str
    size: int


class ExecutionWorkspace:
    def __init__(self, original: Path, max_bytes: int = 64 * 1024 * 1024):
        self.original = original.resolve(strict=True)
        self.max_bytes = max_bytes
        self.root: Path | None = None
        self.records: list[CopyRecord] = []

    def __enter__(self) -> "ExecutionWorkspace":
        self.root = Path(tempfile.mkdtemp(prefix="anima-execution-"))
        try:
            self._copy()
            return self
        except Exception:
            self.cleanup()
            raise

    def __exit__(self, exc_type: object, exc: object, traceback: object) -> None:
        self.cleanup()

    @property
    def sandbox(self) -> WorkspaceSandbox:
        if self.root is None:
            raise RuntimeError("ExecutionWorkspace não iniciada.")
        return WorkspaceSandbox(self.root)

    def cleanup(self) -> None:
        if self.root is None or not self.root.exists():
            return
        shutil.rmtree(self.root)
        if self.root.exists():
            raise RuntimeError(f"Falha ao remover workspace temporária: {self.root.name}")

    def _allowed(self, item: Path, relative: Path) -> tuple[bool, str]:
        lowered = [part.lower() for part in relative.parts]
        name = item.name.lower()
        if any(part in SENSITIVE_PARTS or part in CACHE_PARTS for part in lowered):
            return False, "sensitive_or_cache_directory"
        if name in SENSITIVE_NAMES or name.startswith(".env.") or item.suffix.lower() in SECRET_SUFFIXES:
            return False, "sensitive_name_or_suffix"
        if _is_reparse(item):
            return False, "reparse_point"
        if item.is_dir():
            return True, "directory"
        if item.suffix.lower() not in COPY_SUFFIXES and name not in {"dockerfile", ".gitignore"}:
            return False, "type_not_allowlisted"
        if not item.is_file():
            return False, "special_file"
        return True, "allowlisted"

    def _copy(self) -> None:
        assert self.root is not None
        total = 0
        for source in _walk_no_reparse(self.original):
            relative = source.relative_to(self.original)
            allowed, reason = self._allowed(source, relative)
            size = source.lstat().st_size
            if not allowed:
                self.records.append(CopyRecord(relative.as_posix(), False, reason, size))
                continue
            target = self.root / relative
            if source.is_dir():
                target.mkdir(parents=True, exist_ok=True)
                continue
            if size > self.max_bytes or total + size > self.max_bytes:
                self.records.append(CopyRecord(relative.as_posix(), False, "workspace_size_limit", size))
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, target, follow_symlinks=False)
            total += size
            self.records.append(CopyRecord(relative.as_posix(), True, reason, size))


@dataclass(frozen=True)
class ChangeEntry:
    path: str
    operation: str
    initial_hash: str | None
    expected_hash: str | None
    size: int
    authorized_by_plan: bool
    preexisting_change: bool


@dataclass(frozen=True)
class ApplyResult:
    status: str
    manifest: tuple[ChangeEntry, ...]
    rollback_completed: bool
    error: str | None = None


class ApplyError(RuntimeError):
    def __init__(self, message: str, result: ApplyResult):
        super().__init__(message)
        self.result = result


@dataclass(frozen=True)
class ResultBundle:
    reference: str
    sha256: str


def create_result_bundle(destination: Path, execution: Path, manifest: tuple[ChangeEntry, ...]) -> ResultBundle:
    if not manifest:
        raise ValueError("Bundle de resultado exige manifesto não vazio.")
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(destination.suffix + ".tmp")
    try:
        with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_DEFLATED) as bundle:
            bundle.writestr("manifest.json", json.dumps([asdict(item) for item in manifest], indent=2, ensure_ascii=False))
            sandbox = WorkspaceSandbox(execution)
            for entry in manifest:
                if entry.operation == "delete":
                    continue
                source = sandbox.resolve(entry.path)
                if file_state(source).sha256 != entry.expected_hash:
                    raise RuntimeError(f"Hash temporário divergente: {entry.path}")
                bundle.write(source, "files/" + entry.path)
        os.replace(temporary, destination)
        return ResultBundle(destination.name, _hash(destination))
    finally:
        if temporary.exists():
            temporary.unlink()


def build_manifest(original: Path, execution: Path, baseline: CompleteBaseline, allowed: set[str]) -> tuple[ChangeEntry, ...]:
    normalized = {Path(name).as_posix() for name in allowed}
    entries: list[ChangeEntry] = []
    for relative in sorted(normalized):
        if Path(relative).is_absolute() or ".." in Path(relative).parts:
            raise ValueError("Caminho autorizado inválido.")
        before = baseline.state(relative)
        staged = file_state(execution / relative)
        if staged.kind not in {"file", "missing"}:
            raise ValueError(f"Tipo temporário recusado: {relative}")
        operation = "delete" if not staged.exists else ("modify" if before.exists else "create")
        if before.exists == staged.exists and before.sha256 == staged.sha256:
            continue
        entries.append(ChangeEntry(relative, operation, before.sha256, staged.sha256, staged.size, True, before.exists))
    return tuple(entries)


def apply_changes(
    original: Path,
    execution: Path,
    baseline: CompleteBaseline,
    allowed: set[str],
    *,
    before_replace: Callable[[int, ChangeEntry], None] | None = None,
) -> ApplyResult:
    root = original.resolve(strict=True)
    manifest = build_manifest(root, execution, baseline, allowed)
    if not manifest:
        result = ApplyResult("refused_empty_manifest", manifest, False, "Manifest de aplicação vazio.")
        raise ApplyError(result.error or "Manifest de aplicação vazio.", result)
    current = capture_complete_baseline(root)
    relevant = {entry.path for entry in manifest}
    for relative in relevant:
        if current.state(relative) != baseline.state(relative):
            result = ApplyResult("refused_concurrent_change", manifest, False, f"Baseline divergente: {relative}")
            raise ApplyError(result.error or "Baseline divergente.", result)

    transaction = Path(tempfile.mkdtemp(prefix=".agent-transaction-", dir=root))
    prepared = transaction / "prepared"
    backups = transaction / "backups"
    applied: list[ChangeEntry] = []
    try:
        prepared.mkdir()
        backups.mkdir()
        for entry in manifest:
            destination = WorkspaceSandbox(root).resolve(entry.path, for_write=True, allow_sensitive=True)
            _validate_path_chain(root, destination)
            if entry.operation != "delete":
                source = WorkspaceSandbox(execution).resolve(entry.path)
                if file_state(source).sha256 != entry.expected_hash:
                    raise RuntimeError(f"Hash temporário divergente: {entry.path}")
                ready = prepared / entry.path
                ready.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(source, ready, follow_symlinks=False)
            if entry.operation != "create":
                backup = backups / entry.path
                backup.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(destination, backup, follow_symlinks=False)

        for index, entry in enumerate(manifest):
            if before_replace:
                before_replace(index, entry)
            destination = WorkspaceSandbox(root).resolve(entry.path, for_write=True, allow_sensitive=True)
            _validate_path_chain(root, destination)
            if file_state(destination) != baseline.state(entry.path):
                raise RuntimeError(f"Arquivo mudou durante aplicação: {entry.path}")
            destination.parent.mkdir(parents=True, exist_ok=True)
            if entry.operation == "delete":
                destination.unlink()
            else:
                ready = prepared / entry.path
                local_temp = destination.parent / f".{destination.name}.agent-new-{os.getpid()}"
                shutil.copy2(ready, local_temp, follow_symlinks=False)
                os.replace(local_temp, destination)
            applied.append(entry)
        return ApplyResult("applied", manifest, False)
    except Exception as exc:
        rollback_ok = True
        for entry in reversed(applied):
            try:
                destination = WorkspaceSandbox(root).resolve(entry.path, for_write=True, allow_sensitive=True)
                if entry.operation == "create":
                    if destination.exists():
                        destination.unlink()
                else:
                    backup = backups / entry.path
                    restore = destination.parent / f".{destination.name}.agent-restore-{os.getpid()}"
                    shutil.copy2(backup, restore, follow_symlinks=False)
                    os.replace(restore, destination)
            except Exception:
                rollback_ok = False
        status = "rolled_back" if rollback_ok else "rollback_failed"
        result = ApplyResult(status, manifest, rollback_ok, f"{type(exc).__name__}: {exc}")
        raise ApplyError(result.error or status, result) from exc
    finally:
        shutil.rmtree(transaction)
