# Backlog dedicado — primeira prova trusted de produce-change

Documento de backlog canônico com UM único candidato, criado como infraestrutura da primeira
prova de `agency.produce-change` após a fronteira de evidência confiável
(`trusted_system_evidence_since = 2026-09-29T03:24:34.618679Z`). O materializer canônico lê
só o documento apontado; este arquivo não altera o backlog do Modo Autônomo V0.

O item anterior da prova (`3d2e829e`) foi retirado porque nasceu com um planner id não
classificável; este candidato reabre o mesmo defeito pelo caminho canônico.

Pré-requisito do planner corrigido em 2026-09-29: chamadas textuais Hermes/JSON emitidas pelo
`qwen2.5-coder:14b` agora são interpretadas de forma estrita pelo adapter local. A correção foi
testada sem chamar modelo e sem materializar este backlog. O status de TPC-01 permanece
`not_started`; a próxima ação continua sendo UMA materialização governada separada.

O contrato de contexto do mesmo planner também foi corrigido em 2026-09-29: somente ele usa a
API nativa `/api/chat` e solicita `options.num_ctx=16384` por default, configurável por
`ANIMA_PROJECT_PLANNER_CONTEXT_LENGTH`. A migração foi provada com transporte simulado, sem
chamar Ollama e sem materializar TPC-01; rounds, trimming e demais consumidores não mudaram.

## TPC — Primeira prova trusted de produce-change

### TPC-01 — Recusar <id> extra e --reason ignorado nos comandos de governança work da CLI

- **Status:** not_started
- **Objetivo:** Em `apps/web/cli/args.ts`, os subcomandos `work approve`, `accept`, `retry`, `show`, `evidence`, `correct`, `request-changes` e `withdraw` só verificam a presença de `rest[0]`: posicionais extras após `<id>` são descartados em silêncio (ex.: `work approve A B` age só sobre A). Além disso, `--reason` passado a `approve`, `accept`, `retry`, `show`, `evidence` e `correct` é descartado em silêncio. Os comandos irmãos (`prepare-autonomous`, `replan`, `authorize-resume`, `supervise`, `authorize-compute`, `set-compute`) já recusam argumentos equivalentes com `rest.length !== 1` / `reason !== null`.
- **Dependências:** (nenhuma)
- **Escopo incluído:** apps/web/cli/args.ts, apps/web/cli/args.test.ts
- **Fora de escopo:** apps/web/cli/app.ts, apps/web/cli/anima.ts, apps/web/cli/render.ts, apps/web/cli/identity.ts, packages/core, Supabase, Trusted System Writer, Produce-Change Evidence Projection, texto de help/usage, novos flags ou subcomandos, refactors laterais
- **Critério de validação:** npm test --workspace=apps/web -- cli/args.test.ts
- **Tentativas:** max_attempts = 1 (prova experimental: sem retry nem sucessor)
- **Aceite:** Mais de um `<id>` posicional em `work approve|accept|retry|show|evidence|correct|request-changes|withdraw` é uso inválido (parseArgs retorna ok:false).
- **Aceite:** `--reason` passado a `work approve|accept|retry|show|evidence|correct` é uso inválido (parseArgs retorna ok:false), em vez de descartado em silêncio.
- **Aceite:** As formas válidas existentes continuam funcionando com o mesmo resultado: um único `<id>`, `--json`, `request-changes` e `withdraw` exigindo `--reason` não vazio e trimado, `correct --require-gate`.
- **Aceite:** Os testes focais de `apps/web/cli/args.test.ts` passam.

## Atualização operacional — 2026-10-01

TPC-01 foi materializado e revisado para v2; predecessor `25c2c047` terminou failed com
uma attempt `107997e2` por falha de runtime CUDA/flash-attention. O status not_started
acima descreve o checkpoint anterior à prova, preservado como histórico.

O humano autorizou em 2026-10-01 um recovery successor operacional único, substituindo
para este incidente a restrição experimental anterior de nenhum successor. RPC canônica
criou `11a4ec12` proposed v1, zero attempts, preservando intent/proposal integralmente.
Mesmo qwen3-coder:latest local; Ollama ativo com flash-attention desligado. Aprovação e
execução são próximas etapas separadas; uma attempt, 30 minutos, Verifier obrigatório.
Registro: [recovery operacional](../registros/2026-10-01-tpc01-recovery-operacional-flash-off.md).

## Resultado da attempt autorizada — 2026-10-01

Successor `11a4ec12` aprovado e preparado canonicamente; attempt única `ddc6e410`
terminou failed por ollama_read_round_limit em 123 s. Três searches servidas, zero
edits, diff vazio, sem gate final/Verifier. Oito chamadas Ollama HTTP 200 com
flash_attn=disabled. Claim liberada; predecessor intacto; nenhum retry ou novo
successor, compute pago, integração ou push. Parada terminal cumprida.
[Registro completo](../registros/2026-10-01-tpc01-attempt-local-flash-off-failed.md).
