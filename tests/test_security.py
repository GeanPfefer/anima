from pathlib import Path
import os
import sys
import time

import pytest

from local_agent.policy import evaluate_command
from local_agent.runner import run_safe
from local_agent.sandbox import SandboxViolation, WorkspaceSandbox


def test_blocks_traversal_and_sensitive(tmp_path: Path) -> None:
    box = WorkspaceSandbox(tmp_path)
    (tmp_path / "ok.txt").write_text("ok")
    assert box.resolve("ok.txt") == tmp_path / "ok.txt"
    with pytest.raises(SandboxViolation):
        box.resolve("../outside.txt", for_write=True)
    (tmp_path / ".env").write_text("SECRET=x")
    with pytest.raises(SandboxViolation):
        box.resolve(".env")
    (tmp_path / ".git").mkdir()
    with pytest.raises(SandboxViolation):
        box.resolve(".git/config", for_write=True)


@pytest.mark.skipif(not hasattr(os, "symlink"), reason="sem symlink")
def test_blocks_escaping_symlink(tmp_path: Path) -> None:
    outside = tmp_path.parent / "outside-agent-test"
    outside.mkdir(exist_ok=True)
    link = tmp_path / "link"
    try:
        link.symlink_to(outside, target_is_directory=True)
    except OSError:
        pytest.skip("criação de symlink sem privilégio")
    with pytest.raises(SandboxViolation):
        WorkspaceSandbox(tmp_path).resolve("link/file.txt", for_write=True)


@pytest.mark.parametrize("command", [
    "git reset --hard", "git clean -fd", "git push --force", "Remove-Item x -Recurse",
    "curl https://example.com", "pip install -g bad", "git commit -m x",
])
def test_blocks_dangerous_commands(command: str) -> None:
    assert not evaluate_command(command).allowed


def test_allows_safe_commands() -> None:
    assert evaluate_command("git diff").allowed
    assert evaluate_command("python -m pytest").allowed


def test_timeout(tmp_path: Path) -> None:
    (tmp_path / "wait.py").write_text("import time\ntime.sleep(2)\n")
    result = run_safe("python wait.py", tmp_path, 1, 1000)
    assert result.timed_out
    assert result.exit_code == 124


def test_host_command_output_is_bounded_while_streaming(tmp_path: Path) -> None:
    result = run_safe("python -c \"print('x'*1000000)\"", tmp_path, 5, 1024)
    assert result.exit_code == 0
    assert result.truncated
    assert len(result.output) <= 1024
