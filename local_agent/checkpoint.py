from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

from .planning import Plan, render_plan

# Protocolo de saída do runner para um checkpoint mid-flight (INT-01 / AUTO-05).
#
# É análogo ao `ANIMA_RESULT_JSON=`, mas deliberadamente NÃO terminal: descreve
# um estado operacional retomável — aqui, o plano validado antes da fase de
# edição — nunca um desfecho. Não carrega `status`/`stopReason`, prosa do
# modelo, cadeia de pensamento nem segredos. O adaptador (LocalRunnerAdapter)
# transforma este envelope em um sinal `checkpoint` com `WorkCheckpointV1`, e o
# laço do Supervisor o persiste por `record_work_checkpoint` antes do terminal.
CHECKPOINT_PREFIX = "ANIMA_CHECKPOINT_JSON="

_PLANNING_DONE = "Planejamento validado e vinculado à tarefa."


def build_starting_checkpoint(task: str, evidence_root: Path) -> dict[str, object]:
    """Confirma o início antes da varredura e do primeiro pedido ao modelo."""
    snapshot = {"kind": "runner_starting_checkpoint", "task_sha256": hashlib.sha256(task.encode()).hexdigest()}
    body = json.dumps(snapshot, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    sha256 = hashlib.sha256(body).hexdigest()
    evidence_root.mkdir(parents=True, exist_ok=True)
    name = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ") + "-starting-checkpoint.json"
    (evidence_root / name).write_bytes(body)
    return {
        "schema_version": 1, "status": "checkpoint",
        "handoff": {"kind": "checkpoint_bundle", "reference": name, "sha256": sha256},
        "checkpoint": {
            "schemaVersion": 1,
            "completedSteps": ["Runner local iniciado e tarefa recebida."],
            "remainingSteps": ["Preparar a workspace isolada.", "Solicitar e validar o plano do modelo local."],
            "nextStep": "Preparar a workspace isolada.",
            "decisions": [], "risks": ["O planejamento local ainda não foi concluído."],
            "touchedResources": [],
            "validations": [{"label": "runner local iniciado", "outcome": "passed"}],
            "failures": [], "evidenceReferences": ["checkpoint-start:" + name],
        },
    }


def build_model_planning_checkpoint(task: str, evidence_root: Path) -> dict[str, object]:
    """Confirma que a leitura inicial terminou e que a espera passou ao modelo."""
    snapshot = {"kind": "model_planning_checkpoint", "task_sha256": hashlib.sha256(task.encode()).hexdigest()}
    body = json.dumps(snapshot, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    sha256 = hashlib.sha256(body).hexdigest()
    evidence_root.mkdir(parents=True, exist_ok=True)
    name = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ") + "-model-planning-checkpoint.json"
    (evidence_root / name).write_bytes(body)
    return {
        "schema_version": 1, "status": "checkpoint",
        "handoff": {"kind": "checkpoint_bundle", "reference": name, "sha256": sha256},
        "checkpoint": {
            "schemaVersion": 1,
            "completedSteps": ["Runner local iniciado.", "Baseline da workspace capturado."],
            "remainingSteps": ["Solicitar e validar o plano do modelo local."],
            "nextStep": "Solicitar e validar o plano do modelo local.",
            "decisions": [], "risks": ["O tempo desta fase depende da resposta do modelo local."],
            "touchedResources": [],
            "validations": [{"label": "baseline local capturado", "outcome": "passed"}],
            "failures": [], "evidenceReferences": ["checkpoint-model-planning:" + name],
        },
    }


def build_planning_checkpoint(plan: Plan, task: str, evidence_root: Path) -> dict[str, object]:
    """Projeta o `Plan` validado em um checkpoint retomável (subconjunto do WorkCheckpointV1).

    Só fatos do plano entram: os passos vêm dos templates fixos de `render_plan`
    (nunca da prosa do modelo), o artefato retomável é o plano estruturado
    serializado, e o handoff é uma referência opaca somada ao sha256 do
    artefato. Nada de `status`/`stopReason` terminais, cadeia de pensamento,
    credenciais ou caminho absoluto — a mesma régua que o servidor revalida.
    """
    rendered = render_plan(plan, task)  # [objetivo, *passos, impacto, riscos]
    steps = [step for step in rendered[1:-2] if step.strip()]
    risks_text = rendered[-1]
    snapshot = {
        "kind": "planning_checkpoint",
        "objective": rendered[0],
        "steps": steps,
        "actions": [{"kind": action.kind.value, "target": action.target} for action in plan.actions],
    }
    body = json.dumps(snapshot, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    sha256 = hashlib.sha256(body).hexdigest()
    evidence_root.mkdir(parents=True, exist_ok=True)
    name = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ") + "-checkpoint.json"
    (evidence_root / name).write_bytes(body)
    checkpoint = {
        "schemaVersion": 1,
        # completedSteps + remainingSteps > 0 é exigência do contrato: o plano
        # está feito, os passos do plano seguem por fazer.
        "completedSteps": [_PLANNING_DONE],
        "remainingSteps": steps,
        "nextStep": steps[0] if steps else "Inspecionar a workspace autorizada.",
        "decisions": [],
        "risks": [risks_text],
        # Nada foi editado ainda: o checkpoint pós-planejamento não afirma tocar
        # recurso algum. Isso é honesto e evita inventar trabalho concluído.
        "touchedResources": [],
        "validations": [{"label": "planejamento validado", "outcome": "declared"}],
        "failures": [],
        "evidenceReferences": ["checkpoint-plan:" + name],
    }
    return {
        "schema_version": 1,
        "status": "checkpoint",
        "handoff": {"kind": "checkpoint_bundle", "reference": name, "sha256": sha256},
        "checkpoint": checkpoint,
    }


def emit_checkpoint(envelope: dict[str, object]) -> None:
    """Imprime o envelope de checkpoint em uma linha de protocolo ancorada.

    O `\\n` inicial garante que a linha comece com o prefixo mesmo logo após o
    prompt de aprovação (`input()` não emite quebra de linha) — sem ele, o
    checkpoint sairia colado ao prompt e o adaptador não o reconheceria.
    """
    print("\n" + CHECKPOINT_PREFIX + json.dumps(envelope, ensure_ascii=False, separators=(",", ":")))
