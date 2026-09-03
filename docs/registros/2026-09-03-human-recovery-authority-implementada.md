# Human Recovery Authority — implementada e validada (fronteira humana no caso real)

Continuação direta de [a decisão sem execução](2026-09-02-recovery-budget-transferido-esgotado.md),
que desenhou (sem implementar) a menor concessão humana append-only para retomar um
replan cujo saldo transferido se esgotou. Esta sessão FECHOU a capability em código e a
provou deterministicamente. dev, HEAD inicial `addf467` (= origin/dev); origin/main
`99bec54` intacta. Sem `db reset`; migration já aplicada localmente reconciliada.

## Estado reconciliado e trabalho parcial do Codex

Codex deixara 4 arquivos novos + 4 modificados, coerentes e aproveitados verbatim:
- migration `20260903000000_human_recovery_authority.sql` (tabela `work_resume_authorizations`
  append-only + RLS own-row; `private.validate_resume_authorization`; RPC SECURITY DEFINER
  `authorize_work_resume`; trigger `no_resume_authority_descendants`) — **aplicada e
  registrada** no Supabase local vivo (conferido).
- `packages/core/src/work-orchestration/human-resume.ts` — codec puro `readHumanResumeAuthorization`.
- `apps/web/lib/work-orchestration/authorize-resume.ts` — application service fail-closed.
- tipos regenerados em `packages/types/src/database.ts` (tabela + RPC).
- registro de decisão + notas em `anima-prd.md` e `docs/planos/007`.

Faltavam: testes TS (codec + service), integração/testes de CLI, registro de implementação.

## Semântica (distinta de retry e de replan)

`authorize_work_resume` representa: *a autoridade anterior acabou; após revisar nova
evidência, o humano concede EXATAMENTE +1 tentativa, sob plano corrigido, teto agregado
explícito e envelope de compute LOCAL.* Não é retry (que exige saldo), nem replan (que
exige falha NÃO-retryável), nem reset de `max_attempts`, nem UUID novo para esconder
consumo. Invariantes provados pela RPC/constraints:
- **saldo esgotado obrigatório**: `used == max == allocated` do replan (com saldo ⇒ `budget_not_exhausted`).
- **falha retryable**: exige `retryable:true` (não-retryable ⇒ `retryable_failure_required`).
- **teto agregado = consumo+1**: `total(tree correction→replan)+1 == aggregateCeiling`; a
  tabela ainda checa `previous_consumed=previous_authorized AND aggregate_ceiling=previous_authorized+1`.
- **append-only**: `previous_consumed`/`previous_authorized` gravam o consumo histórico; nunca reescreve 3/3.
- **plano corrigido**: objetivo reescrito (inspecionar exports reais, importar explicitamente,
  preservar a implementação excluída, sem fuzzy); `apiPath` deve estar no `excluded_scope`.
- **compute local**: codec e RPC recusam `paid:true`/`placement≠local`.
- **anti-loop**: uma concessão por envelope-raiz; segunda concessão no mesmo predecessor ⇒
  `authorization_conflict`; o trigger barra QUALQUER descendente de um sucessor humano-retomado
  (`human_resume_no_further_recovery`) — nova falha volta ao humano.
- **idempotência**: `requestId` ⇒ mesma concessão/sucessor/lineage, sem duplicar.
- **sucessor nasce `proposed`** via `record_recovery_successor` (aprovação segue humana).

## Testes adicionados e gates

- **pgTAP** `supabase/tests/human_recovery_authority.test.sql`: **32/32**, plano 1..32, zero
  `not ok`, em transação com ROLLBACK contra o banco vivo. Cobre A–L do recorte: concessão
  feliz (+1, proposed, teto 4, consumo 3 preservado, checkpoint host-observed, escopo mínimo,
  impl excluída, lineage), replay idempotente, conflito de 2ª concessão, anti-loop de
  descendente, saldo disponível, autorização inválida, teto incompatível, compute pago,
  falha não-retryável, apiPath fora do excluded, modelo divergente, predecessor não-terminal,
  evidência host ausente, dono alheio (P0002), RLS.
- **TS codec** `packages/core/.../human-resume.test.ts`: **48/48** (payload válido verbatim,
  determinismo, campos obrigatórios, schemaVersion, UUID, faixas, vocabulário fechado,
  exports únicos/válidos, compute local/não-pago, malformed).
- **TS service** `apps/web/.../authorize-resume.test.ts`: **12/12** (fail-closed antes da RPC,
  derivação versão+failureEvent, classificação de erro rejected×operacional, replay persistido).
- **CLI** `apps/web/cli/{args,app,render}.test.ts`: **46/46** (parse `work authorize-resume`,
  `--plan` só nesse comando, runner exit 0/1/3, replay, render humano).
- **Regressão**: core `1474/1474` (69 suítes); web `cli/` `46/46`; application services de
  recovery adjacentes `34/34`. **typecheck** core + web limpos.

## CLI

`anima work authorize-resume <id> [--plan arquivo.json]` (`--json`; exit 0/1/2/3). Reusa o
MESMO application service da web (`authorizeResume`), sem regra nova na CLI:
CLI → application service → codec/contratos → RPC persistida. Sem `--plan`, replaya a
concessão persistida. NÃO aprova nem executa.

## Caso real (PIN-02) — fronteira HUMANA + infra, NÃO atravessada

A cadeia real segue exatamente no estado esperado pela RPC (conferido read-only):
`7b132de5` (replan) `failed`/v1, `max=used=1`; raiz `5b8e371d` (correction) `failed`/v1,
`2/3`; ledger `work_replans` pred=`5b8e371d` used=2 max=3 alloc=1; falha
`07664942` `retryable:true`, attempt `ab7e7b6f`; evidência host base `6ff4d43c…`/commit
`967008e5…`, `observedChangedFilesSinceStart=["packages/core/src/project-intake.test.ts"]`;
agregado da árvore correction→replan = 3, teto = 4; `excluded_scope` contém
`packages/core/src/project-intake.ts`; modelo `qwen3-coder:latest`; sem claim/execução ativa;
tabela de concessões vazia.

**Não fabriquei autorização humana real.** Materializar a concessão real é uma mutação
PERSISTENTE que cria um sucessor real e reabre uma cadeia esgotada — decisão humana. Além
disso, o Docker Desktop caiu no meio da sessão (npipe indisponível), bloqueando tanto a
concessão quanto a prova viva (host local + Ollama). A capability está PROVADA por fixtures
com rollback; o único passo restante é a decisão humana + infra.

Para atravessar (quando o humano ratificar e o Docker voltar):
`anima work authorize-resume 7b132de5-8ca1-436e-9d23-e4317d59aaea --plan <auth.json>`
com `aggregateCeiling:4`, `compute.preferred:qwen3-coder:latest`,
`diagnosis.apiPath:packages/core/src/project-intake.ts`. Efeito: concessão append-only +
sucessor `proposed` (+1, teto 4), predecessor permanece `failed`, consumo 3 preservado.
Depois: `anima work approve <sucessor>` e rodar o host local (fallback governado
`qwen2.5-coder:14b`) para UMA tentativa. Parar em `review`.
