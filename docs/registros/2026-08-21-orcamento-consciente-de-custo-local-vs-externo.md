# Orçamento consciente de custo: execução local sem quota artificial de 6/24h

Data: 2026-08-21
Tipo: desenvolvimento (política de admissão) + prova pgTAP

## Decisão ratificada

O usuário ratificou: a razão de existir do modo LOCAL é executar continuamente sem
uma quota artificial baseada em custo externo. Portanto, para trabalho realmente
local (Ollama/qwen3-coder/worktree/gates/Verifier/Supabase/filesystem locais), NÃO
deve haver um teto global cego como **6 tentativas/24h** só para limitar volume.
Execução EXTERNA/PAGA (ex.: OpenAI) continua sujeita a quota/custo. Isto **não**
remove segurança: anti-loop por item, reserva interativa do host e as guardas
atômicas permanecem.

- Branch: `dev`. HEAD inicial: `0b5c753`. `origin/main`: `99bec54`, intacta.
- Working tree limpa exceto `.worktrees/`.

## O que existia (V0) e onde a distinção é possível

`private.autonomous_work_budget_decision` aplicava 4 limites fixos por usuário,
misturando os dois mundos:
1. `item_attempt_budget_exhausted` (min(3,declared)/24h) — anti-loop por item.
2. `user_attempt_budget_exhausted` (6/24h) — **quota de custo** (contagem global).
3. `user_runtime_budget_exhausted` (120min/24h) — **quota de custo** (tempo global).
4. `interactive_reserve_protected` (45min/60min) — reserva interativa (saúde do host).

A distinção local×externo já existe no **contrato tipado**
`execution_spec.coder_backend` (espelhado por `backendFor` em apps/web): `ollama`,
`deepseek-harness`, `scripted` = local; `openai` = externo; ausente ⇒ ollama
(local). A ATTEMPT (executor→coder→gates) é o que consome "tentativa"; o custo
externo do PLANNER é evento de PROPOSTA anterior, não uma attempt — então uma
proposta planejada externamente **não** vira quota de 6/dia na execução local.

## Mudança (política V2, migration `20260821000002_local_vs_external_work_budget.sql`)

- `private.work_item_cost_class(intent)` → `'local'|'external'` pelo coder_backend
  (tipado; desconhecido ⇒ externo, conservador quanto a custo).
- `autonomous_work_budget_usage` passa a reportar também `externalAttempts24Hours`
  e `externalRuntimeSeconds24Hours` (classificando cada attempt pelo item), mantendo
  os totais para observabilidade e para a reserva interativa (machine-wide).
- `autonomous_work_budget_decision` (policyVersion `autonomous-work-budget-v2-local-external`):
  as quotas de **custo** (`user_attempt`, `user_runtime`) só contam e se aplicam a
  itens **externos**; `item_attempt` (anti-loop) e `interactive_reserve` (saúde do
  host) valem para **ambos**. Devolve `costClass` + consumo externo (auditoria).
- Nada afrouxado: a guarda atômica `enforce_autonomous_work_budget_before_start`, o
  `block_work_on_budget`, `interrupt_work_on_budget`, readmissão e resumption todos
  consomem a MESMA decisão → herdam a política V2 automaticamente.
- **Reserva interativa mantida para local** (não removida mecanicamente): protege a
  sessão interativa na mesma máquina (saúde do host); seu lar definitivo é o Resource
  Governor (migração futura, fora deste recorte).

## Provas (pgTAP vivo, transação com ROLLBACK)

- Nova `work_budget_local_vs_external.test.sql` **12/12**: LOCAL com 6 tentativas
  locais → **admitido** (sem `user_attempt_budget_exhausted`); EXTERNO com 6
  tentativas externas → **barrado** (`user_attempt_budget_exhausted`); anti-loop por
  item (3/24h) **fail-closed** para local; separação provada (tentativas locais não
  consomem quota externa; tentativas externas não barram local); `costClass`
  correto.
- `work_budget.test.sql` **15/15** (cenário de teto global agora usa itens EXTERNOS,
  semântica atualizada explicitamente; anti-loop e reserva class-agnósticos).
- `work_budget_readmission.test.sql` **17/17** (itens externos preservam o bloqueio
  pré-tentativa por quota de custo; mecânica de re-admissão intacta).
- `work_budget_interruption_resumption.test.sql` **15/15** e
  `work_budget_interruption_source_robustness.test.sql` **5/5** — inalterados
  (reserva/anti-loop class-agnósticos; fonte de retomada sintética).
- Core typecheck/web typecheck PASS; `work-budget` (mirror V0) 8/8. `git diff --check` CLEAN.
- Mirror `packages/core/.../work-budget.ts` **não é o caminho vivo** (só o TIPO é
  usado); comentado apontando o SQL v2 como autoridade viva.

## Invariantes de segurança

Tetos NÃO removidos mecanicamente; para EXTERNO permanecem 6/24h e 120min/24h. Para
LOCAL, a proteção real permanece: anti-loop por item, reserva interativa, guarda
atômica, e (Resource Governor/anti-concurrency já existentes). Sem bypass, sem
segredos, `origin/main` intacta, sem PR/merge/deploy.

## Próximo ponto de retomada

- Reconsultar admissão para um item LOCAL; se admitido, executar a prova viva
  pendente `chat → … → review` (não bloqueada por quota de custo local).
- Futuro: migrar a reserva interativa para gating do Resource Governor (pausar só
  sob pressão interativa real, não por quota fixa 45/60).
- Backlog autônomo (segundo norte) — investigação/menor recorte.
