# 2026-09-25j — Correção dev-readiness: única execução paga até a primeira barreira

## Objetivo e estado inicial

- Branch `dev`; HEAD inicial `86db1f1`.
- Successor `7610b066-0fe1-4004-b9a0-fe18e6e51ca3`, lineage
  `d72ac677-21a9-4c53-8b6b-efcd5a675c5b` (`f19ac716… → 7610b066…`, seq. 1).
- Reconciliado antes da mutação: item `approved`, preferência explícita
  `provider_api/openai/gpt-5.6-sol`, Router em `waiting_for_human_authorization`
  (`1eaf95da-c46e-529d-b61c-d5733ee6f732`), zero authority, attempt e reserva do
  successor; Web, Supabase e Resident Host vivos.

## Authority, roteamento e ledger

- Comando canônico executado uma única vez:
  `npm run anima -- work authorize-compute 7610b066-0fe1-4004-b9a0-fe18e6e51ca3 --max-usd 3 --max-minutes 30 --valid-hours 2`.
- Authority `5f6b92ea-fc2f-45fe-8483-878f07c7704c`, OpenAI/OpenAI API,
  `provider_api:gpt-5.6-sol`, USD 3, 30 min, válida até `2026-09-25T22:35:06.956Z`.
- Resident Host consumiu a authority normalmente. Router selecionou OpenAI
  `gpt-5.6-sol`, decision `beb08b8f-9016-4615-a5e7-e477f07bb740`; o routing de
  trabalho persistiu esforço `strong`.
- Attempt única `92607a82-e382-44e2-ac6b-784372246f1b`; execução de
  `20:35:20.679Z` a `20:36:57.413Z` (aprox. 96,7 s).
- Reserva `3b13afab-ff83-4427-b02a-b21d449daa33`, USD 3, permanece aberta e
  `cost_unknown`, sem settlement ou void artificial. Uma authority, uma attempt,
  uma reserva; nenhum retry.

## Execução e primeira barreira

- Provider usage persistido: 10 chamadas; 68.063 input tokens (13.311 cached),
  4.632 output tokens, 72.695 total.
- O coder leu e editou somente
  `apps/web/app/api/dev-readiness/route.ts` e `route.test.ts`: reduziu readiness às
  duas variáveis Supabase, removeu `ANIMA_RESIDENT_*` e deixou apenas `GET` como
  export da rota.
- Primeira rodada do teste focal falhou porque o teste tentou atribuir diretamente
  `process.env.NODE_ENV` (propriedade readonly). O coder corrigiu essa parte.
- Segunda rodada do teste focal falhou com seis testes vermelhos porque
  `Response` não existe no ambiente Jest atual. O coder esgotou a reserva pós-edit
  sem corrigir o harness do teste, sem gate verde e sem revisão final do diff.
- Terminal persistido: `ollama_submit_gate_unsatisfied`. O rótulo é legado/genérico
  do harness; a evidência de roteamento e uso confirma OpenAI, e Ollama não foi usado.
- Classificação da barreira: **modelo/contexto de execução**, materializada como
  falha de gate focal antes do submit. Não é falha do Router, authority/ledger,
  worktree ou Verifier.

## Diff, commit, gates e Verifier

- A worktree efêmera foi removida no cleanup; a branch
  `anima-work/92607a82-e382-44e2-ac6b-784372246f1b` continua no checkpoint
  `d1d6c5d` e nenhum commit novo foi produzido. As edições não foram submetidas.
- Gate focal: **FAIL** no coder (2 execuções; última: 1 suíte, 6 testes falhos,
  `ReferenceError: Response is not defined`).
- Typecheck: **não executado**.
- Next build: **não executado**.
- Gates host-side: **não executados**, pois não houve submit.
- Verifier: **não executado**. Estado final do item: `failed`.

## Invariantes e efeitos externos

- Nenhuma attempt manual, `_session`, retry automático ou nova paid authority.
- Nenhum push, PR, merge, deploy, integração ou alteração de `origin/main`.
- Nenhuma alteração em reservas históricas; B1 permanece congelado.
- A única chamada externa material foi o compute OpenAI autorizado acima.

## Próximo ponto exato de retomada

O item esgotou `max_attempts = 1`. Antes de qualquer novo gasto, é necessária nova
decisão humana e um sucessor/recovery governado. O diagnóstico para o próximo ciclo
é concreto: o teste real do handler precisa fornecer o runtime Fetch/`Response` de
forma compatível com o Jest do repositório (sem export auxiliar na Route Handler),
então passar teste focal, typecheck e Next build antes do submit.
