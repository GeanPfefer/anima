from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest

from local_agent.container import DockerExecutor, docker_available
from local_agent.tools import ToolBox
from local_agent.sandbox import WorkspaceSandbox
from local_agent.cli import sanitize_evidence


pytestmark = pytest.mark.skipif(not docker_available(), reason="Docker indisponível")


def executor(tmp_path: Path, timeout: int = 8, output: int = 4000) -> DockerExecutor:
    return DockerExecutor(tmp_path, timeout, output)


def test_container_cannot_read_or_write_host_and_has_no_socket(tmp_path: Path) -> None:
    read = executor(tmp_path).run("python -c \"open('/host-secret-agent-test').read()\"")
    write = executor(tmp_path).run("python -c \"open('/outside-agent-test','w').write('x')\"")
    socket = executor(tmp_path).run("python -c \"open('/var/run/docker.sock').read()\"")
    assert read.exit_code != 0 and write.exit_code != 0 and socket.exit_code != 0


def test_container_has_no_network_or_host_secret(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("ANIMA_FAKE_SECRET", "do-not-leak")
    (tmp_path / ".env").write_text("ANIMA_FAKE_SECRET=do-not-leak")
    env = executor(tmp_path).run("python -c \"assert 'ANIMA_FAKE_SECRET' not in __import__('os').environ\"")
    hidden = executor(tmp_path).run("python -c \"open('.env').read()\"")
    network = executor(tmp_path).run("python -c \"__import__('socket').create_connection(('1.1.1.1',80),1)\"")
    assert env.exit_code == 0 and "do-not-leak" not in env.stdout and hidden.exit_code != 0
    assert network.exit_code != 0


def test_timeout_kills_container_and_output_is_bounded(tmp_path: Path) -> None:
    timed = executor(tmp_path, timeout=1).run("python -c \"(__import__('subprocess').Popen(['sleep','30']),__import__('time').sleep(30))\"")
    massive = executor(tmp_path, output=1024).run("python -c \"print('x'*1000000)\"")
    assert timed.timed_out and timed.exit_code == 124
    assert massive.truncated and len(massive.stdout) + len(massive.stderr) <= 1024


def test_no_docker_means_no_host_fallback(tmp_path: Path) -> None:
    box = ToolBox(WorkspaceSandbox(tmp_path), 1, 100, None)
    with pytest.raises(PermissionError):
        box.run_command("python -c \"open('x','w').write('bad')\"")
    assert not (tmp_path / "x").exists()


def test_logs_redact_content_and_secrets(tmp_path: Path) -> None:
    box = ToolBox(WorkspaceSandbox(tmp_path), 2, 1000, executor(tmp_path))
    box.execute("write_file", {"path": "safe.py", "content": "TOKEN=supersecret"})
    encoded = json.dumps(box.events)
    assert "supersecret" not in encoded and "content_sha256" in encoded
    evidence = sanitize_evidence('{"task":"TOKEN=supersecret","password":"bad"}')
    assert "supersecret" not in evidence and '"bad"' not in evidence


def test_workspace_is_limited_tmpfs_without_host_bind(tmp_path: Path) -> None:
    mounts = executor(tmp_path).run(
        "python -c \"print(m) if 'tmpfs /workspace tmpfs' in (m:=open('/proc/mounts').read()) else 1/0\""
    )
    assert mounts.exit_code == 0
    assert " /workspace tmpfs " in mounts.stdout
    assert "type=bind" not in mounts.stdout


def test_workspace_quota_stops_excessive_write_and_leaves_no_container(tmp_path: Path) -> None:
    result = executor(tmp_path, timeout=15).run(
        "python -c \"open('large.bin','wb').write(b'x'*(80*1048576))\""
    )
    assert result.exit_code != 0
    residual = subprocess.run(
        ["docker", "ps", "-a", "--filter", "name=anima-agent-", "--format", "{{.Names}}"],
        capture_output=True, text=True, check=True,
    )
    assert not residual.stdout.strip()
