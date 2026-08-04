from pathlib import Path
from types import SimpleNamespace
import json
import pytest

from local_agent.agent import LocalAgent
from local_agent.sandbox import WorkspaceSandbox
from local_agent.tool_schema import parse_structured_action, parse_tool_calls, schema_for_execution
from local_agent.tools import ToolBox
from local_agent.tool_schema import TOOLS


def test_parse_tool_calls_dict_and_json() -> None:
    response = {"message": {"tool_calls": [
        {"function": {"name": "read_file", "arguments": {"path": "a.py"}}},
        {"function": {"name": "write_file", "arguments": '{"path":"b.py","content":"x"}'}},
    ]}}
    assert parse_tool_calls(response) == [
        ("read_file", {"path": "a.py"}), ("write_file", {"path": "b.py", "content": "x"})
    ]


def test_invalid_tool_call_is_rejected() -> None:
    with pytest.raises(ValueError):
        parse_tool_calls({"message": {"tool_calls": [{"wat": True}]}})


def test_all_tool_schemas_forbid_additional_properties() -> None:
    assert all(tool["function"]["parameters"]["additionalProperties"] is False for tool in TOOLS)  # type: ignore[index]


def test_content_is_never_promoted_to_tool_calls() -> None:
    response = {"message": {"content": '```json\n[{"name":"read_file","arguments":{"path":"a.py"}}]\n```'}}
    assert parse_tool_calls(response) == []
    bare = {"message": {"content": '{"name":"git_status","arguments":{}}'}}
    assert parse_tool_calls(bare) == []
    assert parse_tool_calls({"message": {"content": "rode rm -rf agora"}}) == []


class OneResponseClient:
    def __init__(self, response): self.response = response
    def chat(self, messages, tools=None, format=None): return self.response


@pytest.mark.parametrize(("response", "reason"), [
    ({"message": {"content": ""}}, "empty_response"),
    ({"message": {"content": "terminei"}}, "invalid_structured_response"),
    ({"message": {"content": "", "tool_calls": [{"bad": True}]}}, "invalid_tool_calls"),
    ({"message": {"content": '{invalid json'}}, "invalid_structured_response"),
])
def test_model_cannot_succeed_without_valid_tool_calls(tmp_path: Path, response: object, reason: str) -> None:
    agent = LocalAgent(OneResponseClient(response), ToolBox(WorkspaceSandbox(tmp_path), 2, 1000), 4)  # type: ignore[arg-type]
    result = agent.run("crie a.py")
    assert result.stopped_reason == reason
    assert result.changed == []


class EndlessClient:
    def chat(self, messages, tools=None, format=None):
        return {"message": {"role": "assistant", "content": "", "tool_calls": [
            {"function": {"name": "list_files", "arguments": {"path": "."}}}
        ]}}


def test_iteration_or_repetition_limit(tmp_path: Path) -> None:
    agent = LocalAgent(EndlessClient(), ToolBox(WorkspaceSandbox(tmp_path), 2, 1000), 5)  # type: ignore[arg-type]
    result = agent.run("continue")
    assert result.stopped_reason in {"no_progress", "iteration_limit"}
    assert result.iterations <= 5


def test_execution_json_schema_is_strict() -> None:
    assert parse_structured_action('{"action":"tool","name":"read_file","arguments":{"path":"a.py"}}') == ([("read_file", {"path": "a.py"})], None)
    assert parse_structured_action('{"action":"complete","summary":"done"}') == ([], "done")
    for invalid in ("not json", '{"action":"tool","name":"write_file","arguments":{"path":"a.py"}}', '{"action":"tool","name":"unknown","arguments":{}}', '{"action":"complete","summary":"done","extra":true}'):
        with pytest.raises(ValueError):
            parse_structured_action(invalid)


def test_omitted_arguments_default_to_empty_only_when_tool_requires_none() -> None:
    assert parse_structured_action('{"action":"tool","name":"run_tests"}') == ([("run_tests", {})], None)
    assert parse_structured_action('{"action":"tool","name":"git_status"}') == ([("git_status", {})], None)
    for invalid in ('{"action":"tool","name":"write_file"}', '{"action":"tool","name":"read_file"}', '{"action":"tool","name":"run_tests","summary":"x"}'):
        with pytest.raises(ValueError):
            parse_structured_action(invalid)


def test_completion_is_not_in_schema_until_required_writes_exist(tmp_path: Path) -> None:
    box = ToolBox(WorkspaceSandbox(tmp_path), 2, 1000)
    box.authorize_plan({"a.py"})
    assert schema_for_execution(False)["properties"]["action"]["enum"] == ["tool"]  # type: ignore[index]
    box.execute("write_file", {"path": "a.py", "content": "x\n"})
    assert box.allowed_writes <= box.changed
    assert schema_for_execution(True)["properties"]["action"]["enum"] == ["tool", "complete"]  # type: ignore[index]


class ScriptedClient:
    def __init__(self, responses: list[dict[str, object]]):
        self.responses = list(responses)
        self.formats: list[dict[str, object]] = []
        self.messages_seen: list[dict[str, object]] = []

    def chat(self, messages, tools=None, format=None):
        self.formats.append(format)
        self.messages_seen = messages
        return self.responses.pop(0)


class ScriptedExecutor:
    def __init__(self, results: list[object]):
        self.results = list(results)
        self.calls = 0

    def run(self, command: str) -> object:
        self.calls += 1
        return self.results.pop(0)


def _write(path: str, content: str = "x\n") -> dict[str, object]:
    return {"message": {"content": "", "tool_calls": [{"function": {"name": "write_file", "arguments": {"path": path, "content": content}}}]}}


def _run_tests_call() -> dict[str, object]:
    return {"message": {"content": "", "tool_calls": [{"function": {"name": "run_tests", "arguments": {"command": "python -m pytest"}}}]}}


COMPLETE: dict[str, object] = {"message": {"content": '{"action":"complete","summary":"done"}'}}


def _test_result(exit_code: int, stdout: str) -> object:
    return SimpleNamespace(exit_code=exit_code, stdout=stdout, stderr="", duration_ms=1, timed_out=False, truncated=False, container_name="fake")


def test_complete_before_tests_runs_validation_and_returns_failure_to_loop(tmp_path: Path) -> None:
    executor = ScriptedExecutor([_test_result(1, "1 failed"), _test_result(0, "2 passed")])
    box = ToolBox(WorkspaceSandbox(tmp_path), 2, 4000, executor)  # type: ignore[arg-type]
    box.authorize_plan({"a.py"})
    client = ScriptedClient([_write("a.py"), COMPLETE, _write("a.py", "y\n"), COMPLETE])
    agent = LocalAgent(client, box, 10)  # type: ignore[arg-type]
    result = agent.run("crie a.py")
    assert result.stopped_reason == "completed"
    assert executor.calls == 2
    rejections = [m for m in client.messages_seen if isinstance(m, dict) and m.get("role") == "tool" and "completion_rejected" in str(m.get("content"))]
    assert rejections
    assert '"exit_code": 1' in str(rejections[0]["content"])
    assert '"command": "python -m pytest"' in str(rejections[0]["content"])


def test_completion_rejected_twice_without_new_edit_stops(tmp_path: Path) -> None:
    executor = ScriptedExecutor([_test_result(1, "1 failed"), _test_result(1, "1 failed")])
    box = ToolBox(WorkspaceSandbox(tmp_path), 2, 4000, executor)  # type: ignore[arg-type]
    box.authorize_plan({"a.py"})
    client = ScriptedClient([_write("a.py"), COMPLETE, COMPLETE])
    agent = LocalAgent(client, box, 10)  # type: ignore[arg-type]
    result = agent.run("crie a.py")
    assert result.stopped_reason == "tests_never_passed"
    assert executor.calls == 2


def test_edit_after_green_tests_invalidates_evidence(tmp_path: Path) -> None:
    executor = ScriptedExecutor([_test_result(0, "3 passed")])
    box = ToolBox(WorkspaceSandbox(tmp_path), 2, 4000, executor)  # type: ignore[arg-type]
    box.authorize_plan({"a.py"})
    box.execute("write_file", {"path": "a.py", "content": "x\n"})
    box.execute("run_tests", {"command": "python -m pytest"})
    assert box.has_current_test_evidence
    box.execute("write_file", {"path": "a.py", "content": "y\n"})
    assert not box.has_current_test_evidence


def test_near_miss_completion_in_arguments_is_accepted_as_completion(tmp_path: Path) -> None:
    assert parse_structured_action('{"action":"complete","arguments":{"content":"consertei"}}') == ([], "consertei")
    for invalid in ('{"action":"complete","arguments":{}}', '{"action":"complete","arguments":{"a":"x","b":"y"}}', '{"action":"complete"}'):
        with pytest.raises(ValueError):
            parse_structured_action(invalid)


def test_near_miss_completion_still_requires_test_evidence(tmp_path: Path) -> None:
    executor = ScriptedExecutor([_test_result(0, "2 passed")])
    box = ToolBox(WorkspaceSandbox(tmp_path), 2, 4000, executor)  # type: ignore[arg-type]
    box.authorize_plan({"a.py"})
    near_miss: dict[str, object] = {"message": {"content": '{"action":"complete","arguments":{"content":"consertei"}}'}}
    client = ScriptedClient([_write("a.py"), near_miss])
    agent = LocalAgent(client, box, 10)  # type: ignore[arg-type]
    result = agent.run("crie a.py")
    assert result.stopped_reason == "completed"
    assert executor.calls == 1
    assert result.final == "consertei"


def test_malformed_completion_gets_bounded_format_feedback(tmp_path: Path) -> None:
    executor = ScriptedExecutor([_test_result(0, "2 passed")])
    box = ToolBox(WorkspaceSandbox(tmp_path), 2, 4000, executor)  # type: ignore[arg-type]
    box.authorize_plan({"a.py"})
    malformed: dict[str, object] = {"message": {"content": '{"action":"complete"}'}}
    client = ScriptedClient([_write("a.py"), malformed, COMPLETE])
    agent = LocalAgent(client, box, 10)  # type: ignore[arg-type]
    result = agent.run("crie a.py")
    assert result.stopped_reason == "completed"
    feedback = [m for m in client.messages_seen if isinstance(m, dict) and "invalid_completion_format" in str(m.get("content"))]
    assert len(feedback) == 1


def test_malformed_completion_strikes_are_bounded(tmp_path: Path) -> None:
    box = ToolBox(WorkspaceSandbox(tmp_path), 2, 4000)
    box.authorize_plan({"a.py"})
    malformed: dict[str, object] = {"message": {"content": '{"action":"complete","arguments":{}}'}}
    client = ScriptedClient([_write("a.py"), malformed, malformed, malformed])
    agent = LocalAgent(client, box, 10)  # type: ignore[arg-type]
    result = agent.run("crie a.py")
    assert result.stopped_reason == "invalid_structured_response"
    assert [item["outcome"] for item in agent.structured_response_audit] == ["accepted", "rejected", "rejected", "rejected"]
    assert all(item["raw"] and item["raw_sha256"] for item in agent.structured_response_audit)


def test_invalid_json_gets_two_deterministic_repairs_then_is_rejected(tmp_path: Path) -> None:
    box = ToolBox(WorkspaceSandbox(tmp_path), 2, 4000)
    box.authorize_plan({"a.py"})
    invalid: dict[str, object] = {"message": {"content": "texto fora do schema"}}
    client = ScriptedClient([invalid, invalid, invalid])
    agent = LocalAgent(client, box, 10)  # type: ignore[arg-type]
    result = agent.run("crie a.py")
    assert result.stopped_reason == "invalid_structured_response"
    assert len(agent.structured_response_audit) == 3
    repairs = [message for message in client.messages_seen if "structured_response_rejected" in str(message)]
    assert len(repairs) == 2
    assert '"repair_attempt": 1' in str(repairs[0]) and '"repair_attempt": 2' in str(repairs[1])


def test_invalid_json_can_only_recover_by_regenerating_canonical_action(tmp_path: Path) -> None:
    box = ToolBox(WorkspaceSandbox(tmp_path), 2, 4000)
    box.authorize_plan({"a.py"})
    invalid: dict[str, object] = {"message": {"content": '```json {"action":"tool","name":"write_file"} ```'}}
    client = ScriptedClient([invalid, _write("a.py")])
    agent = LocalAgent(client, box, 2)  # type: ignore[arg-type]
    result = agent.run("crie a.py")
    assert result.stopped_reason == "iteration_limit"
    assert [item["outcome"] for item in agent.structured_response_audit] == ["rejected", "accepted"]
    assert agent.structured_response_audit[0]["normalization"] == "none"


@pytest.mark.parametrize("content", [
    '{"action":"tool","name":"read_file","arguments":{"path":"a.py"},"extra":true}',
    '{"action":"tool","name":"write_file","arguments":{"path":"a.py","content":"x","command":"echo x"}}',
    '[{"action":"tool","name":"git_status"}]',
    'prefix {"action":"tool","name":"git_status"}',
])
def test_ambiguous_or_expanded_formats_are_never_normalized(content: str) -> None:
    with pytest.raises(ValueError):
        parse_structured_action(content)


def test_write_file_content_is_passed_through_verbatim_without_unescaping() -> None:
    # Regressão da prova real INT-04: o qwen2.5-coder:7b já emitiu content com "\n"
    # literais (barra-invertida-n) por dobrar o escape. Desescapar seria interpretação
    # semanticamente ambígua (um arquivo pode conter "\n" de propósito). O parser deve
    # aceitar a resposta estruturada válida e devolver o content byte a byte, deixando o
    # gate de testes falhar fechado quando o arquivo resultante for inválido.
    literal_backslash_n = 'def add(a: int, b: int) -> int:\\n    return a + b\\n'
    content = json.dumps({"action": "tool", "name": "write_file", "arguments": {"path": "a.py", "content": literal_backslash_n}})
    calls, completion = parse_structured_action(content)
    assert completion is None
    assert calls == [("write_file", {"path": "a.py", "content": literal_backslash_n})]
    assert "\\n" in calls[0][1]["content"] and "\n" not in calls[0][1]["content"]


def test_only_declared_completion_normalization_is_audited(tmp_path: Path) -> None:
    executor = ScriptedExecutor([_test_result(0, "1 passed")])
    box = ToolBox(WorkspaceSandbox(tmp_path), 2, 4000, executor)  # type: ignore[arg-type]
    box.authorize_plan({"a.py"})
    near_miss: dict[str, object] = {"message": {"content": '{"action":"complete","arguments":{"content":"feito"}}'}}
    agent = LocalAgent(ScriptedClient([_write("a.py"), near_miss]), box, 5)  # type: ignore[arg-type]
    result = agent.run("crie a.py")
    assert result.stopped_reason == "completed"
    assert agent.structured_response_audit[-1]["normalization"] == "completion_arguments_to_summary"


def test_run_tests_without_command_uses_configured_default(tmp_path: Path) -> None:
    executor = ScriptedExecutor([_test_result(0, "Ran 3 tests in 0.001s\nOK")])
    box = ToolBox(WorkspaceSandbox(tmp_path), 2, 4000, executor, test_command="python -m unittest")  # type: ignore[arg-type]
    box.execute("run_tests", {})
    assert box.test_results[-1]["command"] == "python -m unittest"
    assert box.test_results[-1]["tests_count"] == 3


def test_typecheck_is_accepted_as_successful_validation_gate(tmp_path: Path) -> None:
    executor = ScriptedExecutor([_test_result(0, "TypeScript check completed")])
    box = ToolBox(WorkspaceSandbox(tmp_path), 2, 4000, executor, test_command="npm run typecheck")  # type: ignore[arg-type]
    box.authorize_plan({"proof.md"})
    box.execute("write_file", {"path": "proof.md", "content": "proof\n"})
    box.execute("run_tests", {})
    assert box.test_results[-1]["command"] == "npm run typecheck"
    assert box.test_results[-1]["tests_count"] == 1
    assert box.has_current_test_evidence


def test_zero_tests_discovered_is_not_evidence(tmp_path: Path) -> None:
    executor = ScriptedExecutor([_test_result(0, "Ran 0 tests in 0.000s\nOK")])
    box = ToolBox(WorkspaceSandbox(tmp_path), 2, 4000, executor)  # type: ignore[arg-type]
    box.authorize_plan({"a.py"})
    box.execute("write_file", {"path": "a.py", "content": "x\n"})
    box.execute("run_tests", {"command": "python -m pytest"})
    assert not box.has_current_test_evidence


def test_schema_offers_complete_after_writes_but_loop_still_requires_evidence(tmp_path: Path) -> None:
    executor = ScriptedExecutor([_test_result(0, "1 passed")])
    box = ToolBox(WorkspaceSandbox(tmp_path), 2, 4000, executor)  # type: ignore[arg-type]
    box.authorize_plan({"a.py"})
    client = ScriptedClient([_write("a.py"), _run_tests_call(), COMPLETE])
    agent = LocalAgent(client, box, 10)  # type: ignore[arg-type]
    result = agent.run("crie a.py")
    assert result.stopped_reason == "completed"
    enums = [f["properties"]["action"]["enum"] for f in client.formats]  # type: ignore[index]
    assert enums == [["tool"], ["tool", "complete"], ["tool", "complete"]]
    assert executor.calls == 1
