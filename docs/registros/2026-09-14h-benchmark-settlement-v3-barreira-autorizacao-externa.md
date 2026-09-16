# 2026-09-14h — Benchmark settlement V3: barreira externa pré-attempt

Data: 2026-09-14

## Objetivo

Reexecutar o mesmo settlement OpenAI B1/B2/B3 que falhou no harness restrito, agora
como benchmark do Coding Harness V3, com uma única attempt paga e parada em `review`
ou na primeira barreira real.

## Estado inicial e reconciliação

- Branch `dev`; HEAD inicial/final `b14a32c1d7ca1d361f1a3c1519e2fbec351a0669`.
- `origin/main` permaneceu `99bec54e3ab42bfe882a8686cd1385d8058b916e`.
- WIP amplo preexistente foi preservado; nenhum arquivo foi normalizado ou descartado.
- O item anterior `571d29be-2912-4775-80e0-ba8df1e00a5e` foi confirmado `failed` v2,
  claim liberada, sem output revisável. Sua attempt `77ca3038` falhou antes de editar
  por `ollama_invalid_response_schema` (>8 leituras).
- A reservation histórica `56245160` da authority `70b4129f` segue aberta,
  `cost_unknown`; a reservation anterior `6bc73048` também não foi mutada.

## Prova do Coding Harness V3

- Core focal: 3 suites / 18 testes PASS (`agentic-runtime-policy`,
  `workspace-access-policy`, `command-execution-policy`).
- Web focal: 5 suites / 257 testes PASS (`ollama-protocol`, `ollama-coder`,
  `gpt-coder`, `worktree`, `worktree-executor`).
- Auditoria estática confirmou `GptCoderBackend` delegando ao loop compartilhado com
  `STRONG_REMOTE_AGENTIC_RUNTIME_PROFILE_V1` e o executor injetando SEARCH/GLOB,
  READ amplo, WRITE restrito, EXEC/TEST e Git read-only governados. Network permanece
  `denied` na command policy.
- CWD operacional previsto: `G:\anima\apps\web`. Nenhuma worktree do novo item existia
  antes da tentativa.

## Successor, aprovação e autoridade

- Successor canônico: `7e0a75cf-560b-45a1-8097-5631c631ad05`, lineage
  `ea6cc963-6bb2-4d22-9066-fb311873cd6f`, recovery sequence 1 a partir de `571d29be`.
- Estado após materialização: `proposed` v1; base
  `ccb7dccd6ffa25d65ce443657eddb7c97dd4b6fe`; resume de `5fad66796af8`; exatamente
  quatro arquivos materiais; B1/B2/B3 e strong harness preservados; requisito V3
  explícito; `max_attempts=1`, 30 minutos, capability `programming`, impact `low`.
- Aprovação humana registrada e classificação canônica concluída (`replayed=false`).
- Authority nova e exclusiva: `fc01585e-b334-415e-a730-a0cd8b39536d`, OpenAI
  `gpt-5.6-terra`, teto US$1,50, duração 30 min, válida até
  `2026-09-14T23:59:59-03:00`. Ledger logo após grant: reserved/committed 0,
  remaining 1,50; nenhuma reservation.

## Barreira e efeitos externos

O comando que iniciaria `runProjectBacklogHostTurn` foi recusado pela fronteira externa
antes de criar o processo. A revisão de segurança considerou que a chamada paga poderia
exportar conteúdo sensível do repositório à OpenAI e exigiu autorização explícita
adicional sobre payload e destino. A própria decisão proibiu workaround, execução
indireta ou nova tentativa sem essa autorização.

Consequências factuais:

- zero claim nova;
- zero attempt;
- zero reservation nova;
- zero provider calls;
- usage ausente;
- custo realizado zero (não há settlement; a authority nova apenas permanece sem uso);
- zero trajetória do coder, output commit, diff material, gates, strong harness ou
  Verifier;
- B1/B2/B3 não foram medidos no V3;
- nenhum RunPod, integração, accept, merge, deploy ou push ocorreu.

## Comparação e parada

O harness antigo continua com os fatos conhecidos: `61eb2eb` FAIL, `5fad667` FAIL,
`0bea4c8` PASS; a attempt `571d29be` falhou no limite de leitura pré-edit. O V3 teve
seu wiring e testes focais comprovados, mas a comparação de capacidade sobre a tarefa
não chegou a ocorrer porque a execução externa foi barrada antes da attempt.

Próximo ponto exato: obter autorização humana explícita e informada para enviar à
OpenAI `gpt-5.6-terra` o contrato B1/B2/B3 e os conteúdos de arquivos do repositório
que o runtime V3 selecionar para READ/SEARCH, até US$1,50 e 30 minutos. Depois,
revalidar a authority `fc01585e` (ou criar outra se expirada) e executar no máximo uma
attempt; não reexecutar o comando anterior por contorno.
