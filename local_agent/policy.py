from __future__ import annotations

from dataclasses import dataclass
import re
import shlex


@dataclass(frozen=True)
class CommandDecision:
    allowed: bool
    reason: str
    sensitive: bool = False


SAFE_EXECUTABLES = {
    "python", "python.exe", "py", "pytest", "pytest.exe", "ruff", "ruff.exe",
    "mypy", "mypy.exe", "npm", "npm.cmd", "npx", "npx.cmd", "node", "node.exe",
    "git", "git.exe", "cargo", "cargo.exe", "go", "go.exe", "dotnet", "dotnet.exe",
}
BLOCKED_PATTERNS = [
    r"\brm\s+-[^\n]*r", r"\bremove-item\b[^\n]*-recurse", r"\bdel\b", r"\bformat\b",
    r"\bshutdown\b", r"\brestart-computer\b", r"\bset-executionpolicy\b", r"\breg\s+(add|delete)\b",
    r"git\s+reset\s+--hard", r"git\s+clean\s+-[^\n]*f", r"git\s+push[^\n]*(--force|-f\b)",
    r"git\s+(push|commit|merge|rebase|checkout|switch|clone|fetch|pull)\b",
    r"\b(curl|wget|invoke-webrequest|invoke-restmethod|ssh|scp|ftp)\b",
    r"\b(npm|pip|cargo)\b[^\n]*(--global|-g\b)", r"\b(choco|winget|scoop)\b",
    r"\b(credential|keychain|\.ssh|\.aws|\.env)\b",
]


def evaluate_command(command: str) -> CommandDecision:
    text = command.strip()
    if not text:
        return CommandDecision(False, "Comando vazio.")
    lower = text.lower()
    if any(re.search(pattern, lower) for pattern in BLOCKED_PATTERNS):
        return CommandDecision(False, "Comando bloqueado pela política de segurança.", True)
    if any(token in text for token in ("&&", "||", ";", "|", ">", "<", "`", "$(`")):
        return CommandDecision(False, "Operadores de shell e redirecionamentos não são aceitos.")
    try:
        args = shlex.split(text, posix=False)
    except ValueError:
        return CommandDecision(False, "Comando não pôde ser analisado.")
    executable = args[0].strip('"').lower()
    if executable not in SAFE_EXECUTABLES:
        return CommandDecision(False, f"Executável não permitido: {executable}")
    if executable.startswith("git"):
        sub = args[1].lower() if len(args) > 1 else ""
        if sub not in {"status", "diff", "log", "show", "rev-parse", "ls-files"}:
            return CommandDecision(False, "Somente operações Git de leitura são permitidas.")
    return CommandDecision(True, "Comando seguro dentro da workspace.")

