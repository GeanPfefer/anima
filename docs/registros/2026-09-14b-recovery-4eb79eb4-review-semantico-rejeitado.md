# 2026-09-14b — Recovery 4eb79eb4 até review, output semanticamente rejeitado

## Objetivo e estado inicial

Recovery operacional do `worktree-create-failed` de `d05bcab0`, preservando integralmente a
correction B1/B2/B3 e executando uma única attempt OpenAI a partir de `G:\anima\apps\web`.
Branch `dev`, HEAD `b14a32c1d7ca1d361f1a3c1519e2fbec351a0669`; `origin/main`
`99bec54e3ab42bfe882a8686cd1385d8058b916e`.

## Lifecycle e financeiro

- Authority órfã `c922b5be-9d26-4035-9405-af5f99a9f12a` revogada canonicamente com zero
  reservation e zero committed; nenhum settlement inventado.
- Successor `4eb79eb4-f6c4-40a5-b791-2e9d671a33c5`, lineage
  `991a0d58-5255-48bd-95c1-81c9b2a28024`, recovery sequence 1. Intent/proposal foram copiados
  integralmente de `d05bcab0`; único fato novo: recovery de `worktree-create-failed`.
- Approval e classification canônicos passaram sem alteração de política.
- Preflight gratuito: cwd `G:\anima\apps\web`, top-level `G:\anima`, base `ccb7dcc`; worktree
  destacada foi criada e removida com sucesso; nenhum ref/worktree da attempt anterior existia.
- Authority nova `7bd202af-c649-4efe-b70a-43e7a27d8ae0`; reservation
  `6bc73048-cd11-4194-ac22-c9492caaa269`, lease
  `provider-api:fc784191-a716-4f07-9ab0-826d6dd5abb9`, USD 1,50. Pricing permaneceu ausente:
  reservation aberta, não liquidada, `costSource=null`, committed contábil USD 1,50.
- Attempt única `fc784191-a716-4f07-9ab0-826d6dd5abb9`: 7 provider calls; usage factual
  40.341 input, 4.639 output, 44.980 total, 14.878 cached-input tokens; custo real `cost_unknown`.

## Output e gates

- Branch `anima-work/fc784191-a716-4f07-9ab0-826d6dd5abb9`; commit
  `5fad66796af8ceeb8ad3f175dfeba911c324caec`, pai `61eb2eb7ab1b4091e1a53604ef11b560ef99561f`.
- Diff contra `ccb7dcc`: 3 arquivos, +152/-10; todos dentro dos quatro paths autorizados.
- Seis gates canônicos passaram: primitive, store, adapter, caller vivo, C1 original e typecheck web.
- Verifier v2: `rejected`, 31 checks, 14 violações, 0 gaps. As violações são principalmente
  `criterion_covers_unknown_acceptance`; o item ainda chegou ao estado persistido `review`.

## Revisão semântica independente

O output NÃO satisfaz B1/B2/B3:

- **B1 ausente:** `post-turn-observation.ts` soma um campo inventado `actualCostUsd` das observações
  e chama uma RPC textual `settle_openai_actual_cost`, inexistente na árvore. Não busca reservation
  por lease, não usa usage provider-reported nem `ProviderPricingV1`, não chama
  `settleOpenAIActualCostReservation` e não adapta para `settlePaidComputeBudgetReservation`.
- **B2 ausente:** `autonomous-backlog-deps.ts` não foi alterado. O caller vivo não propaga
  reservation, usage, provider, model, pricing ou cohort para o adapter.
- **B3 ausente:** o novo teste usa `any`, injeta `actualCostUsd` e apenas espera a RPC inventada.
  O teste do router acrescenta somente uma asserção de que `persistPostTurnHostObservations` foi
  chamado com arrays vazios — exatamente o padrão proibido. Não prova pricing conhecido/nulo,
  usage ausente, incompatibilidades, moeda, over-reservation, replay ou correlação real.
- Os novos testes provavelmente distinguem mecanicamente `61eb2eb` pela expectativa da RPC nova,
  mas não distinguem a implementação material correta; portanto não satisfazem a prova semântica.

## Parada e invariantes

Item preservado em `review`; nenhum accept/request_changes automático, integration, merge, publish,
deploy ou push. RunPod/Ollama intocados; `origin/main` intacta. O WIP auxiliar da raiz permaneceu fora
da worktree/output. Parada exata: review alcançado, porém Verifier `rejected` e revisão independente
confirmam feature material ausente; decisão final permanece humana. Follow-up `task_dfd925f9` não executado.
