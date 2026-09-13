# Recovery seq. 4 — binding vivo de actual-cost settlement OpenAI

- **Data/tipo:** 2026-09-13 — desenvolvimento + prova local + materialização governada.
- **Objetivo:** continuar o successor falho `4a36b0a5…` sobre uma base onde settlement store/RPC e a primitive coexistem, concluir adapter/caller/testes e parar antes de compute pago.
- **Worktree:** `anima-recovery-base`, detached; HEAD inicial `b14a32c`, HEAD final `0bea4c8`.
- **Commits:** `ccb7dcc` materializa somente `openai-actual-cost-settlement.ts` e seu teste; `0bea4c8` conclui binding e testes vivos.
- **Lifecycle:** successor `5895b59c-0568-483a-9731-2abd45fb4b90`, lineage `9497140e-37af-44fb-baf5-175cf6fe8c0f`, seq. 4 da raiz `3b0b3c57…`; `proposed` v2; base `ccb7dccd6ffa25d65ce443657eddb7c97dd4b6fe`. A v2 incluiu explicitamente o teste do caller no escopo.
- **Mudança:** o pós-turno correlaciona reservation por `provider-api:<attemptId>`, projeta usage terminal provider-reported e adapta o audit da primitive para `{ reservationId, settled: actualCost, costSource }`. A fonte opcional de pricing é explícita/versionada; ausência mantém `cost_unknown`.
- **Provas:** primitive 2/2; store settlement 10/10; adapter pós-turno 2/2; caller `runTurn` 8/8; C1 original 4/4; web typecheck verde; `git diff --check` verde.
- **Invariantes:** predecessor `4a36b0a5…`, attempt `2a0011ef…`, output `41e27ec8…`, authority/reservation/evidências históricos intactos; WIP amplo do `dev` preservado; `origin/main=99bec54` intacta; sem push, RunPod ou chamada paga OpenAI.
- **Limite:** o successor permanece `proposed`; nenhuma approval/classification/authority/claim/attempt foi criada. Chegar a `review` pelo contrato autônomo ainda exige uma attempt correlacionada. O caminho manual governado também cria uma attempt comandada; não há promoção honesta do commit hand-authored diretamente a `review` sem attempt.
- **Próximo ponto:** decisão humana sobre aprovar/classificar o successor e autorizar a attempt necessária. Antes de qualquer provider call, informar provider/modelo/teto/estimativa e obter a autoridade financeira correspondente.
