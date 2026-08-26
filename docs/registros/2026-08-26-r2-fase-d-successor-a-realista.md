# Plano 003 R2 — Fase D no Successor A realista

- **Data/tipo:** 2026-08-26 — experimento local, sem consumir attempt canônica.
- **Branch:** `dev`.
- **Objetivo:** testar `current` vs `r2` no alvo realista do Successor A antes de qualquer promoção do protocolo de âncora.
- **Baseline da fixture:** commit `4857530`.
- **Work item real relacionado:** successor `27c8d1ba-e37f-4587-8838-0aa7e6f7e618`.
- **Attempt real preservada:** `311ec98b-9746-4868-bc12-c48bd486dd58`; nenhuma nova attempt foi criada ou consumida.

## Fixture realista

O harness ganhou uma fixture opt-in `successor_a_realistic`, separada das sete fixtures sintéticas históricas.

Ela carrega por `git show` os dois arquivos do baseline `4857530`:

- `packages/core/src/work-orchestration/work-routing.ts`
  - sha256 `af1026110c68da47dc9ecc31241a7b3062b36b3555c721ec3fc230bc19f9d716`
- `packages/core/src/work-orchestration/work-routing.test.ts`
  - sha256 `e987d719e1856a2ec93c1e674fdcb90a1c57a4e45839c9062b4325089d78f712`

O default do harness continua sendo somente as fixtures sintéticas históricas; a fixture realista exige seleção explícita.

## Configuração do smoke

- modelo: `qwen3-coder:latest`
- protocolos: `current,r2`
- classe: `successor_a_realistic`
- reps: `1`
- seed: `20260826`
- `maxReadRounds=3`
- `num_ctx=8192`
- `num_predict=1536`
- `temperature=0`
- `r2CyclePolicy=per-protocol`

O primeiro disparo falhou antes do modelo por `ollama_transport_error`, pois o Ollama estava desligado. Esse run foi removido e não é tratado como evidência.

Após iniciar Ollama `0.32.15`, o smoke foi repetido sob a mesma configuração.

## Resultado observado

### current

- resultado: `ollama_read_round_limit`
- chamadas: 4
- respostas de leitura: 4
- requests de leitura: 4
- nenhuma edição
- formas:
  - `lineRange-only ×1`
  - `search+lineRange ×3`
- modos efetivos:
  - `lineRange ×1`
  - `search ×3`

Sequência observada:

1. busca por `export function selectWorkRoute`;
2. leitura `120–140`;
3. nova busca por `selectWorkRoute` na região `126–180`;
4. repetição da mesma busca/região;
5. limite de leitura.

### r2

- resultado: `ollama_read_round_limit`
- chamadas: 4
- respostas de leitura: 4
- requests de leitura: 4
- nenhuma edição
- mesmas classes gerais de leitura do controle.

O R2 estava efetivamente ativo:

- call 0: ainda sem anchor disponível;
- calls 1–3: o prompt continha `replace_anchor` / `anchor_id`;
- nenhuma resposta do modelo utilizou `replace_anchor`;
- o modelo continuou pedindo leitura e terminou em `ollama_read_round_limit`.

A sequência final divergiu levemente do controle: em vez de repetir exatamente o mesmo range na última chamada, o modelo pediu o símbolo `WorkRoutingCandidateV1`. Isso não produziu transição para edição.

## Conclusão

A Fase D reproduziu no alvo realista a mesma classe de falha vista na execução canônica do Successor A.

O R2 foi disponibilizado corretamente ao modelo, mas não evitou o `read-stalling`. Portanto, neste alvo, o gargalo ocorre antes da materialização de uma edição verificável: o modelo continua investigando mesmo quando já existem anchors host-mediated disponíveis.

Este resultado:

- não invalida o ganho previamente observado do R2 em classes como `multi_locate`;
- não justifica promover R2 globalmente;
- não justifica uma campanha N=8 do mesmo A/B neste alvo antes de investigar o estágio anterior de leitura/progresso;
- enfraquece especificamente a hipótese de que R2, sozinho, resolva o Successor A.

## Próxima direção

Não existe atualmente guard host-side de progresso/deduplicação de leitura. `ServedRead` preserva apenas `path`, `sha256` e `slice`, enquanto a solicitação normalizada (`search`, `lineRange` e parâmetros efetivos) é descartada após servir o trecho.

O próximo substrato relevante é **ServedRead Provenance V1**, já aprovado separadamente, para preservar essa proveniência sem alterar o slice entregue. Com isso, um futuro recorte próprio poderá investigar um `Read Progress Guard` determinístico, fail-closed e sem aumentar `maxReadRounds`.

## Provas

- `npm run typecheck --workspace=apps/web` — PASS.
- import de `realistic-fixtures.ts` pelo loader do harness — PASS.
- hashes do baseline emitidos e preservados.
- `git diff --check` — PASS.
- nenhum banco, claim, work item, attempt, provider pago, egress ou integração externa foi utilizado.
