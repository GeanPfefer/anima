# Auditoria do context budget e barreira da correção após review

- **Data/tipo:** 2026-09-06 — auditoria, prova e reconciliação operacional.
- **Objetivo:** auditar o sucessor corretivo de `7a30d53`, reconciliar o `REQUEST_CHANGES` de `01fdf66a` e executar a correção somente pelo caminho canônico.
- **Branch/HEAD inicial e final:** `dev` / `31526ce02fc9489d79a3a95086f1792680ab511d`.
- **Remotos observados:** `origin/dev=4ab99acf80ec69156f7155e203da1bd46dd96529`; `origin/main=99bec54e3ab42bfe882a8686cd1385d8058b916e`.

## Provas da infraestrutura

- O commit `31526ce` sucede `7a30d53` sem amend/rebase e introduz teto absoluto de 200.000 tokens, cap operacional conservador de 64.000, capacidade declarativa por modelo/alias e invariantes efetivas de input + reserva de output.
- Sweep coder/executor: **186/186 PASS** em 7 suítes (incluindo `gpt-coder`, `ollama-coder`, protocolo, transcript, seleção, backend e placement).
- Testes focais de `gpt-coder`: **47/47 PASS**, cobrindo env ausente/inválido/gigante, limites, aliases, modelo desconhecido, declared versus operational, reserva, fetch admitido e recusa pré-provider.
- Testes de correction/recovery: **10/10 PASS**.
- O typecheck da árvore principal continua com o erro previamente conhecido em `autonomous-backlog-deps.ts:198`, causado pelo WIP supervisionado. O mesmo `apps/web/tsconfig.json` em worktree limpo de `31526ce`, ligado somente às dependências instaladas, passou sem erros; portanto não é regressão do patch.

## Estado canônico reconciliado

- `ce90eb14-810d-4125-833c-4c7b35666855`: `failed`, proposta v2, intacto.
- recovery seq1 `81836dde-94d7-4b58-98a6-955c585829dc`: `cancelled`, intacto.
- recovery seq2 `01fdf66a-b585-4ea3-a3f8-1942a01ba817`: `changes_requested`, proposta v1.
- Attempt revisada: `34f15d29-c33e-4dbf-9af3-4b0f023e2769`; resultado, evidência host-side e opinião do Verifier permanecem append-only.
- Evento `changes_requested` seq 51512 preserva integralmente o diagnóstico humano e referencia o resultado `4cf524fb-d01f-446c-9f89-64dc593a6e1a`.
- Autoridade paga `c7885bd9-268a-46b1-acd9-c8e25d1498bc` e reserva `30acc5d7-167e-476a-8439-573ce3ce3c14` permanecem como evidência; não foi fabricado settlement. A dívida `settled=NULL` permanece fora do escopo.

## Decisão e barreira encontrada

- Confirmado: `changes_requested` não é elegível em `autonomous_work_queue`; o executor autônomo não possui caminho canônico para nova attempt no mesmo item.
- O caminho publicado para correção é `correctReviewedWorkItem`, que deriva um successor `proposed` a partir do review e do checkpoint e persiste lineage append-only.
- A chamada real `anima work correct 01fdf66a...` falhou fechada, antes de persistir, com `derivation_refused (remaining_scope_empty)`.
- Causa comprovada: `planCorrectionFromReview` passa todos os `observedChangedFiles` como `preservedFiles`; `deriveResumeCorrectionSuccessor` remove esses arquivos do escopo restante. Como a attempt revisada alterou exatamente os dois arquivos permitidos e o review exige corrigir esses mesmos dois arquivos, o escopo restante fica vazio. O contrato atual serve apenas a complemento em arquivos ainda não tocados, não a rework incremental dos arquivos revisados.

## Invariantes e efeitos externos

- Nenhum correction-successor/seq3 foi criado; a lineage continua contendo somente seq1 e seq2 do predecessor original.
- Nenhum work item foi aprovado, executado, aceito ou integrado; nenhuma nova autoridade/reserva foi criada.
- Nenhum push, PR, merge, deploy ou alteração de `origin/main` foi realizado.
- O push de `dev` permanece retido porque o critério solicitado exigia também uma nova execução verde, impossível após a barreira canônica.

## Próximo ponto exato de retomada

Definir e aprovar uma evolução do contrato de correction-after-review que permita selecionar explicitamente os arquivos do checkpoint que podem ser reabertos para correção, preservando o restante, com envelope reduzido, lineage append-only, idempotência e testes. Depois disso: materializar exatamente um successor, aprovar/classificar de forma governada, executar até `review` e parar na fronteira humana.
