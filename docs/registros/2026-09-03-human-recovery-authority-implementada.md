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

## Caso real (PIN-02) — RATIFICADO, tentativa única consumida e falhou; anti-loop segurou

Numa segunda mensagem o usuário RATIFICOU explicitamente esta cadeia específica: +1
tentativa, teto agregado 4, compute local, `qwen3-coder:latest`→`qwen2.5-coder:14b`, sem
pago, sem 2ª extensão, parar em `review`. Docker/Supabase já de volta. Executei pela CLI
oficial e pelos mecanismos padrão do runtime, tudo sob a identidade residente (Bearer/RLS,
sem service_role):

1. **Concessão real materializada** — `anima work authorize-resume 7b132de5 --plan auth.json`
   → authorization `96358464`, sucessor `2b860033`, `previousConsumed=3`, `additionalAttempts=1`,
   `aggregateCeiling=4`, `replayed=false`. Tabela append-only: `previous_authorized=3`,
   `previous_consumed=3`, `additional_attempts=1`, `aggregate_ceiling=4`, `envelope_root=5b8e371d`.
   Sucessor `proposed`/v1, `max_attempts=1`, `human_resume` embutido, `resume_from_checkpoint`
   base `6ff4d43c…`, escopo mínimo `project-intake.test.ts`, impl `project-intake.ts` excluída.
   Predecessor `7b132de5` intacto `failed`; consumo histórico 3/3 preservado.
2. **Aprovação** — `anima work approve 2b860033` → `approved`.
3. **Classificação** — `ensurePlannedProjectClassification` → `work_intelligence_classified`
   (determinístico, sem LLM): o sucessor humano-retomado integra ao pipeline autônomo como
   qualquer sucessor de recovery. Elegível na `autonomous_work_queue`.
4. **Pedido escopado** — `request_autonomous_execution(2b860033, v1)` → `work_approved` com
   `authority=autonomous_execution_request` (event `a92015f1`). Escopa o host-turn a SÓ este item.
5. **Host bounded, 1ª volta (RAM 16.5%): Governor NEGOU** (`resource_pressure` < reserva 25%),
   `itemsTouched=0`, tentativa PRESERVADA. Não burlei o gate nem matei apps do usuário; a
   ratificação era condicional a "se o Governor permitir".
6. **Host bounded, 2ª volta (RAM 36.6% ≥ 25%): Governor PERMITIU** — a tentativa única rodou.
   Envelope de fallback governado (`ANIMA_CODER_VRAM_GB=16` + allowlist qwen3-coder:latest(18)/
   qwen2.5-coder:14b(10)); Ollama subido via `ollama serve` (binário/modelos já em disco).
   Attempt `7802904a` (~26s): routing → claim → worktree isolado `anima-work/7802904a` →
   coder. **Modelo: `qwen2.5-coder:14b` (fallback governado OBSERVÁVEL)** —
   `CoderModelSelectionEvidenceV1.modelSelection = {selected: qwen2.5-coder:14b, preferred:
   qwen3-coder:latest, reason: preferred_exceeds_capacity, capacityGb: 16}`.

**Desfecho: a tentativa FALHOU determinísticamente ANTES dos gates** —
`execution_failed [ollama_ambiguous_replacement]` ("before" ocorre 2× em
`packages/core/src/project-intake.test.ts`; esperado exatamente 1), `retryable:true`. O coder
do 14b produziu uma âncora de edição ambígua; o `replace_exact` recusou fail-closed (sem fuzzy);
nenhum gate/Verifier alcançado. Mesma CLASSE de falha (âncora) do histórico — a barreira aqui é
a robustez de edição do 14b, não a lógica da capability.

**Anti-loop verificado (parte da prova):** sucessor `2b860033` terminou `failed`, `max=used=1`
(budget esgotado), 0 claim aberto, **0 lineage e 0 grant derivados dele** — nenhuma recovery
automática. Agregado da árvore correction→replan→human-resume = **4/4** (exatamente o teto).
Predecessor `7b132de5` intacto `failed`; PIN-02 original `8e9fd82b` intacto `changes_requested`;
grant `96358464` append-only único. Consumo histórico jamais reescrito.

**Parei na fronteira humana:** não alterei `max_attempts`, não emiti nova Human Recovery
Authority, não criei sucessor adicional, não fiz replan/recovery para contornar o anti-loop.
A decisão volta ao humano. Se o humano quiser nova tentativa, é uma NOVA autoridade explícita
(outra concessão), não automática — e o gap conhecido é a robustez de edição do coder local.
