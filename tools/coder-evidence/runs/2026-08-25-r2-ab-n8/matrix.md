# Matriz da campanha A/B — 2026-08-25T12:27:16.152Z

Config: A=current: defaults do construtor. B=r2: mesmos defaults + experimentalAnchorMode opt-in (maxReadRounds=3, num_ctx=8192, num_predict=1536, temperature=0). Node v24.16.0, Ollama 0.32.15. Seed 20260825, reps 8.
A/B pareado: a ordem fixture×rep é randomizada uma vez por modelo/seed e reutilizada IDENTICA para cada protocolo; blocos de protocolo ficam dentro do mesmo bloco de modelo para preservar hardware/modelo carregado. Fixtures são proxies sintéticos.

| Classe | Modelo | Protocolo | Host-aceito | Achieved | Falhas |
|---|---|---|---:|---:|---|
| `multi_locate` | `qwen3-coder:latest` | `current` | 0/8 | 0/8 | ambiguous_replacement×8 |
| `multi_locate` | `qwen3-coder:latest` | `r2` | 8/8 | 8/8 | — |
| `multiline_before` | `qwen3-coder:latest` | `current` | 8/8 | 8/8 | — |
| `multiline_before` | `qwen3-coder:latest` | `r2` | 8/8 | 6/8 | — |
| `structural_add` | `qwen3-coder:latest` | `current` | 8/8 | 8/8 | — |
| `structural_add` | `qwen3-coder:latest` | `r2` | 8/8 | 8/8 | — |
