from __future__ import annotations

from pathlib import Path

SENSITIVE_NAMES = {
    ".env", ".env.local", ".env.production", "id_rsa", "id_ed25519",
    "credentials", "credentials.json", "token", "tokens.json", ".npmrc", ".pypirc",
}
SENSITIVE_PARTS = {".ssh", ".aws", ".azure", ".gnupg", ".agent", ".git", "auth", "secrets"}


class SandboxViolation(ValueError):
    pass


class WorkspaceSandbox:
    def __init__(self, root: Path):
        self.root = root.resolve(strict=True)

    def resolve(self, value: str, *, for_write: bool = False, allow_sensitive: bool = False) -> Path:
        raw = Path(value)
        if raw.is_absolute():
            candidate = raw
        else:
            candidate = self.root / raw
        # Resolve the closest existing parent so symlinks cannot escape on writes.
        probe = candidate
        suffix: list[str] = []
        while not probe.exists():
            if probe == probe.parent:
                raise SandboxViolation("Caminho inválido.")
            suffix.append(probe.name)
            probe = probe.parent
        resolved = probe.resolve(strict=True)
        for part in reversed(suffix):
            resolved /= part
        try:
            resolved.relative_to(self.root)
        except ValueError as exc:
            raise SandboxViolation("O caminho escapa da workspace autorizada.") from exc
        if not allow_sensitive and self._sensitive(resolved):
            raise SandboxViolation("Leitura ou escrita de material sensível foi bloqueada.")
        if not for_write and not resolved.exists():
            raise FileNotFoundError(resolved)
        return resolved

    def relative(self, path: Path) -> str:
        return path.relative_to(self.root).as_posix()

    def _sensitive(self, path: Path) -> bool:
        rel = path.relative_to(self.root)
        lowered = [p.lower() for p in rel.parts]
        name = path.name.lower()
        return name in SENSITIVE_NAMES or name.startswith(".env.") or any(p in SENSITIVE_PARTS for p in lowered)
