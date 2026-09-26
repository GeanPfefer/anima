# 2026-09-26 — Continuidade de evidência em recoveries e retomada de dev-readiness

## Objetivo e estado inicial

- Tipo: desenvolvimento e preparação operacional sem compute.
- Branch `dev`; HEAD inicial `64708c0f1e24db308d9091f698956999e9d4c446`.
- `origin/main` observado em `99bec54e3ab42bfe882a8686cd1385d8058b916e` e deixado intacto.
- WIP reconciliado: 12 arquivos rastreados modificados e três novos arquivos do contrato de recovery evidence; `.worktrees/`, scripts `_session` e `watch4-sensors.txt` preservados e fora do commit.
- Barreira operacional: attempt `92607a82-e382-44e2-ac6b-784372246f1b`, item `7610b066-0fe1-4004-b9a0-fe18e6e51ca3`, falhou em `Response is not defined` apesar de a lineage já possuir correção host-observed comprovada.

## Mudança e decisão

- Commit `9035cef` (`Preserve evidências comprovadas entre recoveries`).
- O Supervisor reconstrói ancestors da lineage a cada volta e seleciona somente um mesmo gate observado como FAIL, seguido de edição aplicada em arquivo autorizado e PASS numa revisão posterior.
- O contexto é limitado a quatro itens e oito ancestors, redige segredos/caminhos, limita diagnóstico/patch e não lê resposta livre nem raciocínio do provider.
- Cada item referencia work item, attempt e evento. A redação afirma apenas a sequência observada; não universaliza causalidade.
- Itens legacy/sem lineage continuam com o caminho anterior (`null`). Nenhum budget, read round ou post-edit reserve foi aumentado.

## Provas

- Focais web: 5 suítes, 135 testes, todos verdes.
- Core completo: 100 suítes, 2.035 testes, todos verdes.
- Web completo: 145 suítes, 1.807 testes, todos verdes.
- Typecheck: cinco workspaces verdes.
- Build Next de produção: verde, 66 páginas estáticas geradas.
- `git diff --check` e `git diff --cached --check`: verdes.
- Ruídos conhecidos: warnings React/console já existentes no sweep web; nenhuma falha.

## Invariantes e efeitos externos

- Nenhum push, PR, merge, deploy ou alteração de `origin/main`.
- Nenhuma authority paga, reserva, chamada OpenAI, attempt ou acionamento de Ollama nesta sessão até este checkpoint.
- B1 permanece congelado; reservas históricas não foram tocadas.

## Continuação operacional

Abaixo será anexado o resultado da operação canônica `work recover-harness`, a preferência e a parada do Resident Host na barreira humana. O comando de authority permanecerá como próximo ato humano explícito e não será executado nesta sessão.
## Migration e prova de descendants

- A primeira tentativa de `work recover-harness` não criou estado: GoTrue estava indisponível. Docker/Supabase foram iniciados sem reset.
- A segunda tentativa foi recusada por `execution_envelope_unsupported`: o predecessor herdava `execution_spec.harness_recovery` ancestral.
- Migration `20260926000000_harness_recovery_descendants.sql`: remove somente essa recusa por presença ancestral; todas as demais precondições, lock, replay, um successor por item falho, failure atual, evidência host, orçamento esgotado e `max_attempts=1` permanecem.
- Commit `8437570` (`Permita recoveries governadas em descendants`).
- pgTAP focal: 32/32; lineage vizinha: 16/16. Migration aplicada por `supabase migration up`, sem reset.

## Successor e checkpoint pré-authority

- Recovery `492165c1-504c-4156-9bd1-470b4fde1079`, request/idempotency `eec1fc95-7060-57e2-91f7-1a422f259263`.
- Predecessor/incidente atual: item `7610b066-0fe1-4004-b9a0-fe18e6e51ca3`, attempt `92607a82-e382-44e2-ac6b-784372246f1b`, failure event `4c54234b-2a13-4d1c-919d-fbf83dff2fe6`.
- Novo successor `843669bd-44f6-4d36-8129-19db12cb573c`, lineage edge `28647645-4f9c-4430-a0bb-318fbccd760e`, seq 1 relativo ao predecessor atual.
- Cadeia causal preservada: `f19ac716-d599-4be7-94e0-5a16e14ac455 → 7610b066-0fe1-4004-b9a0-fe18e6e51ca3 → 843669bd-44f6-4d36-8129-19db12cb573c`; nenhum ancestor foi achatado ou mutado.
- Successor aprovado separadamente em proposal v1; escopo continua somente `route.ts` e `route.test.ts`; três gates preservados; `max_attempts=1`; zero attempts/claims.
- Preferência registrada por ato separado: `provider_api`, `openai`, `gpt-5.6-sol`.
- Preparação autônoma concluída. Uma volta canônica e direcionada do Resident Host registrou `compute_routing_decided` seq 54709: `waiting_for_human_authorization`, `paid_authorization_required`, `provider_api:gpt-5.6-sol`, duração mínima 30 minutos.
- Nenhuma authority ativa para o successor, nenhuma reservation nova, nenhuma chamada OpenAI/Ollama e custo desta sessão US$0. B1 e reservas históricas permaneceram intocados.

## Próximo ponto exato

Somente após novo ato humano explícito:

`npm.cmd run anima -- work authorize-compute 843669bd-44f6-4d36-8129-19db12cb573c --max-usd 3 --max-minutes 30 --valid-hours 2`

Esse comando ainda não foi executado. Depois dele, deixar o Resident Host executar no máximo a attempt autorizada e parar em review/terminal; sem integração, push, merge ou deploy.