# Prova paga gpt-5.6-sol em bd4092af: router por lineage e covers de sucessor

**Data:** 2026-09-25  
**Tipo:** prova real paga + desenvolvimento  
**Branch:** `dev`  
**HEAD inicial:** `a63717c`  
**HEAD final:** commit que contém este registro (consultar `git log -- this-file`)

## Objetivo

Retomar após reboot a lineage de correção de `a703e92f` (getEraForLevel) usando
compute forte (`gpt-5.6-sol`, `reasoning=high`) sob authority humana explícita e
remover as barreiras estruturais encontradas no caminho.

## Reconciliação pós-reboot

- `dev` = `a63717c` (29 commits à frente de `origin/dev` `8fe56d4`, sem push);
  `origin/main` = `main` = `99bec54`, intacta.
- Docker estava parado; ao iniciá-lo, os containers `supabase_*_anima` voltaram
  sozinhos. Nenhum `db reset`. Resident host e Ollama não estavam rodando.
- Fila vazia, nenhuma claim aberta, nenhum item `in_progress`, nenhuma authority ativa.
  Reservas históricas `cost_unknown` preservadas (inalteradas).
- Lineage `a703e92f`: seq1 `bc407a1b` (`proposed`), seq2 `d0c7ad98` (`failed`, 3/3
  attempts locais `qwen2.5-coder:14b`, todas `ollama_submit_gate_unsatisfied` —
  a #3 por orçamento de leitura exploratória esgotado mesmo após `b8750a5`),
  seq3 `bd4092af` (`proposed` v1). Checkpoint `9a60f42` íntegro.
- `gpt-5.6-sol` existe na API (GET `/v1/models`, sem custo).

## Barreira 1 — router cego à lineage (`fc53649`)

`bd4092af` nasceu sem histórico; o Compute Router V1 lia só o histórico do próprio
item e teria selecionado o qwen local pela 4ª vez (`local_sufficient`). Além disso,
o regex rodava sobre o histórico inteiro: contava falhas de attempts OpenAI (que
reusam os códigos `ollama_*`) e as próprias razões de roteamento anteriores.

Correção: `deriveLocalFailureSignal` (core, puro) — só attempts com placement local
contam, eventos `*routing*` são ignorados, `ollama_submit_gate_unsatisfied` ⇒
`no_progress`; `routeCompute` agrega o original e os successors de sequência menor
(`work_recovery_lineage`). Sem authority, o resultado continua
`waiting_for_human_authorization`. Preview read-only: sinal só-do-item `none`,
com lineage `no_progress`.

Consequência conhecida: uma lineage com `no_progress` local deixa de ser roteada
localmente pelo Router ligado; retomar local exige decisão de operador.

## Execução paga

Termos humanos exatos: `openai` / `openai-api` / `provider_api:gpt-5.6-sol`,
teto US$3,00, 30 min, validade 2h, 1 item. Ato registrado:

- `bd4092af` aprovado v1 (autorização explícita do humano nesta sessão) e classificado
  pela política vigente (determinística, sem provider).
- Authority `43509ab1-6453-4847-a44b-577652d0f3c9`.
- Uma volta do host (Router V1 ligado só no processo; `ANIMA_CODER_MODEL=gpt-5.6-sol`,
  `ANIMA_OPENAI_CODER_REASONING_EFFORT=high`, timeout 300 s/chamada, saída 32000).
- `compute_routing_decided`: `selected` `openai:gpt-5.6-sol`, `local_no_progress`.
- Attempt `0500e016-dfe9-478b-aaaa-a0831a37e7db`: 26,8 s, 6 chamadas,
  16.388 tokens de entrada (7.395 cached), 802 de saída. Commit `7ccc777` na branch
  `anima-work/0500e016-…`: +8 linhas só em `levels.test.ts` (abaixo de MIN_LEVEL ⇒
  primeira era; acima de MAX_LEVEL ⇒ última era). Gate host `levels.test.ts` verde;
  escopo observado limpo; `levels.ts` do checkpoint intacto.
- Item em `review`. Verifier `rejected`: 3 × `criterion_covers_unknown_acceptance`.

## Barreira 2 — covers herdados condenavam todo sucessor (`a97ad40`)

O sucessor espelhava os `covers` do gate do original — que apontam para o aceite do
ORIGINAL — enquanto sua proposta substitui o aceite. Todo sucessor (correção ou
decomposição) cujo original declarasse `covers` nascia com violações garantidas; e,
sob o `claim_kind: gate_assertion` do enriquecimento, esses covers ainda
superestimariam afirmações substantivas. A rejeição de `bd4092af` é artefato do
envelope, não do resultado.

Correção: `buildSuccessorIntent` remove `covers` herdados; a correção governada liga
o gate só ao meta-critério funcional. Regressões vermelhas no código antigo (2) e
verdes com a correção. O envelope persistido de `bd4092af` NÃO foi reescrito.

## Gates

- `packages/core`: 97 suítes, 2000/2000 PASS; `tsc --noEmit` PASS.
- `apps/web`: `tsc --noEmit` PASS; `review-correction-orchestration` +
  `decomposition-orchestration`: 21/21 PASS.
- `git diff --check`: PASS.
- Flake de infraestrutura: um `JWT issued at future` transitório logo após o reboot
  (relógios host/container conferidos iguais em seguida).

## Financeiro

Reserva `b1239ccb-12f4-4e36-9871-b2b7dd631dc1` de US$3,00 **aberta**
(`costSource=null`, authority com `remaining=0`): barreira B1 (settlement de custo
real não ligado; `pricing=null`), congelada por decisão humana anterior — não
liquidada nem anulada. Custo real estimado é uma fração pequena do teto, mas não há
pricing versionado para afirmá-lo. Qualquer nova attempt paga exige NOVA authority.

## Efeitos externos

Chamadas OpenAI pagas só da attempt `0500e016`. Sem push, PR, merge, RunPod, deploy,
migration ou alteração de `origin/main`. `.worktrees/`, `watch4-sensors.txt` e
`apps/web/.env.local` preservados.

## Fronteira humana e retomada exata

1. `bd4092af` está em `review`: o humano revisa `7ccc777` e decide (`work accept` /
   UI, ou `request-changes`). O parecer `rejected` do Verifier é explicado acima.
2. B1 (settlement real / pricing de `gpt-5.6-sol`) segue congelado: cada attempt paga
   imobiliza o teto inteiro da authority.
3. Para o resident host usar compute forte sozinho, o operador precisa ligar
   `ANIMA_COMPUTE_ROUTER_V1_ENABLED=1` e as variáveis do coder OpenAI no ambiente dele;
   hoje isso só ocorre em scripts de volta única.
