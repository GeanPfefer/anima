# Retomada de interrupção de orçamento EM tentativa (a partir do checkpoint)

Data: 2026-08-21
Tipo: desenvolvimento + prova

## Objetivo

Fechar o recorte deixado explicitamente fora do escopo em
[`2026-08-21-coerencia-orcamento-bloqueio-temporal-e-readmissao.md`](2026-08-21-coerencia-orcamento-bloqueio-temporal-e-readmissao.md):
recuperar corretamente uma tentativa **interrompida no meio** por orçamento
temporal (`interrupt_work_on_budget`), **retomando do checkpoint** quando a
janela móvel recupera — nunca um restart cego e nunca uma decisão humana falsa.

- Branch: `dev`
- HEAD inicial: `636aa7b`
- HEAD final: este commit
- `origin/main` intacta em `99bec54` (sem push/merge).

## Distinção central (documentada)

- **Bloqueio PRÉ-tentativa** (`block_work_on_budget`): `work_blocked` de orçamento
  **sem** `attempt_id`, nenhuma tentativa iniciada, nenhum checkpoint. Recuperar é
  uma readmissão simples `blocked→approved` e começar do zero. Já resolvido por
  `readmit_budget_blocked_work` (recorte anterior) — **deliberadamente estreito e
  NÃO reutilizado aqui.**
- **Interrupção EM tentativa** (`interrupt_work_on_budget`): `work_blocked` **com**
  `attempt_id` + `checkpoint_event_seq`, tentativa iniciada, claim liberada,
  checkpoint válido. Recomeçar do zero descartaria trabalho e checkpoint. A
  recuperação tem de **RESUMIR do checkpoint** pela arquitetura de retomada
  (AUTO-05), como o `human_decision_checkpoint`, mas **sem entrada humana** — o
  limite é temporal (janela móvel), não uma decisão.

## Semântica de retomada escolhida

Espelha EXATAMENTE o par ratificado `human_decision_resumption_source` +
`begin_human_decision_resumed_attempt`, trocando o gatilho humano por um gatilho
temporal derivado de estado:

1. `readmit_budget_interrupted_work()` devolve `blocked→approved` a interrupções
   EM tentativa cuja janela recuperou (guarda: último `work_blocked` de orçamento,
   COM `attempt_id`, com `checkpoint_recorded` válido; só quando `admitted=true`),
   emitindo `work_approved` (author `system`, `reason=budget_window_recovered`,
   `budget_interruption=true`). Distinta de `readmit_budget_blocked_work`.
2. `budget_interruption_resumption_source(item)` (read-only) reconstrói um
   `WorkHandoffV1` do checkpoint da interrupção, com `status='paused'` e
   `stopReason='time_limit_reached'`. **Robusta**: encontra a interrupção pendente
   mesmo sob um bloqueio pré-tentativa posterior, e encerra a fonte se qualquer
   `execution_started` posterior já a superou.
3. `begin_budget_interruption_resumed_attempt(...)` inicia atomicamente a nova
   tentativa a partir do checkpoint (novas identidades, `reason=budget_resumed`,
   `resumed_from_*` correlacionado), validando interrupção, checkpoint (não
   obsoleto), reuso de identidade e exclusividade de alvo.
4. Core `planWorkResumption`: nova fonte `budget_interruption_checkpoint` (galho de
   validação temporal); a lógica genérica checkpoint→plano já cobre fontes baseadas
   em `handoff`. Núcleo puro, fail-closed.
5. Supervisor: chama `readmit_budget_interrupted_work` no início da volta (após a
   readmissão pré-tentativa) e insere `budget_interruption_resumption_source` na
   cadeia de fontes, **antes** do começo do zero — assim um item re-admitido resume
   em vez de recomeçar. Sem scheduler/daemon.

**O material de continuação é o checkpoint (carriedContext), não a branch.** A
branch `anima-work/<attemptId>` anterior permanece como **evidência**; a retomada
usa uma worktree nova do `base_sha` guiada pelo `carriedContext` — idêntico aos
demais caminhos de retomada ratificados.

## Contagem de tentativas (política preservada)

A retomada cria um **novo `attempt_id`** e, portanto, conta como **nova tentativa**
tanto para o teto do item (3/24h) quanto para o teto do usuário (6/24h) — exatamente
como as retomadas humana e de abandono. A guarda atômica
`enforce_autonomous_work_budget_before_start` **revalida o orçamento no
`execution_started` da retomada**: se a janela esgotou de novo, falha fechado. **A
política "limites de tentativas atuam ENTRE tentativas" foi preservada; nenhum teto
foi alterado, afrouxado ou contornado.**

## Provas / gates (números)

- pgTAP nova `work_budget_interruption_resumption.test.sql`: **15/15** contra o
  banco local vivo (transação com ROLLBACK). Interrupção REAL por reserva (46 min) →
  `blocked` → readmit recusada enquanto esgotado → janela envelhecida por timestamps
  → readmit → `approved` → fonte com handoff `time_limit_reached` → retomada real
  `begin_budget_interruption_resumed_attempt` (guarda de orçamento ATIVA, revalidada)
  → `in_progress` com `execution_started/budget_resumed` correlacionado → replay
  idempotente (não cria 2ª tentativa).
- pgTAP existentes sem regressão: `work_budget_readmission` **17/17**, `work_budget`
  **15/15**.
- `packages/core` Jest: **937/937** (10 casos novos de `budget_interruption_checkpoint`).
- `apps/web` Jest work-orchestration: **522/522** (inclui supervisor 44/44 com o
  caso novo de retomada por interrupção).
- Typecheck `packages/core`, `packages/types`, `apps/web`, `apps/mobile`: PASS.
- `git diff --check`: CLEAN. Migration aplicada ao banco local (`migration up`).

## Invariantes de segurança preservadas

- Tetos 6/24h, 120min/24h e reserva 45min/60min inalterados; nenhum override,
  nenhum bypass; a guarda atômica revalida no `execution_started` da retomada.
- Não apaga `work_blocked`, não adultera timestamps de produção, não reusa claim
  antiga, não retoma sobre `proposal_version` divergente nem checkpoint obsoleto,
  não inventa resultado, não retoma enquanto o orçamento está esgotado.
- Append-only, idempotente e derivado só de estado persistido; `work_approved` da
  readmissão é `system`, jamais decisão humana falsa.
- `EVIDÊNCIA ≠ CLASSIFICAÇÃO ≠ DECISÃO ≠ AÇÃO`; Supervisor → Executor. Fail-closed
  em toda ambiguidade (fonte robusta, guardas alinhadas readmissão↔fonte↔begin).

## Efeitos externos

- Nenhum push/PR/merge/deploy/`integrated`/credencial antes do commit final; a
  publicação para `origin/dev` acompanha este commit. `origin/main` preservada.
  `.worktrees/` untracked preservado.

## Limitações / deliberadamente fora de escopo

- Paridade de UI para o estado "aguardando janela" da interrupção EM tentativa já é
  coberta pelo cartão de execução (`AutonomousExecutionProjection.budgetBlock`), que
  surge para a tentativa interrompida — não exigiu projeção nova.
- Não foi feita prova viva ponta-a-ponta pela superfície (`chat → … → review`) da
  retomada, pois exige o orçamento 6/24h liberar (a mesma barreira do registro
  anterior); o caminho está provado por unidade + pgTAP vivo.

## Próximo ponto de retomada

- Quando o orçamento 6/24h liberar, prova viva ponta-a-ponta da retomada pela
  superfície real.
- Integração da retomada com observabilidade/Resource Governor (custo do coder na
  tentativa retomada já é observado pelo host; avaliar histórico por retomada).
