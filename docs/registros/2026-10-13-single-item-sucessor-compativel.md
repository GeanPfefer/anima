# 2026-10-13 — Sucessor compatível com o Single-Item V1

Tipo: desenvolvimento e preparação governada. Branch dev, HEAD a4f46f8 (inicial e final). Sem commit, sem push,
sem migration, sem alteração de código, sem aprovação, classificação, claim, attempt, Host ou API paga.

## Motivo

O preflight da primeira execução recusou `b5f8178a` (approved v1): o `execution_spec` contém
`resume_from_checkpoint` e `singleItemContractRefusal` devolve `single_item_resumption_unproved` (desenho do V1:
sem retomada). O item aprovado é imutável e não foi alterado.

## Diagnóstico do checkpoint

- Linhagem: `cde9684e` (v2, base 4ab99acf, OpenAI) entregou resultado; o humano pediu `changes_requested`
  (evento 86359: centralizar a resolução do modelo local em resolvedor reutilizável compartilhado pelo diagnóstico
  e pelo construtor, corrigindo três lacunas de evidência); `ab9cae0f` (correção por retomada) falhou e deixou o
  checkpoint `1c8b419` (branch `anima-work/fcff0570…`); `b5f8178a` tentou retomá-lo.
- O checkpoint **não está integrado** (não é ancestral do HEAD), é filho de `4ab99acf` (210 commits atrás) e
  altera 2 dos 3 arquivos (+29 linhas): adiciona `resolveConfiguredProjectPlannerConfig` e um teste.
- Os três arquivos do escopo mudaram 15 commits desde essa base (+107/−34, +205/−46, +86/−13); o patch do
  checkpoint é de uma versão obsoleta. A função `resolveConfiguredProjectPlannerConfig` **não existe** no HEAD, e o
  modelo local ainda é resolvido dentro do construtor de `LocalOllamaProjectWorkPlanner`
  (`deps.model ?? env.ANIMA_PROJECT_PLANNER_MODEL ?? 'qwen3-coder:latest'`). Logo o objetivo continua pendente e
  legítimo, e é implementável a partir do HEAD sem depender de nenhuma mudança não integrada do checkpoint.
- Teste de aceite no HEAD antes do trabalho: `npm test --workspace=apps/web -- project-work-planner-selectable.test.ts`
  = 35/35 PASS. O Verifier havia emitido `verified` (0 lacunas) para critérios da mesma forma no item original.

## Item criado

`d795e414-d603-4153-883e-124fea9ac732` — **proposed v1** (criação: mensagem humana persistida por RLS +
`service.createProposal`, mesma via do registro de 2026-10-10; sem REF canônica, usar o UUID). Eventos:
`work_proposed` (86378) e `context_attached` (86379). Planner `human_explicit_independent_proposal`.

- Objetivo: centralizar a resolução do modelo local num resolvedor reutilizável compartilhado pelo diagnóstico e
  pelo construtor, preservando precedência (injetado, `ANIMA_PROJECT_PLANNER_MODEL`, `qwen3-coder:latest`), default,
  comportamento atual e ausência de segredos; cumpre a revisão do `cde9684e`.
- Escopo (3 arquivos): `apps/web/lib/ai/project-work-planner.ts`, `…-local.ts`, `…-selectable.test.ts`.
  Exclusões incluem não alterar seleção de provider, orçamento, execução, nem o comportamento de
  `createConfiguredProjectPlanner`; não reaplicar o checkpoint.
- Base Git explícita: `a4f46f87585e2080b8d5b51412191e9da2c7d309` (HEAD, ancestral de si mesmo, contém os 3 arquivos).
- Executor `worktree`, `codex-cli`/`default`, permissões `workspace_read`+`workspace_write_isolated`;
  **1 tentativa, 30 minutos** (o item antigo tinha 3; reduzido por coerência com o V1, que não admite retry).
- Critérios: as 3 lacunas revistas (diagnóstico sem segredos/I-O; reutilização da mesma resolução; cobertura de
  testes default/explícito/precedência/ausência de segredos) com o comando acima, e contenção de escopo.
- Sem `resume_from_checkpoint`; referências históricas apenas informativas (`checkpoint_reused:false`).

## Verificações read-only do registro persistido

`singleItemContractRefusal` = null; elegibilidade de domínio (como approved) = true, sem lacunas;
`singleItemCodexRefusal` com `ANIMA_CODEX_*` só no processo = null (3,1 s; sem as variáveis recusa
`single_item_codex_wsl_required`); base verificada; ledger 156, 0 claims válidas, 0 itens in_progress.
`b5f8178a` e `cde9684e` inalterados; os únicos eventos novos no residente são os dois do item novo.

## Decisões e pendências humanas

- Aprovar `d795e414` (`work approve`), depois `work prepare-autonomous` (classificação) e só então autorizar a
  attempt única (`work execute-one … --version 1`).
- Recomendado: retirar `b5f8178a` com `work withdraw` (approved → cancelled, não iniciado): o fluxo global
  suporta `resume_from_checkpoint` e uma fila global poderia executá-lo com 3 tentativas a partir do checkpoint
  obsoleto. Não foi feito (não autorizado).
- `cde9684e` (changes_requested v2) permanece aberto; resolver (`work resolve-pending`) só depois que o
  sucessor for aceito ou descartado.

Evidências: `C:\Users\GeanTeco\anima-recovery\successor-d795e414-*\` (comando, registro persistido, resultado,
scripts, saídas; hashes).
