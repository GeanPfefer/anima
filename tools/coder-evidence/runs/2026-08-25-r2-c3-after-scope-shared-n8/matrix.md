# Matriz da campanha A/B — 2026-08-25T13:10:11.868Z

Config: current=defaults; r2=mesmos defaults + experimentalAnchorMode; r2-narrow=r2 + narrow-target-v1; r2-after-scope=r2 + after-scope-v1. Todos preservam maxReadRounds=3, num_ctx=8192, num_predict=1536, temperature=0. Node v24.16.0, Ollama 0.32.15. Seed 20260825, reps 8.
A/B pareado: a ordem fixture×rep é randomizada uma vez por modelo/seed e reutilizada IDENTICA para cada protocolo; blocos de protocolo ficam dentro do mesmo bloco de modelo para preservar hardware/modelo carregado. Fixtures são proxies sintéticos.

| Classe | Modelo | Protocolo | Host-aceito | Achieved | Falhas |
|---|---|---|---:|---:|---|
| `multiline_before` | `qwen3-coder:latest` | `r2` | 8/8 | 5/8 | — |
| `multiline_before` | `qwen3-coder:latest` | `r2-after-scope` | 8/8 | 1/8 | — |
| `multiline_before` | `qwen3-coder:latest` | `r2-narrow` | 8/8 | 6/8 | — |
