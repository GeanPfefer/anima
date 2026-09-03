# 2026-09-02 — Replanejamento após falha determinística: implementação e prova

**Tipo:** implementação de capability + reconciliação de trabalho parcial + prova determinística.
**Branch:** dev. **HEAD inicial:** `70fea8722056f52a93a4e926e14d6198fd2eedbc`
(= `origin/dev`; `main`/`origin/main` = `99bec54` intacta).

Continua o [diagnóstico do PIN-02](2026-09-02-diagnostico-semantico-pin02.md) e
implementa o [Plano 007](../planos/007-replanejamento-apos-falha-deterministica.md).
Não é PIN-03. Não altera `main`.

## Ponto de partida: trabalho parcial do Codex

O Codex começou a implementar o Plano 007 e parou por limite de uso, sem validar
nem commitar. Estado herdado no working tree (nada staged/commitado):

- Rastreados modificados (wiring): `apps/web/cli/{anima,app,args,render}.ts`
  (comando `work replan`), `packages/core/src/work-orchestration/index.ts`
  (export), `packages/types/src/database.ts` (tabela `work_replans` + RPC
  `replan_failed_work` nos tipos gerados).
- Novos: `packages/core/src/work-orchestration/replan.ts` (núcleo puro),
  `apps/web/lib/work-orchestration/replan-orchestration.ts` (application service),
  `supabase/migrations/20260902000001_minimal_unit_replan.sql` (tabela + RPC),
  `supabase/tests/minimal_unit_replan.test.sql` (pgTAP, plan 22).

A lógica estava coerente com o Plano 007, mas **não validada**: typecheck não
rodado, pgTAP com erros, sem testes TS. A reconciliação confirmou que a migration
já estava aplicada ao DB local (por sessão anterior/Codex), então a RPC/tabela
existiam mas com um bug latente que só aparece em chamada.

## Bugs corrigidos (completar o parcial, sem reescrever)

1. **`private.replan_strategy` — coluna `c` ambígua** (migration). A função
   DECLARA `c jsonb` (variável do FOR loop) e reusava `c` como alias de tabela no
   SELECT de agregação final → `column reference "c" is ambiguous` em toda chamada.
   Corrigido: alias renomeado para `corr`. Aplicado à função viva via
   `CREATE OR REPLACE` (o arquivo agora casa com o DB).
2. **pgTAP — colisão do parâmetro `id` em `pg_temp.run`** (teste). `run(id uuid, …)`
   é `LANGUAGE sql`; o parâmetro `id` era sombreado pela coluna `work_events.id`, então
   `WHERE e.work_item_id=id` virava `= e.id` (nunca verdadeiro) → `p_failure_event_id`
   NULL → a RPC recusava com `failure_not_nonretryable`. Corrigido: parâmetro
   renomeado para `wid`.
3. **pgTAP — dois INSERTs com 1 `)` sobrando cada** (fixtures `host_observed_*`).
   Corrigido removendo o parêntese extra; contagem por-linha volta a fechar em 0.

## O que a capability faz (fiel ao Plano 007)

Operação **humana** distinta de retry e de decomposição/correção. Materializa, no
máximo em `proposed`, um sucessor de recuperação para um item `failed/retryable:false`
que é uma **unidade mínima** (um único arquivo `*.test.ts`) — caso que nem
`decompose` (exige subconjunto estritamente menor) nem `correct` (exige
`changes_requested`) satisfazem. Progresso material vem de **mudança de plano no
mesmo escopo físico**, não de redução de arquivos.

Garantias (RPC `replan_failed_work`, SECURITY DEFINER, auth.uid()+allowlist):
falha terminal mais recente = `execution_failed` **não-retryable**; evidência de gate
**determinística** observada pelo host (outcome `failed`, não timeout, não cancelada);
escopo contido observado por git (`observedChangedFilesSinceStart` == `included_scope`);
checkpoint durável (base≠commit, 40-hex); **orçamento transferido** do saldo
(`remaining = max − used`, nunca resetado); **sem progresso semântico** recusado
(`spec.replan_strategy == strategy` derivada → `no_semantic_progress`); **idempotência**
por predecessor (replay estável; diagnóstico cosmético não cria novo filho);
**anti-loop** (um replan-successor não pode gerar outro; predecessor com lineage própria
recusado); original intacto; `proposed` é o teto (aprovação é ato humano separado).

Núcleo puro (`replan.ts`): `readReplanDiagnosis` (validação fail-closed do diagnóstico
humano: `finding=test_code_incorrect`, correções `resolve_imports|respect_api_types|
assert_public_boundary`), `deriveReplanStrategy` (forma canônica — ordem e redação não
concedem progresso), `hasMaterialReplanProgress` (mesmo plano disfarçado ⇒ false).

## Provas

- **Typecheck:** verde em todos os workspaces (`npm run typecheck --workspaces`).
- **Testes TS:** núcleo `replan.test.ts` 29/29; orquestração
  `replan-orchestration.test.ts` 12/12. Determinismo TS: diagnóstico válido ⇒ aceito e
  progresso; estratégia equivalente reordenada/reescrita ⇒ **sem progresso**;
  malformado ⇒ fail-closed.
- **pgTAP:** `minimal_unit_replan.test.sql` **22/22** (rodado contra o DB local).
  Cobre positivos (A/B unidade mínima permitida; `proposed`; predecessor preservado;
  saldo 3−2=1; attempts históricas preservadas; lineage/falha correlacionadas; replay)
  e negativos (equivalente ⇒ `no_semantic_progress`; retryable ⇒ `failure_not_nonretryable`;
  escopo decomponível ⇒ `not_minimal_test_unit`; diagnóstico/evidência ausentes; predecessor
  não terminal; orçamento esgotado; violação de escopo; timeout ≠ determinístico;
  gates/covers intactos; owner alheio; RLS não expõe diagnóstico alheio).
- **`git diff --check`:** limpo.

## Caso real (PIN-02 `5b8e371d`) — READY, sem materializar

Inspeção read-only (sem service_role, sem mutação) confirma que **todas** as
pré-condições da RPC são satisfeitas pela falha terminal mais recente, attempt
`0cfdd6cb` (retryable=false, gate determinístico `failed`; checkpoint
base `6ff4d43c…` → commit `1ee1921e…`): state=failed, capability=programming,
impact=low, escopo `["packages/core/src/project-intake.test.ts"]` (unidade mínima),
saldo `remaining=1` (max 3, used 2), envelope ollama/worktree/project sem tokens
proibidos, anti-loop ok, sem execução ativa. O retry está corretamente `BLOCKED`
(não-retryable); replan é o caminho governado.

**Não materializei** o sucessor: replan é **operação humana** e exige **diagnóstico
humano aprovado** — cuja semântica de aprovação o próprio Plano 007 marca como
*ainda não ratificada*. Materializar exigiria (a) um diagnóstico real revisado por
humano e (b) rodar self-dev, que continua barrado pelo compute (RAM). Fronteira
preservada: mecanismo pronto e provado; a materialização + aprovação + self-dev são
o ato humano de Gean.

Handoff (quando houver diagnóstico humano em `diag.json`):
`npm run anima -- work replan 5b8e371d-6ca9-453c-bbfe-693ae3266468 --diagnosis diag.json`.
