# Rework explícito após review e barreira do Resource Governor

- **Data/tipo:** 2026-09-07 — desenvolvimento + prova viva local.
- **Objetivo:** corrigir `remaining_scope_empty`, materializar exatamente um
  correction-successor de `01fdf66a` e executá-lo somente com Ollama local.
- **Branch/HEAD:** `dev`, `af4cae5` → `75372e2` no patch; este registro é o commit
  documental subsequente.
- **Remotos observados:** `origin/dev=4ab99acf`; `origin/main=99bec54`, intacta.

## Mudança e causa

`planCorrectionFromReview` convertia todos os `observedChangedFiles` do checkpoint
em `preservedFiles`; `deriveResumeCorrectionSuccessor` removia todos eles do escopo
e `validateCorrectionSuccessor` exigia subconjunto estrito. Como os dois arquivos
do review eram todos os paths já tocados, `remaining_scope` ficava vazio.

O commit `75372e2` introduz `rework_scope` explícito, extraído apenas de paths do
escopo aprovado nomeados no `REQUEST_CHANGES` (basename somente quando inequívoco),
e deriva na ordem original, sem duplicatas:

`effective_correction_scope = rework_scope ∪ remaining_scope`.

Paths tocados não autorizados continuam em preservado/excluído; path externo recusa;
a composição é persistida em `execution_spec.correction_scope` e revalidada. A
recovery comum continua exigindo subconjunto estrito.

## Provas do patch

- Focais core/web: **42/42 PASS** em 4 suítes.
- Core completo: **73/73 suítes, 1566/1566 testes PASS**; typecheck core limpo.
- Sweep `apps/web/lib/work-orchestration`: **68 suítes PASS, 919 testes PASS**;
  3 suítes não compilaram exclusivamente pelo WIP externo já conhecido em
  `autonomous-backlog-deps.ts:198` (`p_attempt_id: null` versus tipo `string`).
- Typecheck web parou exclusivamente no mesmo erro externo. O arquivo não foi tocado.
- `git diff --check`: limpo antes do commit.

## Prova viva e lineage

- Predecessor `ce90eb14`: `failed` v2, intacto.
- Seq1 `81836dde`: `cancelled`, intacto.
- Seq2 `01fdf66a`: `changes_requested` v1; attempt revisada `34f15d29`, evidência intacta.
- `work correct 01fdf66a` materializou exatamente uma seq3
  `8a2515d8-6967-463e-af2a-fd5d2b5e42a1`, lineage
  `18d638af-1f7e-4afd-8d9a-66e962c114f8`; repetição retornou `replayed:true`.
- Como o spec herdado ainda pinava OpenAI, a mesma seq3 foi revisada pela RPC
  canônica `revise_work_proposal`, append-only, para proposta v2 com
  `coder_backend=ollama`, `model=qwen3-coder:latest`, e então aprovada.

## Barreira e efeitos

O Ollama local foi iniciado e o modelo `qwen3-coder:latest` foi confirmado instalado.
Antes de criar attempt, o Resource Governor observou pressão `moderate` e devolveu
`defer/resource_pressure`. A proteção não foi desligada; a supervisão temporária foi
revogada. Estado final da seq3: `approved` v2, **zero attempts**, pronta para retomada.

ZERO chamadas pagas foram feitas nesta sessão. Não houve autorização/reserva paga,
acceptance, integration, merge, push, publish ou deploy. `origin/main` permaneceu
intacta. Docker/Supabase e Ollama locais foram os únicos serviços iniciados.

## Próximo ponto exato

Quando a pressão do host permitir: renovar `work supervise 8a2515d8`, confirmar a
classificação/fila e executar **o mesmo item** com router pago desligado e
`ollama/qwen3-coder:latest`; preservar anti-loop/budget e parar em `review`. Não criar
outro successor e não aceitar/integrar/publicar.
