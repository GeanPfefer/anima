# 2026-09-10 — Resilient Cloud Session V1: reprovisionamento governado + settlement (sem prova viva)

## Objetivo

Antes de gastar de novo, transformar a próxima execução cloud numa **sessão resiliente**: uma
autorização humana abre um envelope (custo/tempo/1 node) dentro do qual o Anima troca de máquina/GPU
sozinho quando uma máquina não publica endpoint ou fica insalubre, liquidando o custo real de cada
Pod descartado — até obter um Pod saudável e avançar até coder/gates/Verifier/review nele.

Recorte aprovado pelo humano no prompt da sessão. **Sem prova viva**: nenhum Pod criado, nenhum
provider write, nenhum compute pago consumido, `origin/main` intacta, WIP preservado.

## Branch / estado Git

- Branch `dev`; HEAD inicial `d783a5d` (WIP não commitado por cima, conforme memória).
- Esta sessão **não commitou** — entrega em WIP, coerente com a decisão humana pendente sobre o WIP
  anterior. Arquivos novos/alterados listados abaixo.

## Contrato e decisões

Detalhe canônico em [`docs/arquitetura/resilient-cloud-session-v1.md`](../arquitetura/resilient-cloud-session-v1.md).
Resumo:

- **Classificação de falha** (`classifyCloudProvisionFailure`, core puro): `endpoint_unpublished` →
  `endpoint_publication_timeout` (placement recuperável, exclui e troca de máquina), não mais
  `capacity_unavailable`. `provider_unreachable`/`rate_limited` → halt sem martelar. auth/quota/
  desconhecido → terminal fail-closed.
- **Planner de sessão** (`planNextCloudSessionAction`, core puro): governança real (custo/tempo/
  candidatos/provider) precede a rede defensiva de tentativas (16, só anti-loop).
- **Orquestrador** (`runResilientCloudSession`, web, composição sobre portas): loop sequencial,
  1 Pod por vez, teardown antes de reprovisionar, Pod saudável REUTILIZADO (não recriado), traço de
  sessão para observabilidade (`cloudSessionId`).
- **Deadline explícito** (`endpointPublicationDeadlineMs`, default **540000 ms**, justificado pela
  evidência 2026-09-10; env `ANIMA_RUNPOD_ENDPOINT_PUBLICATION_DEADLINE_MS`, legado
  `ANIMA_RUNPOD_MAX_PROVISION_MS` mantido como alias). Estourar habilita reprovisionamento, não
  termina a sessão.
- **Settlement do ledger** (append-only): evento `settled` grava excesso liberado (R−S) + fonte
  (`estimated`|`provider_confirmed`); `settleNodeLeaseCost` (core puro, por tempo, clamp `0≤S≤R`);
  RPC `settle_paid_compute_budget_reservation` (migração `20260910000001`); `reserve` recompilada
  subtrai o excesso, reabrindo budget para a próxima máquina da sessão. `void` passa a bloquear
  liberar uma reserva já liquidada. **Committed = Σ_aberta R + Σ_liquidada S.**

## Arquivos

Novos:
- `packages/core/src/work-orchestration/cloud-session.ts` (+ `.test.ts`)
- `packages/core/src/work-orchestration/paid-compute-node-settlement.ts` (+ `.test.ts`)
- `apps/web/lib/work-orchestration/resilient-cloud-session.ts` (+ `.test.ts`)
- `supabase/migrations/20260910000001_paid_compute_budget_settlement.sql`
- `supabase/tests/paid_compute_budget_settlement.test.sql`
- `docs/arquitetura/resilient-cloud-session-v1.md`

Alterados:
- `packages/core/src/work-orchestration/index.ts` (exports dos dois módulos novos)
- `apps/web/lib/work-orchestration/runpod-node-provisioner.ts` (+ `.test.ts`) — política de deadline
- `apps/web/lib/work-orchestration/paid-compute-authorization-store.ts` (+ `.test.ts`) — settle store
  + audit reflete settlement

## Provas / gates (verdes)

- Core: 126/126 nos módulos cloud/paid-compute/lease/session (inclui capability matching + SKU-fixa
  retrocompatíveis — tests 13/14). `tsc --noEmit` do core limpo.
- Web focais: provisioner 41/41 (novos casos de deadline), resident-on-demand-node + tunnel 34/34,
  store 15/15 (novos casos de settle/audit), orquestrador resiliente 10/10, integração provisioner +
  audit route 14/14.
- Ledger SQL: `settle` + `reserve` recompilada + `void` guard aplicados e **15/15 pgTAP** verdes em
  **transação com ROLLBACK** (não-destrutivo; migração durável NÃO aplicada — DB permanece em
  `20260910000000`). Casos: settlement libera excesso; committed vira custo efetivo; idempotência;
  invariantes `0≤S≤R`; cost_source distinguido; void×settle exclusivos; RLS por usuário.
- `git diff --check` limpo nos arquivos tocados; sem trailing whitespace / tab-indent nos novos.

## Barreiras / not-executed (deliberado)

- **Sem prova viva** (sem Pod, sem provider write, sem gasto).
- **Migração `20260910000001` NÃO aplicada duravelmente** — só validada em ROLLBACK. Aplicar com
  `supabase migration up` + `supabase gen types` fica para o próximo GO (a RPC `settle_…` ainda não
  consta dos tipos gerados; o store a chama por cast estreito até lá).
- **Wiring vivo pendente**: `runResilientCloudSession` está pronto contra portas; o adapter que liga
  `selectNextCandidate`/`attemptProvision`/`readCommittedCost` ao caminho real de
  `resident-on-demand-node.ts` (com reserva→provisão→settlement→teardown) fica para o próximo GO.
- **Barreira WIP herdada**: `apps/web` não passa `tsc` por 2 erros pré-existentes em
  `apps/web/scripts/grant-paid-authority-8a2515d8.ts` (arquivo UNTRACKED, não tocado nesta sessão;
  padrão generated-types-vs-WIP). Meus arquivos não introduzem erro de tipo.

## Próximo ponto exato de retomada (sob novo GO humano)

1. `supabase migration up` (aplica `20260910000001`) + `supabase gen types` (destrava o cast do
   store + o tsc da RPC nova).
2. Escrever o adapter vivo das 3 portas em `resident-on-demand-node.ts` (medir vida faturável,
   `settleNodeLeaseCost` → `settlePaidComputeBudgetReservation`, teardown antes de retornar).
3. Conceder autoridade de **sessão** (teto agregado ≥ custo real de ~2–3 máquinas descartadas +
   1 saudável) e re-rodar a prova viva de autoprov com `ANIMA_RUNPOD_ENDPOINT_PUBLICATION_DEADLINE_MS`
   elevado — o gasto continua sendo a fronteira humana.

Invariantes preservadas: `authorized ceiling ≠ reserved ≠ settled`; `reached review ≠ verified`;
`necessidade ≠ gasto`; AUTO-APPROVAL não existe.
