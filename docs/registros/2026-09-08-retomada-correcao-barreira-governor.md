# Retomada supervisionada da correção — barreira do Governor

- **Data/tipo:** 2026-09-08 — prova viva local.
- **Objetivo:** retomar exclusivamente `8a2515d8-6967-463e-af2a-fd5d2b5e42a1`
  com `ollama/qwen3-coder:latest` e conduzi-lo até `review`.
- **Branch/HEAD:** `dev`, `55c45c0` no início e no fim.
- **Remotos:** `origin/dev=4ab99acf`; `origin/main=99bec54`, intacta.

## Reconciliação

A fonte persistida confirmou a lineage sem materialização nova: original
`ce90eb14` `failed`; seq1 `81836dde` `cancelled`; seq2 `01fdf66a`
`changes_requested`; e `8a2515d8` `approved` v2, único filho de `01fdf66a`,
zero `execution_started` e orçamento local intacto (0/3 no item; 0/6 do usuário).

Ollama respondeu localmente e confirmou `qwen3-coder:latest` instalado. Docker e
Supabase locais foram iniciados para consultar a fonte autoritativa. Um lease
temporário estritamente item/v2 foi criado e revogado ao encerrar a prova.

## Governor e resultado

A primeira volta recusou antes de criar attempt. Uma reavaliação após 45 s observou
transitoriamente `low/permit` (4.268.879.872 bytes livres de 17.042.591.744), mas a
amostra nova da volta voltou a recusar. A última reavaliação, espaçada em 60 s,
também recusou. O snapshot final observou 3.813.380.096 bytes livres e decidiu
`moderate/defer/resource_pressure`.

Não houve polling agressivo, alteração de thresholds, encerramento arbitrário de
processos, fallback remoto ou desativação do Governor. Nenhuma attempt foi criada;
logo não houve terminal, coder, gates ou Verifier. O provider/model permaneceu
exclusivamente `ollama/qwen3-coder:latest`; nenhuma chamada OpenAI, autoridade ou
compute pago ocorreu.

O item permaneceu `approved` v2. Não houve recovery/retry, seq4, accept,
integration, merge, push, publish ou deploy. `origin/main` permaneceu intacta; o
WIP externo, inclusive `autonomous-backlog-deps.ts:198`, foi preservado. HIGH-1
(`deriveExplicitReworkScope` poder interpretar mera menção de path) não foi alterado
e continua como dívida recomendada depois da prova.

## Próximo ponto exato

Quando a pressão estiver estavelmente `low`, renovar a supervisão somente de
`8a2515d8`, executar uma volta com Router pago desligado e
`ollama/qwen3-coder:latest`, e parar em `review` após coder, gates e Verifier. Não
criar novo successor nem aceitar ou integrar o resultado.
