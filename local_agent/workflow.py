from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum


class RunState(StrEnum):
    PLANNED = "planned"
    APPROVED = "approved"
    EDITING = "editing"
    TESTS_REQUIRED = "tests_required"
    TESTS_PASSED = "tests_passed"
    REVIEW_COMPLETED = "review_completed"
    RESULT_PRODUCED = "result_produced"
    READY_TO_APPLY = "ready_to_apply"
    APPLIED = "applied"
    ROLLED_BACK = "rolled_back"
    FAILED = "failed"


@dataclass
class RunGates:
    state: RunState = RunState.PLANNED
    history: list[str] = field(default_factory=lambda: [RunState.PLANNED.value])
    changed: bool = False
    tests_exit_code: int | None = None
    review_done: bool = False
    changes_verified: bool = False
    tests_count: int | None = None
    failure_reason: str | None = None

    def _move(self, expected: set[RunState], target: RunState) -> None:
        if self.state not in expected:
            raise RuntimeError(f"Transição inválida: {self.state.value} -> {target.value}")
        self.state = target
        self.history.append(target.value)

    def approve(self) -> None:
        self._move({RunState.PLANNED}, RunState.APPROVED)

    def start_editing(self) -> None:
        self._move({RunState.APPROVED}, RunState.EDITING)

    def require_tests(self, expected_paths: set[str], actual_paths: set[str]) -> None:
        missing = sorted(expected_paths - actual_paths)
        unexpected = sorted(actual_paths - expected_paths)
        if missing or unexpected or not actual_paths:
            details = []
            if missing:
                details.append("ausentes=" + ",".join(missing))
            if unexpected:
                details.append("não_planejados=" + ",".join(unexpected))
            if not actual_paths:
                details.append("manifest_vazio")
            raise RuntimeError("Gate de artefatos falhou: " + "; ".join(details))
        self.changed = True
        self.changes_verified = True
        self._move({RunState.EDITING}, RunState.TESTS_REQUIRED)

    def record_tests(self, exit_code: int, tests_count: int | None) -> None:
        self.tests_exit_code = exit_code
        self.tests_count = tests_count
        if exit_code != 0:
            raise RuntimeError(f"Gate de testes falhou com código {exit_code}.")
        if tests_count is None:
            raise RuntimeError("Gate de testes falhou: quantidade de testes não comprovada.")
        if tests_count == 0:
            raise RuntimeError("Gate de testes falhou: zero testes executados.")
        self._move({RunState.TESTS_REQUIRED}, RunState.TESTS_PASSED)

    def record_review(self) -> None:
        if self.tests_exit_code != 0:
            raise RuntimeError("Revisão não substitui testes aprovados.")
        self.review_done = True
        self._move({RunState.TESTS_PASSED}, RunState.REVIEW_COMPLETED)

    def ready(self) -> None:
        if not self.changed or not self.changes_verified:
            raise RuntimeError("Aplicação exige alterações planejadas verificadas.")
        if self.tests_exit_code is None or self.tests_exit_code != 0 or not self.tests_count:
            raise RuntimeError("Alterações não podem ser aplicadas sem testes factuais.")
        if not self.review_done:
            raise RuntimeError("Revisão obrigatória ausente.")
        self._move({RunState.REVIEW_COMPLETED}, RunState.READY_TO_APPLY)

    def result_produced(self) -> None:
        if not self.changed or not self.changes_verified:
            raise RuntimeError("Resultado exige alterações planejadas verificadas.")
        if self.tests_exit_code is None or self.tests_exit_code != 0 or not self.tests_count:
            raise RuntimeError("Resultado não pode ser produzido sem testes factuais.")
        if not self.review_done:
            raise RuntimeError("Revisão obrigatória ausente.")
        self._move({RunState.REVIEW_COMPLETED}, RunState.RESULT_PRODUCED)

    def applied(self) -> None:
        self._move({RunState.READY_TO_APPLY}, RunState.APPLIED)

    def rolled_back(self) -> None:
        self.state = RunState.ROLLED_BACK
        self.history.append(RunState.ROLLED_BACK.value)

    def fail(self, reason: str) -> None:
        self.failure_reason = reason
        self.state = RunState.FAILED
        self.history.append(RunState.FAILED.value)
