from __future__ import annotations

import subprocess
from pathlib import Path

import pytest

from local_agent.agent import LocalAgent
from local_agent.planning import ActionKind, InvalidPlan, PLAN_SCHEMA, bind_plan_to_task, parse_plan, render_plan
from local_agent.runner import run_safe
from local_agent.sandbox import WorkspaceSandbox
from local_agent.snapshot import capture_snapshot, incremental_diff, snapshot_changes
from local_agent.tools import ToolBox


VALID = '{"objective":"multiplicacao","actions":[{"kind":"inspect","target":"workspace"},{"kind":"edit","target":"calculator.py"},{"kind":"test","target":"unit_tests"}],"impact_level":"workspace_only","risk_categories":["local_code_change","test_execution"]}'


def git(cwd: Path, *args: str) -> None:
    subprocess.run(["git", "-c", f"safe.directory={cwd}", *args], cwd=cwd, check=True, capture_output=True)


def repo(tmp_path: Path) -> Path:
    git(tmp_path, "init")
    (tmp_path / "a.py").write_text("x = 1\n")
    git(tmp_path, "add", "a.py")
    subprocess.run(["git", "-c", f"safe.directory={tmp_path}", "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-m", "baseline"], cwd=tmp_path, check=True, capture_output=True)
    return tmp_path


@pytest.mark.parametrize("content", [
    '{"objective":"x","actions":[],"impact_level":"done","risk_categories":[]}',
    '```json\n' + VALID + '\n```',
    VALID[:-1] + ',"result":"ok"}',
    '{"objective":"x","actions":[{"kind":"execute","target":"done"}],"impact_level":"workspace_only","risk_categories":[]}',
])
def test_plans_only_accept_structured_enums(content: str) -> None:
    with pytest.raises(InvalidPlan):
        parse_plan(content)


def test_all_plan_schemas_forbid_additional_properties() -> None:
    assert PLAN_SCHEMA["additionalProperties"] is False
    actions = PLAN_SCHEMA["properties"]["actions"]  # type: ignore[index]
    assert actions["items"]["additionalProperties"] is False  # type: ignore[index]


def test_card_is_application_rendered() -> None:
    plan = parse_plan(VALID)
    rendered = render_plan(plan, "texto secreto do usuário")
    assert plan.objective not in rendered
    assert rendered[0].startswith("Executar a tarefa")
    assert "Inspecionar os arquivos da workspace." in rendered


def test_named_files_are_bound_to_plan_and_unapproved_write_is_blocked(tmp_path: Path) -> None:
    plan = bind_plan_to_task(parse_plan(VALID), "altere calculator.py e test_calculator.py")
    edits = {a.target for a in plan.actions if a.kind is ActionKind.EDIT}
    assert edits == {"calculator.py", "test_calculator.py"}
    assert {ActionKind.INSPECT, ActionKind.TEST, ActionKind.REVIEW}.issubset({a.kind for a in plan.actions})
    box = ToolBox(WorkspaceSandbox(tmp_path), 1, 100)
    box.authorize_plan(edits)
    box.write_file("calculator.py", "ok")
    with pytest.raises(PermissionError):
        box.write_file("other.py", "bad")


class PlanningClient:
    calls = 0
    def chat(self, messages, tools=None, format=None):
        self.calls += 1
        return {"message": {"content": VALID}}


class ExplodingTools(ToolBox):
    def execute(self, name, args):
        raise AssertionError("tool before approval")


def test_planning_does_not_execute_tools(tmp_path: Path) -> None:
    client = PlanningClient()
    agent = LocalAgent(client, ExplodingTools(WorkspaceSandbox(tmp_path), 1, 100), 2)  # type: ignore[arg-type]
    assert agent.plan("some").impact_level.value == "workspace_only"
    assert client.calls == 1


class RepairingPlanningClient:
    def __init__(self): self.calls = 0
    def chat(self, messages, tools=None, format=None):
        self.calls += 1
        return {"message": {"content": "not-json" if self.calls < 3 else VALID}}


def test_planning_repairs_are_bounded_and_audited(tmp_path: Path) -> None:
    client = RepairingPlanningClient()
    agent = LocalAgent(client, ToolBox(WorkspaceSandbox(tmp_path), 1, 100), 2)  # type: ignore[arg-type]
    assert agent.plan("altere calculator.py").impact_level.value == "workspace_only"
    assert client.calls == 3
    assert [item["outcome"] for item in agent.structured_response_audit] == ["rejected", "rejected", "accepted"]


class InvalidPlanningClient:
    def chat(self, messages, tools=None, format=None):
        return {"message": {"content": "prefix " + VALID}}


def test_planning_rejects_after_three_ambiguous_responses(tmp_path: Path) -> None:
    agent = LocalAgent(InvalidPlanningClient(), ToolBox(WorkspaceSandbox(tmp_path), 1, 100), 2)  # type: ignore[arg-type]
    with pytest.raises(InvalidPlan):
        agent.plan("altere calculator.py")
    assert len(agent.structured_response_audit) == 3


def test_dirty_snapshot_denial_and_incremental_delta(tmp_path: Path) -> None:
    root = repo(tmp_path)
    (root / "a.py").write_text("x = 2\n")
    before = capture_snapshot(WorkspaceSandbox(root), 5, 5000)
    assert before.dirty and before.changed_paths == ["a.py"]
    assert capture_snapshot(WorkspaceSandbox(root), 5, 5000) == before
    (root / "a.py").write_text("x = 3\n")
    (root / "b.py").write_text("y = 3\n")
    after = capture_snapshot(WorkspaceSandbox(root), 5, 5000)
    assert snapshot_changes(before, after) == ["a.py", "b.py"]
    delta = incremental_diff(before, after)
    assert "-x = 2" in delta and "+x = 3" in delta and "b/b.py" in delta


def test_large_file_is_hashed_and_explicitly_not_retained(tmp_path: Path) -> None:
    root = repo(tmp_path)
    large = root / "large.bin"
    large.write_bytes(b"x" * 2_000_001)
    snap = capture_snapshot(WorkspaceSandbox(root), 5, 5000)
    assert snap.files["large.bin"].sha256
    assert "large.bin" in snap.content_not_retained


def test_git_safe_directory_is_scoped_to_command(tmp_path: Path) -> None:
    root = repo(tmp_path)
    before = subprocess.run(["git", "config", "--global", "--get-all", "safe.directory"], capture_output=True, text=True).stdout
    assert run_safe("git status --short", root, 5, 5000).exit_code == 0
    after = subprocess.run(["git", "config", "--global", "--get-all", "safe.directory"], capture_output=True, text=True).stdout
    assert before == after


def test_host_git_disables_fsmonitor_and_external_diff(tmp_path: Path) -> None:
    root = repo(tmp_path)
    git(root, "config", "core.fsmonitor", "definitely-not-a-command")
    git(root, "config", "diff.external", "definitely-not-a-command")
    assert run_safe("git status --short", root, 5, 5000).exit_code == 0
    assert run_safe("git diff", root, 5, 5000).exit_code == 0
