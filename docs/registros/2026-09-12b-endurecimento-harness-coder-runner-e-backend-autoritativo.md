# 2026-09-12b — Endurecimento do harness do coder: runner canônico (Jest) + fonte autoritativa do backend

## Objetivo e mandato

Decisão humana: executar a **trilha C** como pré-condição do próximo attempt pago —
eliminar estruturalmente os dois modos de falha recorrentes do harness observados nos attempts
`8fe633eb` (Ponto 1) e `8021c1ce` (Ponto 2), com correção **mínima e generalizável** no
harness/contrato do coder (não um hack por item). Restrições: **não** disparar planner/coder
OpenAI; **não** conceder/consumir paid authority; **não** liquidar as reservas abertas; **não**
tocar `origin/main`; preservar todo o WIP e o successor `fe99e446`; **não** alterar a lógica
funcional do settlement do Ponto 2; **não** executar `fe99e446`; **não** criar cadeia paralela.

## Estado inicial e final

- Branch `dev`; HEAD inicial/final `d783a5dc495da692eb7097f7c7252bb5ba074e51` (sem commit).
- `origin/main` inicial/final `99bec54e3ab42bfe882a8686cd1385d8058b916e` — INTACTA.
- WIP preservado; footprint desta etapa: modificados 57→59, untracked 98→101.
- Nenhuma chamada paga (sem OpenAI, sem RunPod), nenhum write no ledger, nenhuma RPC de escrita,
  nenhum Pod, nenhum `service_role`, nenhum merge/integração/deploy. Reservas abertas intocadas.

## Modos de falha atacados (diagnóstico das provas anteriores)

1. **Runner incompatível:** o coder gerou um teste que importa `vitest` num workspace cujo runner
   canônico é Jest → só falhava TARDE na build/tsc (exit 1), depois do gasto pago (`8021c1ce`).
2. **Fonte não autoritativa do backend:** o teste do coder leu `entry.coderBackend` (a fila
   `AutonomousQueueEntry` não tem esse campo) em vez do backend do **intent** do item
   (`readExecutionContract(item.intent).coderBackend`, sobrescrito por `computeDecision.selectedProvider`)
   → gate-fail (`8fe633eb`).

## Correção estrutural (mínima e generalizável)

- **Novo módulo PURO no core:** `packages/core/src/work-orchestration/coder-output-harness.ts`
  — `validateCoderOutputHarness(files, policy)` + `CoderHarnessPolicyV1` + `DEFAULT_CODER_HARNESS_POLICY_V1`
  (Jest canônico; incompatíveis `['vitest']`; fontes proibidas `['entry.coderBackend']`) +
  `describeCoderHarnessViolations` + `isTestFilePath`. Determinístico, sem I/O, sem custo,
  configurável por política (generalizável a outros workspaces/runners). Exportado no índice do core.
- **Wiring FAIL-CLOSED no executor:** `apps/web/lib/work-orchestration/worktree-executor.ts` lê o
  conteúdo dos arquivos alterados **desta attempt** (`changedByAttempt`) e valida ANTES dos gates
  caros e de qualquer checkpoint. Violação ⇒ `contract_violation`, `retryable:false` — mesmo canal
  já usado para out-of-scope. Nunca vira `result` de revisão nem checkpoint; **nenhum fallback
  silencioso** transforma erro de harness em sucesso. Opção `harnessPolicy` (default = política do
  monorepo). Regra 1 (runner) só em arquivos de teste; regra 2 (fonte do backend) em qualquer arquivo.
- Regra 2 é precisa contra a fonte autoritativa: `contract.coderBackend` /
  `computeDecision.selectedProvider` NÃO são violação; só a leitura via `entry.coderBackend`.

## Regressões executadas (verdes) — provam os 5 requisitos

- **Core** `coder-output-harness.test.ts` (22 testes): Jest obrigatório (import `@jest/globals` e
  globais passam); vitest rejeitado (named/side-effect/dynamic/require/subpath, com linha correta;
  comentado NÃO dispara); fonte autoritativa aceita e `entry.coderBackend` rejeitada (sem confundir
  sufixo de identificador); fail-closed (limpo⇒ok, vazio⇒ok, violação não mascarada, ambos os modos
  juntos); política customizada honrada.
- **Executor** `worktree-executor.test.ts` (3 novos, git real + `ScriptedCoderBackend`): teste com
  `vitest` ⇒ `contract_violation` antes do gate, sem `result`; `entry.coderBackend` ⇒
  `contract_violation`; teste Jest legítimo passa o harness e chega a `result` (sem falso-positivo).
- **Sweeps sem regressão:** `packages/core` 80 suites / 1670 testes; `apps/web` `work-orchestration/`
  90 suites / 1093 testes — tudo verde (o aviso "worker failed to exit gracefully" é teardown de
  handles, não falha; CRLF são normais no Windows).

## Diff exato desta etapa

- Novo: `packages/core/src/work-orchestration/coder-output-harness.ts` (+ teste).
- Modificado: `packages/core/src/work-orchestration/index.ts` (+1 linha de export).
- Modificado: `apps/web/lib/work-orchestration/worktree-executor.ts` (+42; import, opção
  `harnessPolicy`, bloco de validação fail-closed).
- Modificado: `apps/web/lib/work-orchestration/worktree-executor.test.ts` (+42; 3 testes).

## Fronteira / próximo passo

Uma única auditoria técnica pontual antes de autorizar o próximo self-dev PAGO. Não iniciado retry
de `fe99e446`/Ponto 2; reservas `688c7a44`/`e3d316d8`/`b1c37346` seguem abertas; nova paid authority
continua sendo decisão humana. Referências: `docs/registros/2026-09-12-reconciliacao-selfdev-successor-fe99e446-barreira-autoridade-expirada.md`, `2026-09-11c-...`.
