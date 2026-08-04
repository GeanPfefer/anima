from __future__ import annotations

from pathlib import Path
import subprocess
import sys
from types import SimpleNamespace
import zipfile

from local_agent import cli
from local_agent.config import Config
from local_agent.container import docker_available
import pytest


class FakeClient:
    def __init__(self, host: str, model: str): pass
    def tags(self): return ["fake"]
    def chat(self, messages, tools=None, format=None):
        return {"message": {"content": '{"objective":"x","actions":[{"kind":"inspect","target":"workspace"}],"impact_level":"workspace_only","risk_categories":[]}'}}


def make_repo(path: Path) -> None:
    subprocess.run(["git", "init"], cwd=path, check=True, capture_output=True)
    (path / "a.py").write_text("x=1\n")
    subprocess.run(["git", "add", "a.py"], cwd=path, check=True, capture_output=True)
    subprocess.run(["git", "-c", "user.name=T", "-c", "user.email=t@example.invalid", "commit", "-m", "base"], cwd=path, check=True, capture_output=True)


def make_empty_repo(path: Path) -> None:
    path.mkdir()
    subprocess.run(["git", "init"], cwd=path, check=True, capture_output=True)


TASK_WITH_FILES = "crie music_stats.py, test_music_stats.py, sample_tracks.json e README.md e execute os testes"


class NoEditClient:
    response: dict[str, object] = {"message": {"content": '{"action":"complete","summary":"terminei"}'}}
    def __init__(self, host: str, model: str): pass
    def tags(self): return ["fake"]
    def chat(self, messages, tools=None, format=None):
        if format is not None and "objective" in format.get("properties", {}):
            return {"message": {"content": '{"objective":"criar","actions":[{"kind":"inspect","target":"workspace"}],"impact_level":"workspace_only","risk_categories":[]}'}}
        return self.response


class FakeExecutor:
    def __init__(self, *args, **kwargs): pass
    def run(self, command):
        return SimpleNamespace(exit_code=0, stdout="", stderr="Ran 0 tests in 0.000s\nOK", duration_ms=1, timed_out=False, truncated=False, container_name="fake")


def test_explicit_allow_dirty_skips_the_ambiguous_local_prompt(monkeypatch) -> None:
    snapshot = SimpleNamespace(dirty=True, status=" M arquivo.py")
    monkeypatch.setattr("builtins.input", lambda prompt="": pytest.fail(f"prompt inesperado: {prompt}"))
    assert cli.dirty_workspace_choice(snapshot, automated=True, allow_dirty=True)


@pytest.mark.parametrize(("response", "reason"), [
    ({"message": {"content": ""}}, "model_execution_empty_response"),
    ({"message": {"content": '{"action":"complete","summary":"terminei"}'}}, "model_execution_no_tool_calls"),
    ({"message": {"content": "", "tool_calls": [{"bad": True}]}}, "model_execution_invalid_tool_calls"),
])
def test_cli_persists_failure_when_model_does_not_edit(monkeypatch, tmp_path: Path, response: dict[str, object], reason: str) -> None:
    workspace = tmp_path / "workspace"
    make_empty_repo(workspace)
    NoEditClient.response = response
    monkeypatch.setattr(cli, "OllamaClient", NoEditClient)
    monkeypatch.setattr(cli, "docker_available", lambda: True)
    monkeypatch.setattr(cli, "DockerExecutor", FakeExecutor)
    monkeypatch.setattr("builtins.input", lambda prompt="": "A")
    monkeypatch.setattr(sys, "argv", ["local_agent", "--workspace", str(workspace), "--task", TASK_WITH_FILES])
    assert cli.main() == 7
    evidence_files = list((tmp_path / ".anima-agent-evidence").glob("*-failed.json"))
    assert len(evidence_files) == 1
    evidence = __import__("json").loads(evidence_files[0].read_text())
    assert evidence["failure"]["reason"] == reason
    assert evidence["states"][-1] == "failed"
    assert evidence["apply"]["status"] == "not_attempted"
    assert evidence["tools"] == []
    assert not any((workspace / name).exists() for name in ("music_stats.py", "test_music_stats.py", "sample_tracks.json", "README.md"))


class FourWritesClient(NoEditClient):
    def __init__(self, host: str, model: str): self.calls = 0
    def chat(self, messages, tools=None, format=None):
        if format is not None and "objective" in format.get("properties", {}):
            return super().chat(messages, tools, format)
        if tools is None:
            return {"message": {"content": "review"}}
        files = ["music_stats.py", "test_music_stats.py", "sample_tracks.json", "README.md"]
        if self.calls < len(files):
            path = files[self.calls]
            self.calls += 1
            return {"message": {"content": "", "tool_calls": [{"function": {"name": "write_file", "arguments": {"path": path, "content": "fixture\n"}}}]}}
        return {"message": {"content": '{"action":"complete","summary":"done"}'}}


def test_cli_rejects_exit_zero_when_unittest_runs_zero_tests(monkeypatch, tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    make_empty_repo(workspace)
    monkeypatch.setattr(cli, "OllamaClient", FourWritesClient)
    monkeypatch.setattr(cli, "docker_available", lambda: True)
    monkeypatch.setattr(cli, "DockerExecutor", FakeExecutor)
    monkeypatch.setattr("builtins.input", lambda prompt="": "A")
    monkeypatch.setattr(sys, "argv", ["local_agent", "--workspace", str(workspace), "--task", TASK_WITH_FILES])
    assert cli.main() == 6
    evidence_files = list((tmp_path / ".anima-agent-evidence").glob("*-failed.json"))
    evidence = __import__("json").loads(evidence_files[0].read_text())
    assert evidence["failure"]["reason"] == "test_validation_failed"
    assert evidence["tests"][0]["tests_count"] == 0
    assert evidence["states"][-1] == "failed"
    assert evidence["apply"]["status"] == "not_attempted"
    assert not any((workspace / name).exists() for name in ("music_stats.py", "test_music_stats.py", "sample_tracks.json", "README.md"))


def test_real_cli_denial_keeps_snapshot_and_never_runs(monkeypatch, tmp_path: Path, capsys) -> None:
    make_repo(tmp_path)
    monkeypatch.setattr(cli, "OllamaClient", FakeClient)
    monkeypatch.setattr(cli, "docker_available", lambda: False)
    answers = iter(["C", "N"])
    monkeypatch.setattr("builtins.input", lambda prompt="": next(answers))
    monkeypatch.setattr(sys, "argv", ["local_agent", "--workspace", str(tmp_path), "--task", "inspect"])
    called = False
    original = cli.LocalAgent.run
    def forbidden(self, task):
        nonlocal called
        called = True
        return original(self, task)
    monkeypatch.setattr(cli.LocalAgent, "run", forbidden)
    before = (tmp_path / "a.py").read_bytes()
    assert cli.main() == 1
    assert not called and (tmp_path / "a.py").read_bytes() == before
    assert "Snapshot inicial permaneceu intacto" in capsys.readouterr().out


class EditingClient:
    original: Path | None = None
    def __init__(self, host: str, model: str):
        self.agent_calls = 0
    def tags(self): return ["fake"]
    def chat(self, messages, tools=None, format=None):
        if format is not None and "objective" in format.get("properties", {}):
            return {"message": {"content": '{"objective":"editar","actions":[{"kind":"edit","target":"a.py"}],"impact_level":"workspace_only","risk_categories":["local_code_change","test_execution"]}'}}
        if self.original is not None:
            assert (self.original / "a.py").read_text() == "x=1\n"
        if tools is None:
            return {"message": {"content": "revisão concluída"}}
        self.agent_calls += 1
        if self.agent_calls == 1:
            return {"message": {"content": "", "tool_calls": [{"function": {"name": "write_file", "arguments": {"path": "a.py", "content": "x = 2\n"}}}]}}
        return {"message": {"content": '{"action":"complete","summary":"MODELO_ALEGA_SUCESSO_SEM_PROVA"}'}}


class FailThenPassExecutor:
    results: list[object] = []

    def __init__(self, *args, **kwargs): pass

    def run(self, command: str) -> object:
        return FailThenPassExecutor.results.pop(0)


class FixCycleClient:
    """Roteiro determinístico: escreve errado, tenta concluir, recebe a falha, corrige e conclui."""

    def __init__(self, host: str, model: str):
        self.agent_calls = 0

    def tags(self): return ["fake"]

    def chat(self, messages, tools=None, format=None):
        if format is not None and "objective" in format.get("properties", {}):
            return {"message": {"content": '{"objective":"editar","actions":[{"kind":"edit","target":"a.py"}],"impact_level":"workspace_only","risk_categories":["local_code_change","test_execution"]}'}}
        if tools is None:
            return {"message": {"content": "revisão concluída"}}
        self.agent_calls += 1
        if self.agent_calls == 1:
            return {"message": {"content": "", "tool_calls": [{"function": {"name": "write_file", "arguments": {"path": "a.py", "content": "x = 3\n"}}}]}}
        if self.agent_calls == 2:
            return {"message": {"content": '{"action":"complete","summary":"terminei"}'}}
        if self.agent_calls == 3:
            feedback = [m for m in messages if isinstance(m, dict) and m.get("role") == "tool" and "completion_rejected" in str(m.get("content"))]
            assert len(feedback) == 1, "o agente deveria ter recebido exatamente um feedback estruturado de falha"
            assert '"exit_code": 1' in str(feedback[0]["content"])
            assert '"command": "python -m unittest"' in str(feedback[0]["content"])
            return {"message": {"content": "", "tool_calls": [{"function": {"name": "write_file", "arguments": {"path": "a.py", "content": "x = 2\n"}}}]}}
        return {"message": {"content": '{"action":"complete","summary":"corrigido"}'}}


def _container_result(exit_code: int, stderr: str) -> object:
    return SimpleNamespace(exit_code=exit_code, stdout="", stderr=stderr, duration_ms=1, timed_out=False, truncated=False, container_name="fake")


def test_cli_full_fix_cycle_is_deterministic_with_fake_executor(monkeypatch, tmp_path: Path) -> None:
    make_repo(tmp_path)
    FailThenPassExecutor.results = [
        _container_result(1, "Ran 3 tests in 0.001s\n\nFAILED (failures=1)"),
        _container_result(0, "Ran 3 tests in 0.001s\n\nOK"),
        _container_result(0, "Ran 3 tests in 0.001s\n\nOK"),
    ]
    monkeypatch.setenv("LOCAL_AGENT_TEST_COMMAND", "python -m unittest")
    monkeypatch.setattr(cli, "OllamaClient", FixCycleClient)
    monkeypatch.setattr(cli, "docker_available", lambda: True)
    monkeypatch.setattr(cli, "DockerExecutor", FailThenPassExecutor)
    monkeypatch.setattr("builtins.input", lambda prompt="": "C" if "[A]bortar" in prompt else "A")
    monkeypatch.setattr(sys, "argv", ["local_agent", "--workspace", str(tmp_path), "--task", "altere a.py"])
    assert cli.main() == 0
    assert (tmp_path / "a.py").read_text() == "x = 2\n"
    assert FailThenPassExecutor.results == [], "exatamente 3 execuções de teste: validação reprovada, validação aprovada e gate final"
    evidence_files = [f for f in (tmp_path.parent / ".anima-agent-evidence").glob("*.json") if not f.name.endswith("-failed.json")]
    assert len(evidence_files) == 1
    evidence = __import__("json").loads(evidence_files[0].read_text(encoding="utf-8"))
    assert evidence["states"] == ["planned", "approved", "editing", "tests_required", "tests_passed", "review_completed", "ready_to_apply", "applied"]
    assert [(t["exit_code"], t["write_generation"]) for t in evidence["tests"]] == [(1, 1), (0, 2), (0, 2)]
    assert evidence["apply"]["status"] == "applied"
    assert [entry["path"] for entry in evidence["apply"]["manifest"]] == ["a.py"]


def test_produce_only_returns_evidence_without_changing_original(monkeypatch, tmp_path: Path, capsys) -> None:
    make_repo(tmp_path)
    original = (tmp_path / "a.py").read_bytes()
    evidence_root = tmp_path.parent / ".anima-agent-evidence"
    existing_evidence = set(evidence_root.glob("*.json")) if evidence_root.exists() else set()
    FailThenPassExecutor.results = [
        _container_result(1, "Ran 3 tests in 0.001s\n\nFAILED (failures=1)"),
        _container_result(0, "Ran 3 tests in 0.001s\n\nOK"),
        _container_result(0, "Ran 3 tests in 0.001s\n\nOK"),
    ]
    monkeypatch.setenv("LOCAL_AGENT_TEST_COMMAND", "python -m unittest")
    monkeypatch.setattr(cli, "OllamaClient", FixCycleClient)
    monkeypatch.setattr(cli, "docker_available", lambda: True)
    monkeypatch.setattr(cli, "DockerExecutor", FailThenPassExecutor)
    monkeypatch.setattr("builtins.input", lambda prompt="": "C" if "[A]bortar" in prompt else "A")
    monkeypatch.setattr(sys, "argv", ["local_agent", "--workspace", str(tmp_path), "--task", "altere a.py", "--produce-only"])

    assert cli.main() == 0
    assert (tmp_path / "a.py").read_bytes() == original
    evidence_files = [f for f in evidence_root.glob("*.json") if f not in existing_evidence and not f.name.endswith("-failed.json")]
    assert len(evidence_files) == 1
    evidence = __import__("json").loads(evidence_files[0].read_text(encoding="utf-8"))
    assert evidence["mode"] == "produce_only"
    assert evidence["states"][-1] == "result_produced"
    assert evidence["apply"]["status"] == "not_attempted"
    assert [entry["path"] for entry in evidence["apply"]["manifest"]] == ["a.py"]
    assert evidence["structured_responses"]
    assert all(entry["raw"] and entry["raw_sha256"] for entry in evidence["structured_responses"])
    handoff = evidence["handoff"]
    assert handoff["kind"] == "result_bundle"
    assert "/" not in handoff["reference"] and "\\" not in handoff["reference"]
    bundle_path = evidence_root / handoff["reference"]
    assert bundle_path.is_file()
    with zipfile.ZipFile(bundle_path) as bundle:
        assert sorted(bundle.namelist()) == ["files/a.py", "manifest.json"]
        assert bundle.read("files/a.py") == b"x = 2\n"
    machine_lines = [line for line in capsys.readouterr().out.splitlines() if line.startswith("ANIMA_RESULT_JSON=")]
    assert len(machine_lines) == 1
    machine_result = __import__("json").loads(machine_lines[0].removeprefix("ANIMA_RESULT_JSON="))
    assert machine_result == {
        "schema_version": 1,
        "status": "result_produced",
        "evidence_reference": evidence_files[0].name,
        "produced_paths": ["a.py"],
        "handoff": handoff,
    }


@pytest.mark.skipif(not docker_available(), reason="Docker indisponível")
def test_approved_cli_keeps_original_until_apply_and_uses_factual_result(monkeypatch, tmp_path: Path, capsys) -> None:
    make_repo(tmp_path)
    (tmp_path / "test_a.py").write_text("import unittest\nfrom a import x\nclass T(unittest.TestCase):\n    def test_x(self): self.assertEqual(x, 2)\n")
    subprocess.run(["git", "add", "test_a.py"], cwd=tmp_path, check=True, capture_output=True)
    subprocess.run(["git", "-c", "user.name=T", "-c", "user.email=t@example.invalid", "commit", "-m", "tests"], cwd=tmp_path, check=True, capture_output=True)
    monkeypatch.setattr(cli, "OllamaClient", EditingClient)
    EditingClient.original = tmp_path
    monkeypatch.setattr("builtins.input", lambda prompt="": "C" if "[A]bortar" in prompt else "A")
    monkeypatch.setattr(sys, "argv", ["local_agent", "--workspace", str(tmp_path), "--task", "altere a.py"])
    assert cli.main() == 0
    output = capsys.readouterr().out
    assert (tmp_path / "a.py").read_text() == "x = 2\n"
    assert "RESULTADO FACTUAL" in output
    assert "MODELO_ALEGA_SUCESSO_SEM_PROVA" not in output


@pytest.mark.skipif(not docker_available(), reason="Docker indisponível")
def test_failed_automatic_tests_prevent_apply(monkeypatch, tmp_path: Path) -> None:
    make_repo(tmp_path)
    (tmp_path / "test_a.py").write_text("import unittest\nfrom a import x\nclass T(unittest.TestCase):\n    def test_x(self): self.assertEqual(x, 1)\n")
    subprocess.run(["git", "add", "test_a.py"], cwd=tmp_path, check=True, capture_output=True)
    subprocess.run(["git", "-c", "user.name=T", "-c", "user.email=t@example.invalid", "commit", "-m", "tests"], cwd=tmp_path, check=True, capture_output=True)
    monkeypatch.setattr(cli, "OllamaClient", EditingClient)
    EditingClient.original = tmp_path
    monkeypatch.setattr("builtins.input", lambda prompt="": "C" if "[A]bortar" in prompt else "A")
    monkeypatch.setattr(sys, "argv", ["local_agent", "--workspace", str(tmp_path), "--task", "altere a.py"])
    assert cli.main() == 6
    assert (tmp_path / "a.py").read_text() == "x=1\n"
