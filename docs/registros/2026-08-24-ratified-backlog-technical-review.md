# Revisão técnica do backlog ratificado

- **Data/tipo:** 2026-08-24 — desenvolvimento + prova local.
- **Objetivo:** tornar decidíveis as três WorkProposals materializadas da decisão
  local-first, sem aprovar nem executar os trabalhos funcionais.
- **Branch:** `dev`.
- **HEAD inicial:** `2d71b25e52f8a348fedce32a999eb0a506d087c9`.
- **Commit de infraestrutura:** `2c355037c779b3f663c2554bd2a0951fbb9c1454`
  (`Aplique dependências à prontidão de execução`).
- **Resultado:** `RATIFIED_BACKLOG_TO_EXECUTION_V0_TECHNICAL_REVIEW = PASS`.

## Mudanças e prova

- O parser de `execution_spec`, o espelho puro da fila e a fila SQL passaram a
  aplicar `depends_on_work_item_ids` de modo fail-closed. Approval permanece uma
  decisão independente; somente execução aguarda predecessores `completed`.
- Um avaliador read-only separa `APPROVAL_READINESS` de
  `EXECUTION_READINESS` e exige target, base SHA, executor local em worktree,
  permissões isoladas, paths ancorados, comandos seguros, limites e dependências.
- Os itens `0cedae21...`, `b2930e81...` e `1257f22f...` avançaram de proposta v1
  para v2 pelo lifecycle existente. Foram adicionados exatamente seis eventos:
  três `proposal_changes_requested` (autor user) e três `proposal_revised`
  (autor anima). A cadeia decisão → backlog v2 → slice → item → revisão v1→v2
  foi preservada.
- A v2 corrige os seams: routing + Resource Governor no item 1; gate financeiro
  pré-dispatch separado de `integration-decision` no item 2; attempts/eventos,
  policy SQL e evidência observada no item 3. Nenhum conteúdo funcional desses
  itens foi implementado nesta sessão.

## Gates

- Core completo: 51 suites, 1.146 testes, todos verdes.
- Regressões focadas: routing/readiness/Resource Governor/fila e provenance do
  backlog/conversa, todas verdes.
- Typecheck dos workspaces: verde.
- Build web com `next dev` parado: verde.
- pgTAP: `autonomous_work_queue.test.sql` validou os 31 casos. Na suite completa,
  950/951 passaram; repetiu-se apenas a falha temporal preexistente de
  `work_control.test.sql` #20 (`pausa aplicada encerra a contagem de runtime`),
  fora dos arquivos tocados. A invocação isolada não monta
  `tests/helpers/routing.inc`, limitação do runner. Migration aplicada localmente
  sem reset.
- `git diff --check`: verde.

## Baseline e invariantes

- Antes/depois: work items `63→63`; work events `607→613`; approvals `48→48`;
  claims `41→41`; `execution_started` `41→41`; `work_started` `43→43`;
  work focus `2→2`.
- Os três itens permaneceram `proposed`, versão 2. Predicado do spec para estado
  aprovado hipotético: válido nos três. Dependências: item 1 satisfeita; itens 2
  e 3 bloqueados pelos predecessores.
- Egress de modelos/providers: zero. Compute pago, cloud, provisioning, coder,
  Supervisor, approval, claim, attempt, PR, merge e deploy: não realizados.
- `.worktrees/`, `.claude/settings.local.json` e `apps/web/.env.local` foram
  preservados e não versionados.

## Fronteira humana

`BLOCKED_BY_HUMAN_DECISION`: os três itens estão tecnicamente prontos para
approval, mas nenhum foi aprovado. O próximo checkpoint exato é o usuário decidir
se aprova os três escopos v2; se aprovar em conjunto, somente o item 1 ficará
executável, e 2→3 continuarão retidos pelas dependências causais.
