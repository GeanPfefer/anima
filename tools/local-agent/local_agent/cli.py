from __future__ import annotations

import argparse
from dataclasses import asdict
from datetime import datetime, timezone
import hashlib
import json
import re
from collections.abc import Sequence

from .agent import LocalAgent, review_read_only
from .checkpoint import build_model_planning_checkpoint, build_planning_checkpoint, build_starting_checkpoint, emit_checkpoint
from .config import Config
from .container import DockerExecutor, docker_available
from .execution import ApplyError, ApplyResult, ExecutionWorkspace, apply_changes, build_manifest, capture_complete_baseline, create_result_bundle
from .ollama import OllamaClient
from .planning import ActionKind, InvalidPlan, Plan, render_plan
from .sandbox import WorkspaceSandbox
from .snapshot import WorkspaceSnapshot, capture_snapshot
from .tools import ToolBox
from .workflow import RunGates


def sanitize_evidence(text: str, known_secrets: set[str] | None = None) -> str:
    for secret in sorted((value for value in (known_secrets or set()) if value), key=len, reverse=True):
        text = text.replace(secret, "[REDACTED]")
    patterns = [
        r"(?i)(token|secret|password|api[_-]?key)([\"']?\s*[:=]\s*[\"']?)[^\"'\s,}]+",
        r"(?i)bearer\s+[a-z0-9._-]+",
    ]
    for pattern in patterns:
        text = re.sub(pattern, lambda match: match.group(1) + "=[REDACTED]" if match.lastindex else "[REDACTED]", text)
    return text


def persist_failure_evidence(
    config: Config,
    task: str,
    plan: Plan,
    gates: RunGates,
    toolbox: ToolBox,
    reason: str,
    *,
    copy_manifest: Sequence[object] | None = None,
    manifest: Sequence[object] | None = None,
    structured_responses: Sequence[object] | None = None,
) -> object:
    gates.fail(reason)
    evidence = {
        "task_sha256": hashlib.sha256(task.encode()).hexdigest(),
        "plan": asdict(plan),
        "approval": "approved",
        "states": gates.history,
        "failure": {"reason": reason},
        "tools": toolbox.events,
        "structured_responses": structured_responses or [],
        "tests": toolbox.test_results,
        "copy_manifest": copy_manifest or [],
        "apply": {"status": "not_attempted", "manifest": manifest or [], "rollback_completed": False},
        "model_summary": {"displayed": False},
        "review_completed": False,
    }
    evidence_root = config.workspace.parent / ".anima-agent-evidence"
    evidence_root.mkdir(parents=True, exist_ok=True)
    log = evidence_root / (datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ") + "-failed.json")
    log.write_text(sanitize_evidence(json.dumps(evidence, indent=2, ensure_ascii=False, default=str), set(config.known_secrets)), encoding="utf-8")
    return log


def approval_card(plan: Plan, task: str) -> bool:
    rendered = render_plan(plan, task)
    print("\n=== APROVAÇÃO INICIAL ===")
    print("\nObjetivo:\n" + rendered[0])
    print("\nPlano:")
    for index, step in enumerate(rendered[1:-2], 1):
        print(f"{index}. {step}")
    print("\nImpacto:\n" + rendered[-2])
    print("\nRiscos:\n" + rendered[-1])
    answer = input("[A]provar / [N]egar / [O]utro: ").strip().lower()
    if answer.startswith("o"):
        print("Descreva a alteração de escopo e reinicie com a tarefa revisada.")
    return answer.startswith("a")


def dirty_workspace_choice(snapshot: WorkspaceSnapshot, automated: bool, allow_dirty: bool) -> bool:
    if not snapshot.dirty:
        return True
    print("\n=== WORKSPACE COM ALTERAÇÕES PREEXISTENTES ===")
    print(snapshot.status)
    if automated:
        return allow_dirty
    return input("[A]bortar / [C]ontinuar preservando / [N]ova workspace limpa: ").strip().lower().startswith("c")


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description="POC do agente local do Anima")
    result.add_argument("--workspace", required=True)
    result.add_argument("--model")
    result.add_argument("--task")
    result.add_argument("--allow-dirty", action="store_true")
    result.add_argument("--produce-only", action="store_true", help="Produz evidências e manifesto sem aplicar mudanças à workspace original.")
    result.add_argument("--emit-checkpoints", action="store_true", help="Emite checkpoints mid-flight retomáveis (AUTO-05) no protocolo ANIMA_CHECKPOINT_JSON=.")
    result.add_argument("--carried-context", help="JSON do carriedContext de uma retomada (AUTO-05): contexto de continuação, nunca instrução de domínio.")
    return result


def load_carried_context(raw: str | None) -> dict[str, object] | None:
    """Interpreta o carriedContext da retomada; ausência ou JSON inválido preserva o começo do zero."""
    if not raw:
        return None
    try:
        value = json.loads(raw)
    except ValueError:
        print("Contexto de retomada ignorado: JSON inválido.")
        return None
    return value if isinstance(value, dict) else None


def main() -> int:
    args = parser().parse_args()
    config = Config.load(args.workspace, args.model)
    client = OllamaClient(config.host, config.model)
    models = client.tags()
    print(f"Ollama conectado. Modelos locais: {', '.join(models) or '(nenhum)'}")
    task = args.task or input("Tarefa: ").strip()
    if not task:
        return 2
    carried_context = load_carried_context(args.carried_context)
    original_sandbox = WorkspaceSandbox(config.workspace)
    initial = capture_snapshot(original_sandbox, config.command_timeout, config.max_output)
    if args.emit_checkpoints:
        emit_checkpoint(build_starting_checkpoint(task, config.workspace.parent / ".anima-agent-evidence"))
    complete_baseline = capture_complete_baseline(config.workspace)
    if not dirty_workspace_choice(initial, args.allow_dirty, args.allow_dirty):
        print("Execução abortada antes do planejamento.")
        return 1
    if args.emit_checkpoints:
        emit_checkpoint(build_model_planning_checkpoint(task, config.workspace.parent / ".anima-agent-evidence"))
    planning_agent = LocalAgent(client, ToolBox(original_sandbox, config.command_timeout, config.max_output), config.max_iterations)
    try:
        plan = planning_agent.plan(task, carried_context=carried_context)
    except InvalidPlan as exc:
        print(f"Planejamento recusado: {exc}")
        return 2
    if not approval_card(plan, task):
        denied = capture_complete_baseline(config.workspace)
        if denied.files != complete_baseline.files:
            print("ALERTA: workspace mudou antes da aprovação.")
            return 4
        print("Execução negada. Snapshot inicial permaneceu intacto; baseline completo confirmado.")
        return 1
    if not docker_available():
        print("Docker indisponível. Execução segura recusada; não há fallback para o host.")
        return 5

    allowed = {action.target.replace("\\", "/") for action in plan.actions if action.kind is ActionKind.EDIT}
    gates = RunGates()
    gates.approve()
    with ExecutionWorkspace(config.workspace, config.workspace_limit_mb * 1024 * 1024) as execution:
        assert execution.root is not None
        executor = DockerExecutor(execution.root, config.command_timeout, config.max_output, workspace_limit_mb=config.workspace_limit_mb)
        toolbox = ToolBox(execution.sandbox, config.command_timeout, config.max_output, executor, set(config.known_secrets), config.test_command)
        toolbox.authorize_plan(allowed)
        agent = LocalAgent(client, toolbox, config.max_iterations, test_command=config.test_command)
        gates.start_editing()
        # Checkpoint mid-flight retomável: o plano validado, ANTES da edição.
        # Emitido aqui para que um processo que morra durante a execução do
        # modelo já tenha o checkpoint persistido pelo laço do Supervisor.
        if args.emit_checkpoints:
            emit_checkpoint(build_planning_checkpoint(plan, task, config.workspace.parent / ".anima-agent-evidence"))
        summary = agent.run(task, carried_context=carried_context)
        if summary.stopped_reason != "completed":
            tests_never_passed = summary.stopped_reason == "tests_never_passed"
            reason = "test_validation_failed" if tests_never_passed else "model_execution_" + summary.stopped_reason
            failed_log = persist_failure_evidence(config, task, plan, gates, toolbox, reason, copy_manifest=[asdict(item) for item in execution.records], structured_responses=[*planning_agent.structured_response_audit, *agent.structured_response_audit])
            print(f"Gate factual recusou aplicação: {reason}.")
            print(f"Evidência sanitizada: {failed_log}")
            return 6 if tests_never_passed else 7
        manifest = build_manifest(config.workspace, execution.root, complete_baseline, allowed)
        manifest_data = [asdict(item) for item in manifest]
        try:
            gates.require_tests(allowed, {item.path for item in manifest})
        except RuntimeError as exc:
            reason = "artifact_validation_failed"
            failed_log = persist_failure_evidence(config, task, plan, gates, toolbox, reason, copy_manifest=[asdict(item) for item in execution.records], manifest=manifest_data, structured_responses=[*planning_agent.structured_response_audit, *agent.structured_response_audit])
            print(f"Gate factual recusou aplicação: {exc}")
            print(f"Evidência sanitizada: {failed_log}")
            return 8
        test_payload = json.loads(toolbox.execute("run_tests", {"command": config.test_command}))
        test_code = int(test_payload["exit_code"])
        tests_count_value = toolbox.test_results[-1].get("tests_count")
        tests_count = int(tests_count_value) if isinstance(tests_count_value, int) else None
        try:
            gates.record_tests(test_code, tests_count)
        except RuntimeError as exc:
            failed_log = persist_failure_evidence(config, task, plan, gates, toolbox, "test_validation_failed", copy_manifest=[asdict(item) for item in execution.records], manifest=manifest_data, structured_responses=[*planning_agent.structured_response_audit, *agent.structured_response_audit])
            print(f"Gate factual recusou aplicação: {exc}")
            print(f"Evidência sanitizada: {failed_log}")
            return 6
        execution_diff = json.dumps(manifest_data, ensure_ascii=False)
        review_read_only(client, task, execution_diff, "Texto do modelo excluído do resultado factual.")
        gates.record_review()
        if args.produce_only:
            gates.result_produced()
            apply_outcome = ApplyResult("not_attempted", manifest, False)
        else:
            gates.ready()
            try:
                apply_outcome = apply_changes(config.workspace, execution.root, complete_baseline, allowed)
                gates.applied()
            except ApplyError as exc:
                apply_outcome = exc.result
                gates.rolled_back()
        apply_result = asdict(apply_outcome)

        final = capture_snapshot(original_sandbox, config.command_timeout, config.max_output)
        evidence_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
        evidence_root = config.workspace.parent / ".anima-agent-evidence"
        handoff = None
        if args.produce_only:
            bundle = create_result_bundle(evidence_root / f"{evidence_id}-result.zip", execution.root, manifest)
            handoff = {"kind": "result_bundle", "reference": bundle.reference, "sha256": bundle.sha256}
        evidence = {
            "task_sha256": hashlib.sha256(task.encode()).hexdigest(),
            "plan": asdict(plan), "approval": "approved", "states": gates.history,
            "tools": toolbox.events,
            "structured_responses": [*planning_agent.structured_response_audit, *agent.structured_response_audit],
            "model_summary": {"displayed": False, "sha256": hashlib.sha256(summary.final.encode()).hexdigest()},
            "tests": toolbox.test_results, "review_completed": True,
            "copy_manifest": [asdict(item) for item in execution.records],
            "mode": "produce_only" if args.produce_only else "apply",
            "handoff": handoff,
            "apply": apply_result, "initial_git_snapshot": initial.manifest(),
            "final_git_snapshot": final.manifest(), "incremental_diff": execution_diff,
        }
        evidence_root.mkdir(parents=True, exist_ok=True)
        log = evidence_root / f"{evidence_id}.json"
        log.write_text(sanitize_evidence(json.dumps(evidence, indent=2, ensure_ascii=False, default=str), set(config.known_secrets)), encoding="utf-8")
        print("\n=== RESULTADO FACTUAL ===")
        if apply_result["status"] == "applied":
            print(f"{len(apply_result['manifest'])} arquivos foram alterados.")
        else:
            print("Nenhuma alteração foi aplicada à workspace original.")
        print(f"{config.test_command} retornou código {test_code}.")
        print(f"Estado final: {gates.state.value}.")
        print(f"Evidência sanitizada: {log}")
        if args.produce_only:
            machine_result = {
                "schema_version": 1,
                "status": "result_produced",
                "evidence_reference": log.name,
                "produced_paths": [item.path for item in manifest],
                "handoff": handoff,
            }
            print("ANIMA_RESULT_JSON=" + json.dumps(machine_result, ensure_ascii=False, separators=(",", ":")))
        return 0 if gates.state.value in {"applied", "result_produced"} else 4
