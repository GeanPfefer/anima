# Coerência do orçamento V0: bloqueio temporal honesto e re-admissão por janela

Data: 2026-08-21
Tipo: desenvolvimento + prova

## Objetivo

Resolver, com o menor recorte causal, a incoerência apontada no registro
[`2026-08-21-prova-runtime-next-typegen-e-barreira-de-orcamento.md`](2026-08-21-prova-runtime-next-typegen-e-barreira-de-orcamento.md):
`block_work_on_budget` afirmava que "continuar exige decisão humana", mas o
checkpoint de orçamento não era respondível pela superfície nem tinha caminho de
retomada — o item ficava `blocked` para sempre.

- Branch: `dev`
- HEAD inicial: `6bef210cea9f1b1101fe557366a147c69629d7d4`
- HEAD final: este commit
- `origin/main` intacta em `99bec54e3ab42bfe882a8686cd1385d8058b916e` (sem push, sem merge).

## Defeito confirmado (lido no código, não suposto)

`block_work_on_budget` (pré-tentativa, `supabase/migrations/20260728000015_...`)
materializava `input_requested` com `reason='persistent_inability_after_limits'`
e explicação "continuar exige decisão humana", **sem** `options`, `attempt_id`,
`checkpoint_reference` nem `executor_signal`. Consequências:

- `projectPendingWorkDecision` (exige ≥2 opções + `attempt_id` + `checkpoint_reference`)
  ignora o evento — logo não havia cartão de decisão (correto), mas...
- `respond_to_work_decision` (exige `executor_signal` + opção apresentada) não o
  aceitava — a "decisão humana" anunciada era irrespondível;
- o item ficava `blocked`, portanto não elegível (`work_blocked_unresolved` em
  `evaluateAutonomousEligibility`), fora da fila (`autonomous_work_queue`) para
  sempre, mesmo depois de a janela móvel de 24h/60min liberar;
- a explicação persistida **mentia**: os quatro motivos de orçamento
  (`item_attempt_budget_exhausted`, `user_attempt_budget_exhausted`,
  `user_runtime_budget_exhausted`, `interactive_reserve_protected`) são todos
  limites de **janela móvel**: recuperam-se esperando, nunca por entrada humana.

## Decisão (Opção A, por evidência)

O bloqueio por orçamento é um estado **temporal não respondível** ("aguardando a
janela do orçamento"), com **re-admissão estreita, idempotente e derivada de
estado persistido** que devolve o item a `approved` quando a janela volta a
admitir. A Opção B (override humano do teto) foi **rejeitada**: exigiria
autorização ratificada que não existe, e os princípios canônicos mandam evitar
decisões humanas falsas/inalcançáveis, refletir o estado real na UI, falhar
fechado na dúvida e não afrouxar limites de segurança. Nada afrouxa o teto
6/24h; nenhum override é criado; nenhum bypass. Alinha-se ao INTEL-04, que já
modela o orçamento como admissão por janela móvel.

## Mudanças

Migration nova (append-only) `supabase/migrations/20260821000000_budget_block_honest_and_readmission.sql`:

- `CREATE OR REPLACE public.block_work_on_budget` — mesma lógica, explicação
  **honesta** (não afirma decisão humana; diz que volta a ser elegível quando a
  janela libera) + marcador tipado `resolution='awaits_budget_window'` no
  `input_requested` e no `work_blocked`. Razão tipada e `budget_reason` preservados.
- `private.readmit_budget_blocked_item(user,item,now)` — re-admite UM item cujo
  **último** `work_blocked` é bloqueio de orçamento **pré-tentativa** (razão
  tipada e **sem** `attempt_id`); recomputa `autonomous_work_budget_decision`; só
  devolve `approved` quando `admitted=true`; idempotente.
- `public.readmit_budget_blocked_work()` — reconciliação por usuário (lock
  consultivo por usuário), re-admite os itens elegíveis emitindo `work_approved`
  (author `system`, `reason=budget_window_recovered`). Invocada por volta do
  Supervisor; **não é scheduler/daemon**.

Aplicação e núcleo:

- `apps/web/lib/work-orchestration/supervisor.ts` — chama `readmit_budget_blocked_work`
  no início da volta (após `reconcile_supervised_work`, antes da seleção),
  fail-closed. Sem ela o item ficaria preso; a nova volta (autônoma ou pela
  superfície) é o gatilho de retomada, sem inventar scheduler.
- `packages/core/.../presentation.ts` — `projectPendingBudgetWait` (puro,
  read-only) declara o item como "aguardando janela de orçamento" (nunca cartão
  de decisão); `presentWorkItem` passa a expor `pendingBudgetWait`.
- `apps/web/.../WorkBudgetWaitCard.tsx` — cartão honesto (temporal, sem override
  do teto) com botão "Reverificar orçamento e retomar" que reusa `supervisor-turn`;
  honesto quando a janela ainda não liberou.
- `packages/types/src/database.ts` — assinatura do novo RPC (edição pontual;
  regenerar o arquivo inteiro só troca BOM/formatação por diferença de versão da
  CLI, então a adição foi feita à mão com a mesma forma que `gen types` produz).

## Provas/gates (números)

- pgTAP nova `supabase/tests/work_budget_readmission.test.sql`: **17/17** contra o
  banco local vivo (transação com ROLLBACK), incluindo prova viva
  bloqueado→(janela envelhecida com timestamps controlados)→`approved` por
  `work_approved system/budget_window_recovered`, idempotência e as duas guardas
  (decisão humana e interrupção em tentativa NÃO são re-admitidas por esta via).
- pgTAP existente `work_budget.test.sql`: **15/15** (sem regressão pelo `CREATE OR REPLACE`).
- `packages/core` Jest: **927/927** (inclui 6 casos novos de `projectPendingBudgetWait`).
- `apps/web` Jest `supervisor.test`: **43/43**; `chat/_components`: **86/86**
  (inclui 3 casos novos de `WorkBudgetWaitCard`); `supervisor-turn/route`: **11/11**.
- Typecheck: `apps/web`, `packages/core`, `packages/types`, `apps/mobile` — todos PASS.
- `git diff --check`: CLEAN.
- Migration aplicada ao banco local com `supabase migration up` (não destrutivo).

## Invariantes de segurança preservadas

- Teto 6/24h (e demais limites) inalterado; nenhum override, nenhum bypass.
- Re-admissão derivada só de estado persistido, idempotente, append-only; jamais
  falsifica entrada humana (`work_approved` author `system`, razão tipada).
- Guardas estreitas: só o bloqueio de orçamento **pré-tentativa** é re-admitido.
- `evidência ≠ classificação ≠ decisão ≠ ação`; fail-closed na volta do Supervisor.

## Limitações / não feito

- Interrupção **em tentativa** por orçamento (`interrupt_work_on_budget`, carrega
  `attempt_id` e checkpoint) **não** é re-admitida por esta via: retomá-la exige
  ressumir do checkpoint, não recomeçar do zero — recorte separado. Suas
  explicações já são temporais (não afirmam decisão humana).
- Paridade mobile do `pendingBudgetWait` não foi adicionada (a projeção do core
  já está disponível); é seguimento limpo, fora deste recorte.

## Efeitos externos

- Nenhum push/PR/merge/deploy/`integrated`/credencial neste recorte antes do
  commit final; a publicação para `origin/dev` acompanha este commit.
- `origin/main` preservada. `.worktrees/` untracked preservado.

## Próximo ponto de retomada

- Re-admissão de interrupções em tentativa por orçamento (ressumir do checkpoint).
- Paridade mobile do estado "aguardando janela de orçamento".
- Repetir, quando o orçamento 6/24h liberar, a prova completa pela superfície
  `chat → proposal → approval → supervisor-turn → executor → review` (a barreira
  do registro anterior era exatamente o teto atingido).
