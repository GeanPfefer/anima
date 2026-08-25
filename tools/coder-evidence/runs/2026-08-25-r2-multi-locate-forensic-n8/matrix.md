# Matriz da campanha A/B — 2026-08-25T13:34:38.982Z

Config: current=defaults; r2=mesmos defaults + experimentalAnchorMode; r2-narrow=r2 + narrow-target-v1; r2-after-scope=r2 + after-scope-v1. Todos preservam maxReadRounds=3, num_ctx=8192, num_predict=1536, temperature=0. Node v24.16.0, Ollama 0.32.15. Seed 20260825, reps 8.
A/B pareado: a ordem fixture×rep é randomizada uma vez por modelo/seed e reutilizada IDENTICA para cada protocolo; blocos de protocolo ficam dentro do mesmo bloco de modelo para preservar hardware/modelo carregado. Fixtures são proxies sintéticos.

| Classe | Modelo | Protocolo | Host-aceito | Achieved | Falhas | Read request shapes | Modo efetivo | Híbridas |
|---|---|---|---:|---:|---|---|---|---:|
| `multi_locate` | `qwen3-coder:latest` | `r2` | 8/8 | 8/8 | — | search+lineRange×24 | search×24 | 24 |
