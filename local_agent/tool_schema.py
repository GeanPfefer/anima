from __future__ import annotations

import json
import copy

TOOLS: list[dict[str, object]] = [
    {"type": "function", "function": {"name": "list_files", "description": "Lista arquivos da workspace.", "parameters": {"type": "object", "additionalProperties": False, "properties": {"path": {"type": "string"}}}}},
    {"type": "function", "function": {"name": "read_file", "description": "Lê arquivo não sensível.", "parameters": {"type": "object", "additionalProperties": False, "properties": {"path": {"type": "string"}}, "required": ["path"]}}},
    {"type": "function", "function": {"name": "search_text", "description": "Pesquisa texto.", "parameters": {"type": "object", "additionalProperties": False, "properties": {"query": {"type": "string"}, "path": {"type": "string"}}, "required": ["query"]}}},
    {"type": "function", "function": {"name": "write_file", "description": "Cria ou substitui arquivo na workspace.", "parameters": {"type": "object", "additionalProperties": False, "properties": {"path": {"type": "string"}, "content": {"type": "string"}}, "required": ["path", "content"]}}},
    {"type": "function", "function": {"name": "run_command", "description": "Executa comando Python isolado.", "parameters": {"type": "object", "additionalProperties": False, "properties": {"command": {"type": "string"}}, "required": ["command"]}}},
    {"type": "function", "function": {"name": "git_diff", "description": "Mostra git diff.", "parameters": {"type": "object", "additionalProperties": False, "properties": {}}}},
    {"type": "function", "function": {"name": "git_status", "description": "Mostra git status.", "parameters": {"type": "object", "additionalProperties": False, "properties": {}}}},
    {"type": "function", "function": {"name": "run_tests", "description": "Executa testes permitidos.", "parameters": {"type": "object", "additionalProperties": False, "properties": {"command": {"type": "string"}}}}},
]

TOOL_NAMES = [str(tool["function"]["name"]) for tool in TOOLS]  # type: ignore[index]
EXECUTION_SCHEMA: dict[str, object] = {
    "type": "object", "additionalProperties": False, "required": ["action"],
    "properties": {
        "action": {"type": "string", "enum": ["tool", "complete"]},
        "name": {"type": "string", "enum": TOOL_NAMES},
        "arguments": {"type": "object", "additionalProperties": False, "properties": {
            "path": {"type": "string"}, "content": {"type": "string"},
            "query": {"type": "string"}, "command": {"type": "string"},
        }},
        "summary": {"type": "string"},
    },
}


def schema_for_execution(allow_complete: bool) -> dict[str, object]:
    schema = copy.deepcopy(EXECUTION_SCHEMA)
    action = schema["properties"]["action"]  # type: ignore[index]
    action["enum"] = ["tool", "complete"] if allow_complete else ["tool"]
    return schema


def parse_structured_action(content: str) -> tuple[list[tuple[str, dict[str, object]]], str | None]:
    try:
        value = json.loads(content)
    except ValueError as exc:
        raise ValueError("Execution response must be pure JSON.") from exc
    if not isinstance(value, dict):
        raise ValueError("Execution response must be an object.")
    if value.get("action") == "complete":
        if set(value) == {"action", "summary"} and isinstance(value.get("summary"), str) and value["summary"].strip():
            return [], str(value["summary"])
        # Near-miss tolerado: conclusão com o resumo em arguments (um único campo string).
        # O resumo é apenas nota factual; nenhum gate depende dele.
        arguments = value.get("arguments")
        if set(value) == {"action", "arguments"} and isinstance(arguments, dict):
            texts = [item for item in arguments.values() if isinstance(item, str) and item.strip()]
            if len(texts) == 1 and len(arguments) == 1:
                return [], texts[0]
        raise ValueError("Invalid structured completion.")
    if value.get("action") != "tool" or not {"action", "name"} <= set(value) or not set(value) <= {"action", "name", "arguments"}:
        raise ValueError("Invalid structured action.")
    name, arguments = value.get("name"), value.get("arguments", {})
    if not isinstance(name, str) or name not in TOOL_NAMES or not isinstance(arguments, dict):
        raise ValueError("Invalid structured tool.")
    allowed = {"list_files": {"path"}, "read_file": {"path"}, "search_text": {"query", "path"}, "write_file": {"path", "content"}, "run_command": {"command"}, "git_diff": set(), "git_status": set(), "run_tests": {"command"}}
    required = {"read_file": {"path"}, "search_text": {"query"}, "write_file": {"path", "content"}, "run_command": {"command"}}
    keys = set(arguments)
    if not keys <= allowed[name] or not required.get(name, set()) <= keys or not all(isinstance(item, str) for item in arguments.values()):
        raise ValueError("Structured arguments do not match the tool schema.")
    return [(name, arguments)], None


def parse_tool_calls(response: dict[str, object]) -> list[tuple[str, dict[str, object]]]:
    message = response.get("message")
    if not isinstance(message, dict):
        raise ValueError("Resposta do modelo sem objeto message.")
    raw = message.get("tool_calls", [])
    if not isinstance(raw, list):
        raise ValueError("tool_calls precisa ser uma lista.")
    parsed: list[tuple[str, dict[str, object]]] = []
    for call in raw:
        if not isinstance(call, dict) or not isinstance(call.get("function"), dict):
            raise ValueError("Chamada de ferramenta sem objeto function.")
        function = call["function"]
        name, arguments = function.get("name"), function.get("arguments", {})
        if isinstance(arguments, str):
            try:
                arguments = json.loads(arguments)
            except ValueError as exc:
                raise ValueError("Argumentos da ferramenta não são JSON válido.") from exc
        if not isinstance(name, str) or not name or not isinstance(arguments, dict):
            raise ValueError("Nome ou argumentos da ferramenta inválidos.")
        parsed.append((name, arguments))
    return parsed
