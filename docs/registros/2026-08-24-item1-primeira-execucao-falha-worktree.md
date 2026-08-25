# Primeira execução do Item 1 — falha na criação da worktree

- **Data/tipo:** 2026-08-24 — prova E2E operacional.
- **Item:** `0cedae21-433d-4842-8fbd-9045c5128bcf`, proposta 2.
- **Branch/HEAD:** `dev` em
  `a98f5bbcf8aefec8b13852226ec80a87d950d80b`, igual a `origin/dev`.
- **Resultado:** `RATIFIED_BACKLOG_TO_EXECUTION_V0_ITEM1_EXECUTION = NOT_PROVEN`.

## Trajetória observada

O clique real selecionou o ID exato do Item 1. O Governor havia observado pressão
baixa; o routing escolheu `worktree-v1` + `ollama:qwen3-coder:latest`. Foram
persistidos `work_routing_adjusted` e `work_routing_decided`, claim
`ddded29e-c6e1-4976-a2c6-2b379ebd47b5`, attempt
`937d402a-8d20-4750-b06b-9e0792dfd18f`, `work_started` e
`execution_started`. A criação da worktree falhou imediatamente, antes do coder,
com `checkpoint:worktree-create-failed`; o terminal foi `execution_failed` com
`retryable=true` e o claim foi liberado como `attempt_finished`.

## Efeito e contadores

- Duração entre claim e release: aproximadamente 116 ms.
- Work items: 63→63; eventos: 619→626; approvals 51→51;
  classificações 39→39; claims 41→42 (0 abertos); execution_started 41→42;
  work_started 43→44.
- Results 14→14; coder evidence 20→20; gate evidence 15→15; Verifier 11→11;
  focus 2→2; AI conversations 203→203.
- Item 1 terminou `failed`; Itens 2 e 3 permaneceram `approved` e não foram
  claimados/iniciados.
- Nenhuma branch `anima-work/937d…` e nenhuma worktree da tentativa ficaram
  registradas. Nenhum diff, commit de resultado, gate ou parecer do Verifier existe.

## Diagnóstico e fronteira

O processo `next dev` usado na prova não conseguiu gravar os metadados Git
necessários a `git worktree add`; a mensagem persistida foi truncada pelo limite
seguro do executor após `fatal: cannot…`. O mesmo ambiente exige elevação para
gravar `.git`, coerente com a falha observada. Reiniciar o host com autoridade
local adequada é correção operacional provável, mas não basta para retry:
`failed` é terminal na state machine atual e não há transição ratificada para
reexecutar uma falha retryable sem inventar estado.

Nenhum retry externo foi feito. Nenhum compute pago, cloud, autorização
financeira, integração, completion, PR, merge ou deploy ocorreu. Próximo
checkpoint: definir e provar uma reentrada governada para falha retryable (ou
ratificar outra remediação) antes de uma nova tentativa do Item 1.
