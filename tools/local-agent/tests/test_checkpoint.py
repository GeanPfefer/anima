from __future__ import annotations

import hashlib
import json
from pathlib import Path
import subprocess
import sys
from types import SimpleNamespace

from local_agent import cli
from local_agent.agent import resumption_preamble
from local_agent.checkpoint import CHECKPOINT_PREFIX, build_model_planning_checkpoint, build_planning_checkpoint, build_starting_checkpoint
from local_agent.planning import bind_plan_to_task, parse_plan


# Vocabulário terminal do executor que um checkpoint mid-flight JAMAIS pode
# fabricar — é a garantia central do AUTO-05/2B.2 no lado do produtor.
FORBIDDEN_TERMINAL_TOKENS = ["InterruptionScenario", "paused", "timed_out", "time_limit_reached", "stopReason"]


def make_repo(path: Path) -> None:
    subprocess.run(["git", "init"], cwd=path, check=True, capture_output=True)
    (path / "a.py").write_text("x=1\n")
    subprocess.run(["git", "add", "a.py"], cwd=path, check=True, capture_output=True)
    subprocess.run(["git", "-c", "user.name=T", "-c", "user.email=t@example.invalid", "commit", "-m", "base"], cwd=path, check=True, capture_output=True)


def _container_result(exit_code: int, stderr: str) -> object:
    return SimpleNamespace(exit_code=exit_code, stdout="", stderr=stderr, duration_ms=1, timed_out=False, truncated=False, container_name="fake")


class FailThenPassExecutor:
    results: list[object] = []

    def __init__(self, *args: object, **kwargs: object) -> None:
        pass

    def run(self, command: str) -> object:
        return FailThenPassExecutor.results.pop(0)


class FixCycleClient:
    """Roteiro determinístico: planeja, escreve errado, é reprovado, corrige e conclui.

    Captura, em atributos de classe, o texto de usuário que o planejador e o
    executor receberam — para provar a entrega do `carriedContext` sem depender
    do modelo real.
    """

    seen_planning: list[str] = []
    seen_execution_user: list[str] = []

    def __init__(self, host: str, model: str) -> None:
        self.agent_calls = 0

    def tags(self) -> list[str]:
        return ["fake"]

    def chat(self, messages: list[dict[str, object]], tools: object = None, format: object = None) -> dict[str, object]:
        user = next((str(m["content"]) for m in messages if m.get("role") == "user"), "")
        planning = isinstance(format, dict) and "objective" in format.get("properties", {})
        if planning:
            FixCycleClient.seen_planning.append(user)
            return {"message": {"content": '{"objective":"editar","actions":[{"kind":"edit","target":"a.py"}],"impact_level":"workspace_only","risk_categories":["local_code_change","test_execution"]}'}}
        if tools is None:
            return {"message": {"content": "revisão concluída"}}
        FixCycleClient.seen_execution_user.append(user)
        self.agent_calls += 1
        if self.agent_calls == 1:
            return {"message": {"content": "", "tool_calls": [{"function": {"name": "write_file", "arguments": {"path": "a.py", "content": "x = 3\n"}}}]}}
        if self.agent_calls == 2:
            return {"message": {"content": '{"action":"complete","summary":"terminei"}'}}
        if self.agent_calls == 3:
            return {"message": {"content": "", "tool_calls": [{"function": {"name": "write_file", "arguments": {"path": "a.py", "content": "x = 2\n"}}}]}}
        return {"message": {"content": '{"action":"complete","summary":"corrigido"}'}}


def _run_produce_only(monkeypatch, tmp_path: Path, extra_args: list[str]) -> None:
    # Workspace em subdiretório: mantém as evidências em tmp_path/.anima-agent-evidence
    # (isoladas por teste), sem poluir o basetemp compartilhado por pytest.
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    make_repo(workspace)
    FixCycleClient.seen_planning = []
    FixCycleClient.seen_execution_user = []
    FailThenPassExecutor.results = [
        _container_result(1, "Ran 3 tests in 0.001s\n\nFAILED (failures=1)"),
        _container_result(0, "Ran 3 tests in 0.001s\n\nOK"),
        _container_result(0, "Ran 3 tests in 0.001s\n\nOK"),
    ]
    monkeypatch.setenv("LOCAL_AGENT_TEST_COMMAND", "python -m unittest")
    monkeypatch.setattr(cli, "OllamaClient", FixCycleClient)
    monkeypatch.setattr(cli, "docker_available", lambda: True)
    monkeypatch.setattr(cli, "DockerExecutor", FailThenPassExecutor)
    # O input real ecoa o prompt SEM quebra de linha; replicamos isso para que a
    # âncora de linha do protocolo de checkpoint seja exercitada de verdade.
    def echo_input(prompt: str = "") -> str:
        print(prompt, end="")
        return "C" if "[A]bortar" in prompt else "A"
    monkeypatch.setattr("builtins.input", echo_input)
    monkeypatch.setattr(sys, "argv", ["local_agent", "--workspace", str(workspace), "--task", "altere a.py", "--produce-only", *extra_args])
    assert cli.main() == 0


# ============================================================
# Projeção pura do plano em checkpoint
# ============================================================

def test_build_planning_checkpoint_projects_plan_without_model_prose(tmp_path: Path) -> None:
    plan = bind_plan_to_task(
        parse_plan('{"objective":"x","actions":[{"kind":"edit","target":"calc.py"}],"impact_level":"workspace_only","risk_categories":[]}'),
        "corrija calc.py",
    )
    envelope = build_planning_checkpoint(plan, "corrija calc.py", tmp_path)

    assert envelope["schema_version"] == 1 and envelope["status"] == "checkpoint"
    handoff = envelope["handoff"]
    assert handoff["kind"] == "checkpoint_bundle"
    assert "/" not in handoff["reference"] and "\\" not in handoff["reference"] and handoff["reference"].endswith("-checkpoint.json")
    checkpoint = envelope["checkpoint"]
    # WorkCheckpointV1: subconjunto retomável, sem status/stopReason terminais.
    assert checkpoint["schemaVersion"] == 1
    assert checkpoint["completedSteps"] == ["Planejamento validado e vinculado à tarefa."]
    assert checkpoint["remainingSteps"] == [
        "Inspecionar os arquivos da workspace.",
        "Atualizar calc.py.",
        "Executar os testes Python no ambiente isolado.",
        "Revisar as alterações produzidas.",
    ]
    assert checkpoint["nextStep"] == "Inspecionar os arquivos da workspace."
    assert checkpoint["validations"] == [{"label": "planejamento validado", "outcome": "declared"}]
    assert checkpoint["touchedResources"] == [] and checkpoint["failures"] == []
    # Artefato retomável escrito e correlacionado por sha256.
    artifact = tmp_path / handoff["reference"]
    assert artifact.is_file()
    assert hashlib.sha256(artifact.read_bytes()).hexdigest() == handoff["sha256"]
    # Nenhum terminal fabricado, nenhum caminho absoluto, nenhum segredo.
    serialized = json.dumps(envelope, ensure_ascii=False)
    assert not any(token in serialized for token in FORBIDDEN_TERMINAL_TOKENS)
    assert "C:\\" not in serialized and "/home/" not in serialized


def test_starting_checkpoint_is_factual_and_contains_no_task_text(tmp_path: Path) -> None:
    task = "segredo apenas para a tarefa"
    envelope = build_starting_checkpoint(task, tmp_path)
    serialized = json.dumps(envelope, ensure_ascii=False)
    checkpoint = envelope["checkpoint"]
    assert envelope["status"] == "checkpoint"
    assert task not in serialized
    assert checkpoint["nextStep"] == "Preparar a workspace isolada."
    assert checkpoint["touchedResources"] == []


def test_model_planning_checkpoint_identifies_the_real_wait(tmp_path: Path) -> None:
    envelope = build_model_planning_checkpoint("tarefa", tmp_path)
    checkpoint = envelope["checkpoint"]
    assert checkpoint["nextStep"] == "Solicitar e validar o plano do modelo local."
    assert "Baseline da workspace capturado." in checkpoint["completedSteps"]


# ============================================================
# Emissão no fluxo real do runner (fake determinístico)
# ============================================================

def test_cli_emits_checkpoint_before_terminal_in_produce_only(monkeypatch, tmp_path: Path, capsys) -> None:
    _run_produce_only(monkeypatch, tmp_path, ["--emit-checkpoints"])
    out = capsys.readouterr().out
    checkpoint_lines = [line for line in out.splitlines() if line.startswith(CHECKPOINT_PREFIX)]
    result_lines = [line for line in out.splitlines() if line.startswith("ANIMA_RESULT_JSON=")]
    assert len(checkpoint_lines) == 3 and len(result_lines) == 1
    # O checkpoint precede o terminal: um processo morto entre eles preserva o checkpoint.
    assert out.index(checkpoint_lines[0]) < out.index(result_lines[0])
    starting = json.loads(checkpoint_lines[0].removeprefix(CHECKPOINT_PREFIX))
    assert starting["checkpoint"]["nextStep"] == "Preparar a workspace isolada."
    model_planning = json.loads(checkpoint_lines[1].removeprefix(CHECKPOINT_PREFIX))
    assert model_planning["checkpoint"]["nextStep"] == "Solicitar e validar o plano do modelo local."
    envelope = json.loads(checkpoint_lines[2].removeprefix(CHECKPOINT_PREFIX))
    assert envelope["status"] == "checkpoint"
    assert envelope["checkpoint"]["remainingSteps"] == [
        "Inspecionar os arquivos da workspace.",
        "Atualizar a.py.",
        "Executar os testes Python no ambiente isolado.",
        "Revisar as alterações produzidas.",
    ]
    assert not any(token in checkpoint_lines[0] for token in FORBIDDEN_TERMINAL_TOKENS)


def test_cli_without_flag_emits_no_checkpoint(monkeypatch, tmp_path: Path, capsys) -> None:
    _run_produce_only(monkeypatch, tmp_path, [])
    out = capsys.readouterr().out
    assert not any(line.startswith(CHECKPOINT_PREFIX) for line in out.splitlines())
    assert any(line.startswith("ANIMA_RESULT_JSON=") for line in out.splitlines())


# ============================================================
# Consumo do carriedContext na retomada
# ============================================================

def test_resumption_preamble_renders_context_never_terminal_vocabulary() -> None:
    assert resumption_preamble(None) == ""
    assert resumption_preamble({}) == ""
    text = resumption_preamble({
        "remainingSteps": ["Atualizar a.py."],
        "nextStep": "Inspecionar os arquivos da workspace.",
        "risks": ["cobertura parcial"],
        "previousFailures": ["AssertionError: 2 + 2 != 5"],
    })
    assert "[RETOMADA]" in text
    assert "Inspecionar os arquivos da workspace." in text
    assert "Atualizar a.py." in text
    assert "AssertionError: 2 + 2 != 5" in text
    assert "cobertura parcial" in text
    # O motivo do abandono não chega por contrato, então nenhum terminal é inventado.
    assert not any(token in text for token in FORBIDDEN_TERMINAL_TOKENS)


def test_carried_context_reaches_planner_and_executor(monkeypatch, tmp_path: Path) -> None:
    carried = json.dumps({
        "isNewAttempt": True, "continueFromCheckpoint": True,
        "remainingSteps": ["Atualizar a.py."], "nextStep": "Inspecionar os arquivos da workspace.",
        "risks": [], "touchedResources": ["a.py"], "previousFailures": ["AssertionError"],
    })
    _run_produce_only(monkeypatch, tmp_path, ["--carried-context", carried])
    assert any("[RETOMADA]" in prompt for prompt in FixCycleClient.seen_planning)
    assert any("[RETOMADA]" in prompt for prompt in FixCycleClient.seen_execution_user)


def test_absent_carried_context_keeps_cold_start(monkeypatch, tmp_path: Path) -> None:
    _run_produce_only(monkeypatch, tmp_path, [])
    assert not any("[RETOMADA]" in prompt for prompt in FixCycleClient.seen_planning)
    assert not any("[RETOMADA]" in prompt for prompt in FixCycleClient.seen_execution_user)
