# Planner local — fronteira não resolvida após diferencial qwen3-coder

Data: 2026-08-23
Tipo: diagnóstico + correção + prova viva

`CANONICAL_AUTO_EXECUTION_LOCAL = NOT_PROVEN`

## Estado Git e ambiente recuperado

- Branch `dev`; HEAD inicial `74cedb3`; commits locais `6a3ed9e` (mecanismo), `326a3e6`
  (registro do bloqueio) e `fe5180a` (correção protocolar).
- Docker/Supabase/Ollama reconstruídos pós-reboot; migration `20260823000001` já aplicada
  no volume local; nenhum `db reset`.
- Push de `dev` tentado após os dois primeiros commits e bloqueado pela política do ambiente;
  `origin/dev` permaneceu em `74cedb3` e `origin/main` em `99bec54`.

## Comparação e diagnóstico

Configuração de prova: mesma fixture `FIX-01`, mesma planning boundary e validators,
`ANIMA_PROJECT_PLANNER_PROVIDER=local`, `ANIMA_PROJECT_PLANNER_MODEL=qwen3-coder:latest`.

- Resident host #1: planner terminou sem proposta estruturada; nenhum item criado.
- Diagnóstico #1: 16 rodadas; 5 calls read-only válidas na primeira rodada; a partir da
  segunda, catálogo somente-submit. Houve submits rejeitados e também tools de investigação
  emitidas fora do catálogo nas rodadas 3, 5 e 7; o adapter indevidamente as executou. Uma
  rodada terminou em texto (`finish_reason=stop`, sem tool call); ao final, exaustão das 16.
- Diagnóstico #2: PASS em 2 rodadas — 5 calls read-only válidas e um submit com todos os
  campos, parser válido e `included_scope` ancorado. Isso prova capacidade, mas também
  variância de terminalidade.
- Resident host #2: exaustão sem proposta terminal; nenhum item criado.

Bug causal do protocolo corrigido em `fe5180a`: quando a rodada oferece somente submit, o
host não executa uma tool antiga emitida pelo provider; responde erro correlacionado e segue
dentro do mesmo teto. Regressão focada 13/13 e typecheck web passaram. Resident host #3, já
com a correção, ainda esgotou 16 rodadas sem criar item. A correção preserva a fronteira de
capacidade, mas não resolve a terminalidade do modelo.

## Gates, invariantes e retomada

- Mecanismo: core 23/23; web 41/41; pgTAP 17/17; typecheck 5/5.
- Correção do planner: web 13/13; typecheck web PASS; `git diff --check` limpo.
- Planner model: `qwen3-coder:latest`; coder não foi iniciado porque nenhum item nasceu.
- Nenhuma aprovação manual, criação manual de item, chamada manual de host-turn, OpenAI,
  PR, merge, deploy, integração ou aplicação. `.worktrees/`, `.claude/settings.local.json`,
  `apps/web/.env.local` e `origin/main` preservados.

Próximo ponto exato: **local planner frontier unresolved; OpenAI differential proof
available**. Parar até nova autorização explícita de egress para a prova diferencial OpenAI.
