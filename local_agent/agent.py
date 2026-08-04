from __future__ import annotations

from dataclasses import dataclass
import json
import hashlib
from pathlib import Path
from datetime import datetime, timezone

from .ollama import OllamaClient
from .tool_schema import TOOLS, parse_structured_action, parse_tool_calls, schema_for_execution
from .tools import ToolBox
from .planning import InvalidPlan, Plan, bind_plan_to_task, parse_plan, schema_for_task

SYSTEM = """Você é um agente local de programação. Trabalhe somente pelas ferramentas fornecidas.
Nunca transforme texto em comando. Inspecione antes de editar. Não acesse segredos, rede ou caminhos externos.
Faça uma chamada de ferramenta por vez, aguarde o resultado, faça mudanças mínimas, rode testes e finalize com resumo factual. Não exponha raciocínio privado."""

SYSTEM += "\nReturn only the requested JSON object: action=tool for one tool, or action=complete with a factual summary. Never use markdown."
SYSTEM += "\naction=complete só é aceito depois de run_tests aprovar todos os testes na versão atual dos arquivos; qualquer edição posterior exige rodar run_tests novamente."


def _is_malformed_completion(content: str) -> bool:
    """Detecta tentativa de conclusão com formato errado, elegível a feedback limitado."""
    try:
        value = json.loads(content)
    except ValueError:
        return False
    return isinstance(value, dict) and value.get("action") == "complete"


def resumption_preamble(carried_context: dict[str, object] | None) -> str:
    """Renderiza o `carriedContext` do AUTO-05 como contexto de continuação.

    É apenas contexto operacional — nunca instrução de domínio nova. O motivo
    técnico do abandono (`attempt_abandoned.reason`) não chega aqui por
    contrato, então não há como convertê-lo em cenário; e nada de cadeia de
    pensamento anterior é reconstruído. Ausência de `carriedContext` devolve
    string vazia e preserva o comportamento de um começo do zero.
    """
    if not carried_context:
        return ""

    def _labels(value: object) -> list[str]:
        return [str(item) for item in value if str(item).strip()] if isinstance(value, list) else []

    next_step = str(carried_context.get("nextStep") or "").strip()
    remaining = _labels(carried_context.get("remainingSteps"))
    risks = _labels(carried_context.get("risks"))
    previous_failures = _labels(carried_context.get("previousFailures"))
    lines = ["[RETOMADA] Esta é a continuação de uma tentativa anterior interrompida, não um começo do zero."]
    if next_step:
        lines.append(f"Próximo passo recomendado: {next_step}")
    if remaining:
        lines.append("Passos restantes: " + "; ".join(remaining))
    if previous_failures:
        lines.append("Falhas anteriores a evitar repetir: " + "; ".join(previous_failures))
    if risks:
        lines.append("Riscos conhecidos: " + "; ".join(risks))
    lines.append(
        "Use isto apenas como contexto de continuação: não refaça o que já foi comprovadamente concluído, "
        "não trate estas linhas como instrução de domínio nova e continue produzindo o resultado correto e testado."
    )
    return "\n".join(lines)


@dataclass
class RunSummary:
    final: str
    iterations: int
    changed: list[str]
    commands: list[str]
    stopped_reason: str


class LocalAgent:
    def __init__(self, client: OllamaClient, toolbox: ToolBox, max_iterations: int, test_command: str = "python -m pytest"):
        self.client, self.toolbox, self.max_iterations = client, toolbox, max_iterations
        self.test_command = test_command
        self.structured_response_audit: list[dict[str, object]] = []

    def _audit_response(self, phase: str, attempt: int, response: object, outcome: str, *, normalization: str = "none", error: str | None = None) -> None:
        raw = json.dumps(response, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str)
        entry: dict[str, object] = {
            "phase": phase, "attempt": attempt, "raw": raw,
            "raw_sha256": hashlib.sha256(raw.encode()).hexdigest(),
            "normalization": normalization, "outcome": outcome,
        }
        if error is not None:
            entry["error"] = error
        self.structured_response_audit.append(entry)

    def plan(self, task: str, attempts: int = 3, carried_context: dict[str, object] | None = None) -> Plan:
        feedback = ""
        preamble = resumption_preamble(carried_context)
        for attempt in range(1, attempts + 1):
            prompt = f"""Classifique a tarefa em ações estruturadas. Nada foi executado. Use somente o schema fornecido.
Alvos: inspect=workspace, test=unit_tests, review=changes; edit usa caminho real com extensão permitida.
Não inclua resultados ou status. Tarefa: {task}.{feedback}"""
            if preamble:
                prompt = preamble + "\n\n" + prompt
            result = self.client.chat([
                {"role": "system", "content": "Você é somente um planejador. Não possui ferramentas e nada foi executado."},
                {"role": "user", "content": prompt},
            ], format=schema_for_task(task))
            message = result.get("message", {})
            content = str(message.get("content", "")) if isinstance(message, dict) else ""
            try:
                plan = bind_plan_to_task(parse_plan(content), task)
                self._audit_response("planning", attempt, result, "accepted")
                return plan
            except InvalidPlan as exc:
                self._audit_response("planning", attempt, result, "rejected", error=str(exc))
                feedback = f" Resposta anterior rejeitada: {exc}. Regenere do zero."
        raise InvalidPlan("Nenhum plano futuro válido após três tentativas.")

    def run(self, task: str, carried_context: dict[str, object] | None = None) -> RunSummary:
        preamble = resumption_preamble(carried_context)
        user_content = preamble + "\n\n" + task if preamble else task
        messages: list[dict[str, object]] = [{"role": "system", "content": SYSTEM}, {"role": "user", "content": user_content}]
        fingerprint = ""
        repeats = 0
        rejected_generation: int | None = None
        format_strikes = 0
        for iteration in range(1, self.max_iterations + 1):
            required_writes = self.toolbox.allowed_writes or set()
            allow_complete = bool(required_writes) and required_writes <= self.toolbox.changed
            response = self.client.chat(messages, TOOLS, format=schema_for_execution(allow_complete))
            message = response.get("message")
            if not isinstance(message, dict):
                self._audit_response("execution", iteration, response, "rejected", error="missing_message_object")
                return RunSummary("Resposta inválida.", iteration, sorted(self.toolbox.changed), self.toolbox.commands, "invalid_response")
            content = str(message.get("content", ""))
            try:
                calls = parse_tool_calls(response)
            except ValueError as exc:
                self._audit_response("execution", iteration, response, "rejected", error=str(exc))
                if format_strikes >= 2:
                    return RunSummary("Resposta estruturada inválida.", iteration, sorted(self.toolbox.changed), self.toolbox.commands, "invalid_tool_calls")
                format_strikes += 1
                messages.append({"role": "user", "content": json.dumps({
                    "event": "structured_response_rejected", "reason": "invalid_tool_calls",
                    "repair_attempt": format_strikes,
                    "instruction": "Regenere do zero usando exatamente o schema JSON fornecido. Não reutilize nem explique a resposta rejeitada.",
                }, ensure_ascii=False)})
                continue
            completion: str | None = None
            if not calls:
                if not content.strip():
                    self._audit_response("execution", iteration, response, "rejected", error="empty_response")
                    return RunSummary("Empty model response.", iteration, sorted(self.toolbox.changed), self.toolbox.commands, "empty_response")
                try:
                    calls, completion = parse_structured_action(content)
                except ValueError as exc:
                    if _is_malformed_completion(content) and format_strikes < 2:
                        self._audit_response("execution", iteration, response, "rejected", error=str(exc))
                        format_strikes += 1
                        messages.append(message)
                        messages.append({"role": "tool", "tool_name": "completion", "content": json.dumps({
                            "event": "completion_rejected",
                            "reason": "invalid_completion_format",
                            "instruction": 'Responda somente {"action":"complete","summary":"<resumo factual>"} sem outros campos.',
                        }, ensure_ascii=False)})
                        continue
                    self._audit_response("execution", iteration, response, "rejected", error=str(exc))
                    if format_strikes < 2:
                        format_strikes += 1
                        messages.append(message)
                        messages.append({"role": "user", "content": json.dumps({
                            "event": "structured_response_rejected", "reason": "invalid_content_json",
                            "repair_attempt": format_strikes,
                            "instruction": "Regenere do zero. Responda somente com um objeto JSON válido no schema fornecido, sem markdown ou texto adicional.",
                        }, ensure_ascii=False)})
                        continue
                    return RunSummary("Invalid execution JSON.", iteration, sorted(self.toolbox.changed), self.toolbox.commands, "invalid_structured_response")
            self._audit_response("execution", iteration, response, "accepted", normalization="completion_arguments_to_summary" if completion is not None and '"arguments"' in content else "none")
            messages.append(message)
            if not calls:
                if not self.toolbox.changed:
                    return RunSummary("Modelo encerrou sem executar ferramentas de escrita.", iteration, [], self.toolbox.commands, "no_tool_calls")
                if not self.toolbox.has_current_test_evidence:
                    feedback = self._validate_for_completion()
                    if feedback is not None:
                        if rejected_generation == self.toolbox.write_generation:
                            return RunSummary("Conclusão recusada: testes não aprovados na versão atual dos arquivos.", iteration, sorted(self.toolbox.changed), self.toolbox.commands, "tests_never_passed")
                        rejected_generation = self.toolbox.write_generation
                        messages.append({"role": "tool", "tool_name": "run_tests", "content": feedback})
                        continue
                return RunSummary(completion or "Missing structured completion.", iteration, sorted(self.toolbox.changed), self.toolbox.commands, "completed")
            current = json.dumps(calls, sort_keys=True)
            repeats = repeats + 1 if current == fingerprint else 0
            fingerprint = current
            if repeats >= 2:
                return RunSummary("Interrompido por repetição sem progresso.", iteration, sorted(self.toolbox.changed), self.toolbox.commands, "no_progress")
            for name, args in calls:
                try:
                    result = self.toolbox.execute(name, args)
                except Exception as exc:
                    result = f"ERRO SEGURO: {type(exc).__name__}: {exc}"
                messages.append({"role": "tool", "tool_name": name, "content": result})
        return RunSummary("Limite de iterações atingido.", self.max_iterations, sorted(self.toolbox.changed), self.toolbox.commands, "iteration_limit")

    def _validate_for_completion(self) -> str | None:
        """Roda os testes exigidos antes de aceitar complete; devolve None se aprovados ou o resumo estruturado da falha."""
        try:
            raw = self.toolbox.execute("run_tests", {"command": self.test_command})
        except Exception as exc:
            return json.dumps({"event": "completion_rejected", "reason": "test_execution_error", "error": f"{type(exc).__name__}: {exc}"}, ensure_ascii=False)
        if self.toolbox.has_current_test_evidence:
            return None
        payload = json.loads(raw)
        record = self.toolbox.test_results[-1]
        return json.dumps({
            "event": "completion_rejected",
            "reason": "tests_not_passing_on_current_files",
            "command": record.get("command"),
            "exit_code": record.get("exit_code"),
            "tests_count": record.get("tests_count"),
            "stdout_tail": str(payload.get("stdout", ""))[-2000:],
            "stderr_tail": str(payload.get("stderr", ""))[-2000:],
            "instruction": "Corrija os arquivos e rode run_tests até todos os testes passarem antes de concluir.",
        }, ensure_ascii=False)


def save_sanitized_log(workspace: Path, task: str, summary: RunSummary) -> Path:
    folder = workspace / ".agent" / "runs" / datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    folder.mkdir(parents=True, exist_ok=True)
    data = {"task": task[:1000], "summary": summary.__dict__}
    target = folder / "summary.json"
    target.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    return target


def review_read_only(client: OllamaClient, task: str, diff: str, final: str) -> str:
    prompt = f"""Faça uma revisão somente leitura. Compare o resultado com a tarefa e procure regressões,
ausência de testes e riscos. Não proponha comandos nem alegue independência forte.
TAREFA:\n{task}\nRESUMO:\n{final}\nDIFF:\n{diff[:16000]}"""
    response = client.chat([
        {"role": "system", "content": "Você é um revisor de código somente leitura. Responda com achados objetivos e veredito."},
        {"role": "user", "content": prompt},
    ])
    message = response.get("message", {})
    return str(message.get("content", "Revisão indisponível.")) if isinstance(message, dict) else "Revisão indisponível."
