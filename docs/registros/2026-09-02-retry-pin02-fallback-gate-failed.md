# 2026-09-02 — Retry real do PIN-02: fallback provado, gate falhou

**Tipo:** prova viva. **Branch:** `dev`. **HEAD inicial/final:**
`05555cb49895e3e5954e018aea9a681f915d2285`. Sem commit ou push em dev.
`origin/dev` no mesmo SHA; `origin/main` = `99bec54e3ab42bfe882a8686cd1385d8058b916e`.
Continua [fallback governado](2026-09-02-fallback-governado-coder-local.md),
[Plano 006](../planos/006-project-intake-v0.md) e [ADR-003](../arquitetura/adr-003-resident-local-host.md).

## Mandato e reconciliação

Executar UMA autorização humana de retry do successor
`5b8e371d-6ca9-453c-bbfe-693ae3266468`, deixar o supervisor selecionar naturalmente,
usar fallback governado local e parar em review ou falha terminal. Sem PIN-03,
aceite, integração, merge, deploy, cloud ou revisão por outro LLM.

Git remoto confirmado por `git ls-remote`. Artefatos preexistentes preservados:
`.worktrees/`, `watch4-sensors.txt`, `.claude/settings.local.json`, `apps/web/.env.local`.
Docker/Supabase locais saudáveis; Ollama disponível e `qwen2.5-coder:14b` instalado.
Nenhum Resident Host preexistente identificado. Governor `permit / low / host_ready`.
Fila inicialmente vazia. Item failed, v1, readiness RETRY_READY, 1/3 usada, 2 restantes;
claim anterior liberado. Um item alheio in_progress não ocupava o alvo desta execução.

## Retry canônico

Comando: `npm.cmd run anima -- work retry 5b8e371d-6ca9-453c-bbfe-693ae3266468 --json`.
Identidade GoTrue/Bearer user-scoped da CLI, sem service_role e sem RPC manual de mutação.

- Antes: `failed`; depois: `approved`, v1; duas tentativas ainda disponíveis.
- Failure anterior: `ed4941e4-4fd3-423b-80fb-51a3c2ff3d3d`.
- Retry request: `cb9af9d3-47f3-47c9-b955-4a2d2498caba`, `replayed:false`.
- Evento humano: `53e8426a-3657-4801-87ff-257c6ba8f046`, seq 47167,
  `work_approved / authority=retry_authorization`, 20:38:55.867 UTC.
- Fila após retry: único elegível, posição 1, `target_occupied:false`.
- Proposal/execution_spec intactos, modelo aprovado `qwen3-coder:latest`.

## Host e attempt

Script canônico na raiz: `npm.cmd run local-host` (encaminha cwd para apps/web).
Config do processo: `ANIMA_AUTONOMY_ENABLED=1`, `ANIMA_CODER_VRAM_GB=16`,
`ANIMA_CODER_MODEL_ALLOWLIST=[{"model":"qwen3-coder:latest","requiresGb":18},{"model":"qwen2.5-coder:14b","requiresGb":10}]`.
Transporte `in_process`; bounds `MAX_ITERATIONS=1`, `MAX_TURNS_PER_CYCLE=1`,
`MAX_CYCLES=1`. Nenhum materializer habilitado; Governor e thresholds preservados.

- Classificação existente: `8ac609eb-d0c1-4789-b1a4-aa50c1a2d7bf`, canonical_backlog_v1-bridge.
- Routing: `9e2d0d2e-0ee4-4a01-83c6-5b1c337616c0`, seq 47169.
- Claim: `20ca7ae0-d6f7-4ac3-be1f-9d5423930593`, owner `supervisor-v0`.
- Attempt: `0cfdd6cb-a5ed-4217-b673-206078ea35f8`.
- `execution_started`: `7c524e2b-ef6d-4073-bc5c-798c7dc42234`, seq 47172,
  20:39:18.882548 UTC.
- Worktree temporária: `C:/Users/GeanTeco/AppData/Local/Temp/anima-wt-xZcVaZ/tree`.
- Base de retomada: `2602dac53d8fdf40f4e9219c8821362b8882a70a`.
- Checkpoint do coder: `4c0d5a6`; commit final: `1ee1921ec1c4dddfdfb74dfeb953d59e4a7e6083`.
- Branch preservada: `anima-work/0cfdd6cb-a5ed-4217-b673-206078ea35f8`.
- Terminal às 20:40:21.940015 UTC; duração start→failure ~63,057 s.
- Claim liberado: evento `2c4b0bdf-0a53-4280-bdfd-6de9d32d4ea0`, seq 47175.
- Host encerrado automaticamente às 20:40:22.242 UTC, um host-turn/um item,
  `stopReason=max_iterations`; worktree disposta pelo próprio executor, branch mantida.

## Fallback: evidência viva persistida

Evento `a563e9c6-9d2c-4715-ad70-8410656b5478`, seq 47177,
`host_observed_coder_evidence_recorded`, system/host:

```json
{"model":"qwen2.5-coder:14b","outcome":"succeeded","durationMs":51019,"modelSelection":{"schemaVersion":1,"preferred":"qwen3-coder:latest","selected":"qwen2.5-coder:14b","downgraded":true,"reason":"preferred_exceeds_capacity","capacityGb":16,"requiresGb":10}}
```

`ollama ps` confirmou qwen2.5-coder:14b, ~10 GB, 100% GPU, contexto 8192.
`outcome:succeeded` significa que o backend entregou edições; NÃO que os testes passaram.
Ressalva observada: `backendId` ainda registra `ollama:qwen3-coder:latest`, enquanto
`model`/`modelSelection.selected` registram o modelo efetivo menor. Não confundir esse
rótulo com execução do preferido. Nenhuma alteração do mecanismo nesta prova terminal.

## Falha real, gates e diff

Classe terminal: **gate failure**, `retryable:false`. Evento
`b6783ef2-d769-4fa3-9a18-bb0ab5276cd0`, seq 47174.
O host executou `npm.cmd test --workspace=packages/core -- project-intake.test.ts --runInBand`
duas vezes (antes/depois do reparo interno permitido na mesma attempt):

| Gate | Exit | Duração | Timeout/cancelamento |
|---|---:|---:|---|
| Project Intake focado, inicial | 1 | 4567 ms | false/false |
| Project Intake focado, após reparo | 1 | 3570 ms | false/false |
| Typecheck core | não executado | — | gate anterior impediu |

Evidência host-observed: `636694be-9942-4aca-b8c4-7d1e31d2a791`, seq 47176.
Sem reexecução ad hoc dos gates, sem edição manual da worktree. O event log não contém
stdout/stderr detalhado dos gates; não atribuímos diagnóstico textual não capturado.
Inspeção do commit comprova funções `serializeProjectIdeaV0`/`deserializeProjectIdeaV0`
usadas nos testes sem imports, além de testes negativos que chamam `validateProjectIdea`
em vez de provar a desserialização do shape persistido. O reparo acrescentou testes,
mas não importou essas funções. Falha de código; nenhum timeout/erro de transporte observado.

Delta do coder contra checkpoint: **somente `packages/core/src/project-intake.test.ts`,
30 inserções, zero remoções** (22 inserções iniciais; reparo acrescentou oito linhas).
Implementação e demais paths excluídos preservados. Blob de `project-intake.ts` antes/depois:
`340d4f779b6b6979c71d0f3605975afd56af5151` em ambos.

Evidência estrutural independente: `6b69ee4a-b585-4590-9543-1ba88f9ed405`, seq 47178,
`observedCommitSha=1ee1921...`, `observedChangedFilesSinceStart=["packages/core/src/project-intake.test.ts"]`.
O diff de proveniência completa contra `6ff4d43...` inclui também 14 linhas de implementação
HERDADAS do checkpoint. Isso não é violação de escopo desta attempt. Inspeção Git independente
confirmou delta unitário e blob preservado: zero alterações em paths excluídos nesta attempt.

## Verifier, estado final e retomada

**Estado final: failed, não review.** Sem `result_submitted`, `verifierLive:null`,
`verifierRecorded:null`. CLI mostra cobertura 0/3 e três critérios sem cobertura.
`work evidence` retorna arrays vazios de gaps/violations/findings pela ausência de parecer;
isso NÃO equivale a um Verifier com zero gaps/violações e não autoriza VERIFIED.
As associações covers permanecem corretas: gates→validações; proof scope→escopo/preservação;
nenhum scope foi artificialmente associado a comando.

Readiness posterior: **BLOCKED / failure_not_retryable**, 2/3 usadas, 1 restante nominal;
fila vazia. Não existe retry pronto apesar do saldo numérico. Próxima decisão humana:
definir encaminhamento governado dessa falha não retryable. Não repetir a CLI às cegas,
fabricar attempt, alterar retryability/spec ou corrigir a branch manualmente.

Documentação de encerramento atualizada (PRD/plano/este registro), sem alteração do produto
em dev. Sem testes globais/build por não haver mudança de código nesta sessão.
Sem flakes demonstrados; barreiras de sandbox para Docker/Git remoto/inspeção da worktree
foram resolvidas por execução autorizada, sem bypass de governança do Anima.
Nenhum app interativo encerrado; nenhum custo pago, migration, reset, push, PR, merge,
aceite, integração ou deploy. Nenhum outro LLM revisor. PIN-03 não aberto.

Artefatos locais auxiliares preservados em `.worktrees/pin02-retry-20260902-host.jsonl`
e `.worktrees/pin02-retry-20260902-events.json`; fatos necessários à retomada constam acima.
