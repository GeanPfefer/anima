from __future__ import annotations

from dataclasses import asdict
import json
import os
from pathlib import Path
import subprocess

import pytest

from local_agent.cli import sanitize_evidence
from local_agent.execution import ApplyError, ExecutionWorkspace, apply_changes, build_manifest, capture_complete_baseline
from local_agent.sandbox import SandboxViolation, WorkspaceSandbox
from local_agent.tools import ToolBox, count_tests
from local_agent.workflow import RunGates, RunState


def test_write_file_only_changes_execution_workspace(tmp_path: Path) -> None:
    original = tmp_path / "original"
    original.mkdir()
    (original / "a.py").write_text("old\n")
    baseline = capture_complete_baseline(original)
    with ExecutionWorkspace(original) as execution:
        box = ToolBox(execution.sandbox, 2, 1000)
        box.authorize_plan({"a.py", "new.py"})
        box.execute("write_file", {"path": "a.py", "content": "new\n"})
        box.execute("write_file", {"path": "new.py", "content": "created\n"})
        assert (original / "a.py").read_text() == "old\n"
        assert not (original / "new.py").exists()
        assert capture_complete_baseline(original).files == baseline.files


def test_apply_success_is_allowlisted_and_manifest_is_factual(tmp_path: Path) -> None:
    original = tmp_path / "original"
    original.mkdir()
    (original / "a.py").write_text("old\n")
    baseline = capture_complete_baseline(original)
    with ExecutionWorkspace(original) as execution:
        assert execution.root is not None
        (execution.root / "a.py").write_text("new\n")
        (execution.root / "b.py").write_text("created\n")
        result = apply_changes(original, execution.root, baseline, {"a.py", "b.py"})
    assert result.status == "applied"
    assert [(item.path, item.operation) for item in result.manifest] == [("a.py", "modify"), ("b.py", "create")]
    assert (original / "a.py").read_text() == "new\n"
    assert (original / "b.py").read_text() == "created\n"


def test_apply_refuses_empty_manifest(tmp_path: Path) -> None:
    baseline = capture_complete_baseline(tmp_path)
    with ExecutionWorkspace(tmp_path) as execution:
        assert execution.root is not None
        with pytest.raises(ApplyError) as raised:
            apply_changes(tmp_path, execution.root, baseline, {"required.py"})
    assert raised.value.result.status == "refused_empty_manifest"


def test_second_write_failure_rolls_back_first(tmp_path: Path) -> None:
    original = tmp_path / "original"
    original.mkdir()
    (original / "a.py").write_text("a0\n")
    (original / "b.py").write_text("b0\n")
    baseline = capture_complete_baseline(original)
    with ExecutionWorkspace(original) as execution:
        assert execution.root is not None
        (execution.root / "a.py").write_text("a1\n")
        (execution.root / "b.py").write_text("b1\n")
        def fail_second(index: int, entry: object) -> None:
            if index == 1:
                raise OSError("synthetic apply failure")
        with pytest.raises(ApplyError) as raised:
            apply_changes(original, execution.root, baseline, {"a.py", "b.py"}, before_replace=fail_second)
    assert raised.value.result.status == "rolled_back"
    assert raised.value.result.rollback_completed
    assert (original / "a.py").read_text() == "a0\n"
    assert (original / "b.py").read_text() == "b0\n"


def test_concurrent_hash_change_refuses_apply(tmp_path: Path) -> None:
    original = tmp_path / "original"
    original.mkdir()
    (original / "a.py").write_text("base\n")
    baseline = capture_complete_baseline(original)
    with ExecutionWorkspace(original) as execution:
        assert execution.root is not None
        (execution.root / "a.py").write_text("agent\n")
        (original / "a.py").write_text("external\n")
        with pytest.raises(ApplyError) as raised:
            apply_changes(original, execution.root, baseline, {"a.py"})
    assert raised.value.result.status == "refused_concurrent_change"
    assert (original / "a.py").read_text() == "external\n"


def test_unapproved_new_file_and_bad_paths_are_refused(tmp_path: Path) -> None:
    box = ToolBox(WorkspaceSandbox(tmp_path), 1, 1000)
    box.authorize_plan({"allowed.py"})
    with pytest.raises(PermissionError):
        box.execute("write_file", {"path": "other.py", "content": "bad"})
    with pytest.raises(SandboxViolation):
        box.execute("write_file", {"path": "../escape.py", "content": "bad"})
    with pytest.raises(SandboxViolation):
        box.execute("write_file", {"path": str(tmp_path.parent / "absolute.py"), "content": "bad"})


@pytest.mark.skipif(not hasattr(os, "symlink"), reason="sem symlink")
def test_apply_refuses_reparse_target(tmp_path: Path) -> None:
    original = tmp_path / "original"
    outside = tmp_path / "outside"
    original.mkdir()
    outside.mkdir()
    link = original / "linked.py"
    try:
        link.symlink_to(outside / "x.py")
    except OSError:
        pytest.skip("criação de symlink sem privilégio")
    baseline = capture_complete_baseline(original)
    with ExecutionWorkspace(original) as execution:
        assert execution.root is not None
        (execution.root / "linked.py").write_text("agent")
        with pytest.raises((ApplyError, ValueError)):
            apply_changes(original, execution.root, baseline, {"linked.py"})


def test_sanitized_copy_omits_file_and_directory_symlinks(tmp_path: Path) -> None:
    original = tmp_path / "original"
    outside = tmp_path / "outside"
    original.mkdir()
    outside.mkdir()
    (outside / "secret.py").write_text("EXTERNAL_FIXTURE\n")
    file_link = original / "file-link.py"
    directory_link = original / "directory-link"
    file_link.symlink_to(outside / "secret.py")
    directory_link.symlink_to(outside, target_is_directory=True)
    with ExecutionWorkspace(original) as execution:
        assert execution.root is not None
        assert not (execution.root / "file-link.py").exists()
        assert not (execution.root / "directory-link").exists()
        records = {record.path: record.reason for record in execution.records}
        assert records["file-link.py"] == "reparse_point"
        assert records["directory-link"] == "reparse_point"
    assert (outside / "secret.py").read_text() == "EXTERNAL_FIXTURE\n"


@pytest.mark.skipif(os.name != "nt", reason="junction é específico do Windows")
def test_junction_is_omitted_and_transaction_cannot_write_through_it(tmp_path: Path) -> None:
    original = tmp_path / "original"
    outside = tmp_path / "outside"
    original.mkdir()
    outside.mkdir()
    external = outside / "target.py"
    external.write_text("EXTERNAL_FIXTURE\n")
    junction = original / "junction"
    made = subprocess.run(["cmd", "/c", "mklink", "/J", str(junction), str(outside)], capture_output=True, text=True)
    if made.returncode != 0:
        pytest.skip("junction indisponível: " + made.stderr.strip())
    baseline = capture_complete_baseline(original)
    assert baseline.state("junction").kind == "reparse"
    with ExecutionWorkspace(original) as execution:
        assert execution.root is not None
        assert not (execution.root / "junction").exists()
        (execution.root / "junction").mkdir()
        (execution.root / "junction" / "target.py").write_text("AGENT_WRITE\n")
        with pytest.raises((ApplyError, RuntimeError, ValueError, SandboxViolation)):
            apply_changes(original, execution.root, baseline, {"junction/target.py"})
    assert external.read_text() == "EXTERNAL_FIXTURE\n"


def test_write_content_and_known_secrets_never_enter_events() -> None:
    root = Path.cwd()
    box = ToolBox(WorkspaceSandbox(root), 1, 1000, known_secrets={"TEST_SECRET_123", "FAKE_TOKEN_XYZ"})
    box.authorize_plan(set())
    content = "TEST_SECRET_123\nFAKE_TOKEN_XYZ\nmultiline"
    with pytest.raises(PermissionError):
        box.execute("write_file", {"path": "refused.py", "content": content})
    encoded = json.dumps(box.events)
    assert content not in encoded
    assert "TEST_SECRET_123" not in encoded
    assert "FAKE_TOKEN_XYZ" not in encoded
    assert "content_sha256" in encoded


def test_persisted_evidence_redacts_known_secrets(tmp_path: Path) -> None:
    raw = json.dumps({"stdout": "TEST_SECRET_123", "stderr": "FAKE_TOKEN_XYZ", "password": "bad"})
    safe = sanitize_evidence(raw, {"TEST_SECRET_123", "FAKE_TOKEN_XYZ"})
    target = tmp_path / "evidence.json"
    target.write_text(safe)
    persisted = target.read_text()
    assert "TEST_SECRET_123" not in persisted and "FAKE_TOKEN_XYZ" not in persisted and '"bad"' not in persisted


def test_gates_require_successful_tests_and_review() -> None:
    gates = RunGates()
    gates.approve()
    gates.start_editing()
    gates.require_tests({"a.py"}, {"a.py"})
    with pytest.raises(RuntimeError):
        gates.ready()
    with pytest.raises(RuntimeError):
        gates.record_tests(1, 1)
    assert gates.state is RunState.TESTS_REQUIRED
    gates.record_tests(0, 1)
    with pytest.raises(RuntimeError):
        gates.ready()
    gates.record_review()
    gates.ready()
    gates.applied()
    assert gates.history.index("tests_passed") < gates.history.index("review_completed") < gates.history.index("ready_to_apply")


@pytest.mark.parametrize(("expected", "actual"), [
    ({"a.py"}, set()),
    ({"a.py", "b.py"}, {"a.py"}),
    ({"a.py"}, {"a.py", "extra.py"}),
])
def test_gates_reject_empty_missing_or_unplanned_manifest(expected: set[str], actual: set[str]) -> None:
    gates = RunGates()
    gates.approve()
    gates.start_editing()
    with pytest.raises(RuntimeError):
        gates.require_tests(expected, actual)
    gates.fail("artifact_validation_failed")
    assert gates.state is RunState.FAILED
    assert gates.failure_reason == "artifact_validation_failed"


@pytest.mark.parametrize("count", [None, 0])
def test_gates_reject_unproved_or_zero_tests(count: int | None) -> None:
    gates = RunGates()
    gates.approve()
    gates.start_editing()
    gates.require_tests({"a.py"}, {"a.py"})
    with pytest.raises(RuntimeError):
        gates.record_tests(0, count)
    assert gates.state is RunState.TESTS_REQUIRED


def test_python_test_counts_are_factual() -> None:
    assert count_tests("python -m unittest", "", "Ran 0 tests in 0.000s\nOK") == 0
    assert count_tests("python -m unittest", "", "Ran 7 tests in 0.010s\nOK") == 7
    assert count_tests("python -m pytest", "collected 4 items\n.... 4 passed", "") == 4


def test_ignored_file_is_still_in_complete_baseline(tmp_path: Path) -> None:
    (tmp_path / ".gitignore").write_text("ignored.py\n")
    (tmp_path / "ignored.py").write_text("protected\n")
    baseline = capture_complete_baseline(tmp_path)
    assert baseline.state("ignored.py").sha256


def test_execution_copy_records_omitted_large_and_cache(tmp_path: Path) -> None:
    (tmp_path / "large.py").write_bytes(b"x" * 20)
    (tmp_path / ".pytest_cache").mkdir()
    (tmp_path / ".pytest_cache" / "x.py").write_text("cached")
    with ExecutionWorkspace(tmp_path, max_bytes=10) as execution:
        records = {record.path: record for record in execution.records}
        assert records["large.py"].reason == "workspace_size_limit"
        assert records[".pytest_cache"].reason == "sensitive_or_cache_directory"


def test_generated_trees_are_recorded_but_not_traversed_or_hashed(tmp_path: Path) -> None:
    for generated in ("node_modules", ".git", ".next"):
        nested = tmp_path / generated / "deep"
        nested.mkdir(parents=True)
        (nested / "large.bin").write_bytes(b"x" * 1024)
    (tmp_path / "source.py").write_text("print('ok')\n")
    baseline = capture_complete_baseline(tmp_path)
    assert "source.py" in baseline.files
    assert all(generated in baseline.files for generated in ("node_modules", ".git", ".next"))
    assert not any(path.startswith(("node_modules/", ".git/", ".next/")) for path in baseline.files)


def test_execution_workspace_cleans_after_copy_exception(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    created: list[Path] = []
    original_mkdtemp = __import__("tempfile").mkdtemp
    def tracked(*args: object, **kwargs: object) -> str:
        value = Path(original_mkdtemp(*args, **kwargs))
        created.append(value)
        return str(value)
    monkeypatch.setattr("local_agent.execution.tempfile.mkdtemp", tracked)
    monkeypatch.setattr(ExecutionWorkspace, "_copy", lambda self: (_ for _ in ()).throw(OSError("copy failed")))
    with pytest.raises(OSError):
        with ExecutionWorkspace(tmp_path):
            pass
    assert created and not created[0].exists()
