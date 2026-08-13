# Matriz da campanha — 2026-08-13T21:20:48.609Z

Config: defaults do construtor (maxReadRounds=3, num_ctx=8192, num_predict=1536, temperature=0). Node v24.16.0, Ollama 0.32.9. Seed 20260813, reps 8.
ordem randomizada por seed DENTRO de cada bloco de modelo (blocos contíguos para não recarregar a VRAM); fixtures são proxies sintéticos.

## Host-aceito / total (desfecho primário; códigos de falha entre parênteses)

| Classe | qwen2.5-coder:7b | qwen2.5-coder:14b | qwen3-coder:30b |
|---|---|---|---|
| `single_min` | 8/8 | 8/8 | 8/8 |
| `multi_locate` | 8/8 | 8/8 | 0/8 (ambiguous_replacement×8) |
| `indent_nested` | 8/8 | 8/8 | 8/8 |
| `multiline_before` | 8/8 | 8/8 | 8/8 |
| `create_new` | 0/8 (read_round_limit×8) | 0/8 (invalid_response_schema×8) | 8/8 |
| `structural_add` | 8/8 | 0/8 (ambiguous_replacement×8) | 8/8 |
| `cleanup` | 0/8 (ambiguous_replacement×8) | 8/8 | 8/8 |

## Semanticamente correto / total (métrica secundária; `achieved`)

| Classe | qwen2.5-coder:7b | qwen2.5-coder:14b | qwen3-coder:30b |
|---|---|---|---|
| `single_min` | 8/8 | 8/8 | 8/8 |
| `multi_locate` | 8/8 | 8/8 | 0/8 |
| `indent_nested` | 8/8 | 8/8 | 8/8 |
| `multiline_before` | 8/8 | 8/8 | 8/8 |
| `create_new` | 0/8 | 0/8 | 8/8 |
| `structural_add` | 8/8 | 0/8 | 8/8 |
| `cleanup` | 0/8 | 8/8 | 8/8 |
