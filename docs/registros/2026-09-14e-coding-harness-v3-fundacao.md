# Coding Harness V3 (Agentic Workspace Runtime) — fundação

Data: 2026-09-14
Objetivo: evoluir o DeepSeek/shared harness para um coding agent runtime iterativo real,
começando pela correção arquitetural do gargalo de read-round que reprovou a última
correction paga ANTES de qualquer edit. Sem compute pago, sem RunPod, sem settlement.

## Estado reconciliado (auditoria de código, não de memória)

- Branch `dev`; HEAD inicial `b14a32c`; `origin/main` `99bec54` INTACTA (não tocada).
- WIP amplo preexistente PRESERVADO (não commitado, não descartado). As mudanças desta
  fatia foram adicionadas ao working tree como novo WIP, sem commit — para não entrelaçar
  com a decisão humana pendente sobre o WIP anterior.
- Backends de coder: `GptCoderBackend` é wrapper fino que DELEGA o laço inteiro ao
  `OllamaCoderBackend`, trocando só o `protocolTransport` (OpenAI Responses API). O
  "shared coder protocol" (`ollama-protocol.ts`) É o laço do Ollama; o prefixo `ollama_*`
  é histórico. O DeepSeek Harness é backend ENRAIZADO (subprocesso `dsh`, tools reais),
  CANDIDATO, não default — preservado, não descartado.
- Causa-raiz confirmada de `571d29be…`/attempt `77ca3038…` (`ollama_invalid_response_schema`,
  ver registro `2026-09-14d`): `parseReadRequests` lançava erro de schema TERMINAL quando
  `reads.length > MAX_READS_PER_ROUND (8)`, FORA do reparo de `callProtocol`. Compartilhado
  por Ollama e OpenAI. Um modelo forte que investiga amplamente reprova a tentativa inteira.

## Mudança implementada (evolução incremental, não reescrita)

- **Core puro** — novo `packages/core/src/work-orchestration/agentic-runtime-policy.ts`
  (`AgenticRuntimePolicyV1`, `resolveAgenticRuntimePolicy` fail-closed por clamp, perfis
  LOCAL 8/3/40 e REMOTO FORTE 24/10/200, `MAX_READS_REQUESTED_PER_ROUND = 64`). Exportado
  do índice do core.
- **Protocolo compartilhado** — `parseReadRequests(reads, allowed, servingBudget)` agora
  SERVE até `servingBudget` leituras válidas e DEFERE o excedente (re-solicitável), em vez
  de recusar terminal. Erro de schema só acima da guarda de ABUSO (64). Retorna `deferred`.
- **Laço compartilhado** (`ollama-coder.ts`) — resolve a política (precedência: policy
  explícita > `maxReadRounds` legado > perfil local); passa `servingBudget` por rodada
  (limitado pelo que resta do teto de sessão); renderiza o bloco "Leituras DEFERIDAS
  (não recusadas — re-solicite)"; aplica a fronteira de SESSÃO `maxTotalServedReads`
  (terminal `ollama_read_round_limit` só quando esgotada sem editar).
- **Backend forte** (`gpt-coder.ts`) — injeta o perfil REMOTO FORTE no laço compartilhado:
  correção direta do gargalo pago. Ollama local mantém o perfil conservador.

## Provas locais (compute local, determinístico, zero gasto)

- `packages/core`: 81 suites, 1665 testes PASS (inclui 5 novos de `agentic-runtime-policy`).
  `tsc --noEmit` do core: limpo.
- `apps/web` coder: `ollama-protocol` + `ollama-coder` + `gpt-coder` = 141 PASS (era 133;
  +8 novos, incluindo: >8 leituras/rodada servidas+deferidas sem falhar; perfil forte serve
  12 numa rodada sem deferir; acúmulo READ→READ→EDIT acima do orçamento por rodada; teto de
  sessão como fronteira terminal; regressão do gargalo pago no caminho OpenAI).
- Suites adjacentes (coder-backend, executor-selection[.deepseek-harness], deepseek-harness
  [-coder|-runtime], worktree-executor, coder-placement, coder-model-policy): 8 suites, 137 PASS.

## Falhas de infraestrutura (separadas de falhas de código, per AGENTS.md)

- `tsc --noEmit` do `apps/web` falha SOMENTE em scripts one-off untracked do arco congelado
  de settlement/recovery (`scripts/confirm-correction-prepaid-readonly.ts`,
  `scripts/create-seq5-recovery-successor.ts`, `scripts/revoke-d05bcab0-authority.ts`) —
  WIP preexistente, NÃO tocado por esta fatia. Nenhum arquivo alterado por mim aparece nos
  erros. É a barreira `generated-types-vs-WIP` já conhecida.

## Invariantes de segurança preservadas

- WRITE scope inalterado: `includedScope` segue reforçado pós-edição via git observado
  (`worktree-executor.ts`); tentativa fora do escopo continua `contract_violation`.
- Sem compute pago, sem RunPod, sem nova autoridade paga, sem merge, sem push, sem deploy.
- `origin/main` `99bec54` intacta; nenhum commit criado; WIP preexistente preservado.
- Fronteiras (rodadas, teto de sessão, budget/tempo/custo/escopo/rede/autoridade) substituem
  o anti-loop por-rodada; a guarda de abuso permanece fail-closed.

## Documentação canônica

- Novo ADR/arquitetura: `docs/arquitetura/coding-harness-v3-agentic-runtime.md` (distinção
  Brain/Governor/Agent Runtime/Verification; backend intercambiável; cérebro persistente
  futuro event-driven; DeepSeek harness = base dos braços; V3 = evolução; settlement
  congelado como benchmark; roadmap SEARCH/READ-scope/SHELL).

## Próximo ponto de retomada

- Marco seguinte: SEARCH repo-wide host-executado + separação READ scope amplo × WRITE scope
  estreito (exige manifesto amplo ou tool de busca; não feito aqui para manter a fundação
  coerente). Depois: SHELL/TEST/GIT governados pelo coder; perfis supervised×autonomous vivos
  injetados pelo Governor.
- Benchmark futuro: reexecutar B1/B2/B3 actual-cost settlement (base `ccb7dcc`, ref `0bea4c8`)
  com o MESMO modelo forte usando o perfil REMOTO FORTE do V3, para comparar harness antigo
  restrito vs Agentic Harness V3 sem mudar o problema.
