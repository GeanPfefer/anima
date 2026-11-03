# TPC-01 — resultado da única attempt local autorizada

Data: 2026-10-01 (America/Sao_Paulo).

Successor 11a4ec12-506c-453a-9032-5ed8128590d7 aprovado v1 e preparado canonicamente. Attempt única ddc6e410-b52f-4d66-a486-61913bb338ba: 18:58:37.831 → 19:00:40.974 (123,143 s), estado final failed. Claim b8568734-9b9e-452d-b07a-dc144901a3e3 liberada às 19:00:40.999, attempt_finished.

## Barreira real

execution_failed / ollama_read_round_limit. Mensagem persistida: protocolo encerrou por ações desviadas em excesso após orçamento de leitura esgotado. Transcript host-observed: três ações search servidas (rounds 0, 1, 2), estado exploring, editRevision=0; depois termination=ollama_read_round_limit. Nenhuma edição, execução de comando do coder ou submissão observada no transcript. Não há evidência suficiente para atribuir causa ao prompt, parser ou qualidade do modelo sem investigação separada.

Evento de falha b61a8fff-b6b4-436f-a512-dec2be5e5245, seq 83739. Evidência system 4b7f65c8-2cd9-44b0-a12b-6064c499a2c5, seq 83741, outcome failed, backend ollama:qwen3-coder:latest, placement local, duração coder 91782 ms.

## Verifier e gates

Verifier não executado: nenhum resultado candidato foi produzido; verifierLive e verifierRecorded null. Gate final npm test --workspace=apps/web -- cli/args.test.ts não executado após edição, pois o coder falhou antes de qualquer edit. A maquinaria inclui baseline diferencial pré-coder; o resultado desse baseline não consta dos eventos persistidos desta falha e não deve ser declarado PASS/FAIL. Sem typecheck/build adicionais nesta prova.

## Diff e Git

Branch da attempt anima-work/ddc6e410-b52f-4d66-a486-61913bb338ba aponta à própria base f94bc5a2dc8076be40471d5f7810d81518cb8bfa. Diff base→branch vazio, zero arquivos/linhas alterados e nenhum commit novo da attempt. Worktree temporária foi descartada pelo executor; branch preservada.

HEAD/dev = origin/dev = 90cd08198dd0d05aadad57c490913d8c834e019a.
origin/main = 99bec54e3ab42bfe882a8686cd1385d8058b916e.
Refs remotas verificadas por leitura Git e iguais às refs locais. Sem fetch, push, merge, aceite, integração ou deploy. Documentação desta sessão permanece em alterações locais sem commit.

## Ollama

Ollama 0.32.15, RTX 5060 Ti, driver CUDA 13.4. Log de processo: OLLAMA_FLASH_ATTENTION=false; log do runner: flash_attn=disabled, n_ctx=8192, 49/49 camadas offloaded. Oito chamadas /api/chat ao qwen3-coder:latest, todas HTTP 200. Primeira chamada 81,724 s, load 51,511 s; demais 0,912–1,662 s. Soma observada de prompt_eval_count=23878 e eval_count=254 (contagens por chamada, não tokens únicos). Sem truncamento observado nas linhas de release do runner. Nenhum HTTP 500/crash CUDA nesta attempt. Isto comprova inferência no harness com flash desligado, não conclusão da tarefa.

## Invariantes e limitação do invocador

Predecessor 25c2c047-b1f3-40b6-8362-999aa0809a2b permanece failed v2, com apenas execution_started histórica 107997e2-ae41-469d-bbe0-c887658c7285; seus últimos eventos continuam seq 83729 de 2026-09-30. Successor tem exatamente uma execution_started e nenhum descendente. Zero paid_compute_authorizations e paid_compute_budget_events nos dois itens. Router/on-demand desabilitados, chaves OpenAI/RunPod esvaziadas no processo e fetch limitado a localhost/127.0.0.1:11434/54321. Nenhum provider externo ou compute pago.

Após concluir o host-turn e persistir o terminal, o scratch de invocação lançou ReferenceError: deadline is not defined em clearTimeout(deadline), antes de imprimir o resumo. Erro do invocador, independente da falha de protocolo. A tentativa terminou em 123 s, dentro do contrato 30 min. A verdade do resultado foi recuperada dos eventos canônicos; não houve reexecução. A inserção do timer adicional falhou no preparo do scratch; o limite de 30 min do contrato do executor/coder permaneceu preservado.

Parada cumprida: failed, claim liberada, sem retry e sem outro successor. Qualquer diagnóstico/fix posterior exige nova tarefa; nenhuma tentativa adicional autorizada.
