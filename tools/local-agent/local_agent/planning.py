from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
import copy
import json
import re


class ActionKind(StrEnum):
    INSPECT = "inspect"
    EDIT = "edit"
    TEST = "test"
    REVIEW = "review"


class ImpactLevel(StrEnum):
    WORKSPACE_ONLY = "workspace_only"


class RiskCategory(StrEnum):
    LOCAL_CODE_CHANGE = "local_code_change"
    TEST_EXECUTION = "test_execution"
    FILE_REPLACEMENT = "file_replacement"


PLAN_SCHEMA: dict[str, object] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["objective", "actions", "impact_level", "risk_categories"],
    "properties": {
        "objective": {"type": "string", "maxLength": 200},
        "actions": {
            "type": "array", "minItems": 1, "maxItems": 12,
            "items": {
                "type": "object", "additionalProperties": False, "required": ["kind", "target"],
                "properties": {
                    "kind": {"type": "string", "enum": [x.value for x in ActionKind]},
                    "target": {"type": "string", "enum": ["workspace", "unit_tests", "changes"]},
                },
            },
        },
        "impact_level": {"type": "string", "enum": [x.value for x in ImpactLevel]},
        "risk_categories": {
            "type": "array", "uniqueItems": True,
            "items": {"type": "string", "enum": [x.value for x in RiskCategory]},
        },
    },
}


def schema_for_task(task: str) -> dict[str, object]:
    schema = copy.deepcopy(PLAN_SCHEMA)
    files = sorted(set(re.findall(r"(?:[\w().-]+[\\/])*[\w().-]+\.(?:py|toml|txt|md|json|yaml|yml)", task, re.UNICODE)))
    target = schema["properties"]["actions"]["items"]["properties"]["target"]  # type: ignore[index]
    target["enum"] = ["workspace", "unit_tests", "changes", *files]
    return schema


def files_for_task(task: str) -> tuple[str, ...]:
    return tuple(sorted(set(re.findall(r"(?:[\w().-]+[\\/])*[\w().-]+\.(?:py|toml|txt|md|json|yaml|yml)", task, re.UNICODE))))


def bind_plan_to_task(plan: Plan, task: str) -> Plan:
    existing = {action.target for action in plan.actions if action.kind is ActionKind.EDIT}
    for name in files_for_task(task):
        existing.add(name)
    actions = [PlannedAction(ActionKind.INSPECT, "workspace")]
    actions.extend(PlannedAction(ActionKind.EDIT, name) for name in sorted(existing))
    actions.append(PlannedAction(ActionKind.TEST, "unit_tests"))
    actions.append(PlannedAction(ActionKind.REVIEW, "changes"))
    return Plan(plan.objective, tuple(actions), plan.impact_level, plan.risk_categories)


class InvalidPlan(ValueError):
    pass


@dataclass(frozen=True)
class PlannedAction:
    kind: ActionKind
    target: str


@dataclass(frozen=True)
class Plan:
    objective: str
    actions: tuple[PlannedAction, ...]
    impact_level: ImpactLevel
    risk_categories: tuple[RiskCategory, ...]


def _safe_label(value: object) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > 200:
        raise InvalidPlan("Alvo inválido.")
    if not re.fullmatch(r"[\w .\\/()\-]+", value, re.UNICODE) or ".." in value:
        raise InvalidPlan("Alvo contém caracteres ou traversal não permitidos.")
    return value.strip()


def parse_plan(content: str) -> Plan:
    if "```" in content:
        raise InvalidPlan("Código não é aceito no planejamento.")
    try:
        value = json.loads(content)
    except ValueError as exc:
        raise InvalidPlan("O plano precisa ser JSON puro.") from exc
    if not isinstance(value, dict) or set(value) != {"objective", "actions", "impact_level", "risk_categories"}:
        raise InvalidPlan("Campos do plano inválidos.")
    objective_value = value["objective"]
    if not isinstance(objective_value, str) or not objective_value.strip() or len(objective_value) > 200 or any(ch in objective_value for ch in "\r\n`"):
        raise InvalidPlan("Rótulo de objetivo inválido.")
    objective = objective_value.strip()
    raw_actions = value["actions"]
    if not isinstance(raw_actions, list) or not 1 <= len(raw_actions) <= 12:
        raise InvalidPlan("Quantidade de ações inválida.")
    actions: list[PlannedAction] = []
    for raw in raw_actions:
        if not isinstance(raw, dict) or set(raw) != {"kind", "target"}:
            raise InvalidPlan("Schema de ação inválido.")
        try:
            kind = ActionKind(raw["kind"])
        except (ValueError, TypeError) as exc:
            raise InvalidPlan("Tipo de ação desconhecido.") from exc
        target = _safe_label(raw["target"])
        if kind is ActionKind.INSPECT:
            target = "workspace"
        if kind is ActionKind.TEST:
            target = "unit_tests"
        if kind is ActionKind.REVIEW:
            target = "changes"
        if kind is ActionKind.EDIT and not re.fullmatch(r"[\w .\\/()\-]+\.(py|toml|txt|md|json|yaml|yml)", target, re.UNICODE):
            raise InvalidPlan("Edição exige caminho de arquivo permitido.")
        actions.append(PlannedAction(kind, target))
    try:
        impact = ImpactLevel(value["impact_level"])
        raw_risks = value["risk_categories"]
        if not isinstance(raw_risks, list) or len(raw_risks) != len(set(raw_risks)):
            raise InvalidPlan("Riscos inválidos.")
        risks = tuple(RiskCategory(x) for x in raw_risks)
    except (ValueError, TypeError) as exc:
        raise InvalidPlan("Enum inválido no plano.") from exc
    return Plan(objective, tuple(actions), impact, risks)


ACTION_TEMPLATES = {
    ActionKind.INSPECT: "Inspecionar os arquivos da workspace.",
    ActionKind.EDIT: "Atualizar {target}.",
    ActionKind.TEST: "Executar os testes Python no ambiente isolado.",
    ActionKind.REVIEW: "Revisar as alterações produzidas.",
}


def render_plan(plan: Plan, user_task: str) -> list[str]:
    # The objective comes from the user's own task, never model prose.
    objective = "Executar a tarefa solicitada somente na workspace autorizada."
    steps = [ACTION_TEMPLATES[action.kind].format(target=action.target) for action in plan.actions]
    impact = "Somente arquivos da workspace autorizada poderão ser alterados."
    risks = "Possíveis alterações locais incorretas; testes e revisão serão executados antes da conclusão."
    return [objective, *steps, impact, risks]
