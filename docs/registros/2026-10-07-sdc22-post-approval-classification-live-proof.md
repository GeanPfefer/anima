# SDC-22 + INV-09 — Post-Approval Classification no Resident Host: implementação, integração e prova viva

Registro append-only. Data: 2026-10-07 (UTC). Tipo: desenvolvimento + prova viva (self-development governado).
Operador: Claude Desktop como OPERADOR BOOTSTRAP (não é autoridade técnica; aceite, integração e push foram decisões humanas explícitas).
Executor de código: `codex-cli:default` via assinatura ChatGPT, dentro do ANIMA. Router OFF (`ANIMA_COMPUTE_ROUTER_V1_ENABLED=0`); nenhuma API paga; nenhuma paid authority.
Antecede este registro: `docs/registros/2026-10-07-investigation-evolution-reconciliation-v3.md` (INV-07 → SDC-20 → INV-08 → SDC-21), que listava esta capacidade como dívida (`Classificação pós-aprovação automática pelo Resident Host`).

## Estado Git

- Início: `dev` = `origin/dev` = `ce3d310379fac573e9055e13018a05ea28e3ba9f`; `origin/main` = `99bec54e3ab42bfe882a8686cd1385d8058b916e`.
- Fim: `dev` = `origin/dev` = `534a1bd1b3942f1655082788599fd2b9b590e5ce` (1 commit linear sobre `ce3d310`, 0 merges); `origin/main` = `99bec54` (intacta).
- Preservados e fora de commit: `anima-prd.md` e `docs/planos/008-primeira-prova-trusted-produce-change-backlog.md` (WIPs tracked, byte a byte idênticos: blobs `239720661a44…` e `d5551a84bdc7…`), `docs/planos/036-…`, `037-…` e `038-…` (backlogs, untracked), scripts scratch em `apps/web/scripts/_session/`, clones dedicados de integração e refs temporárias.

## 1. Problema original

`ensurePlannedProjectClassification` (apps/web/lib/work-orchestration/planned-project-classification.ts) só era chamado por humanos (CLI `work prepare-autonomous`, rota API e botão da UI). Um item `approved` sem classificação vigente era descartado EM SILÊNCIO pela fila do Host (`projectAutonomousQueue` → `work_intelligence_classification_missing` → `continue`); o SQL (`autonomous_work_queue`, migration 20260728000002) também recusa claim sem classificação. Resultado: todo approve de unidade canônica ou de investigação exigia um `work prepare-autonomous` manual.

## 2. SDC-17 (histórico, `failed`)

- Item `8bed1fac-bc67-4179-b48f-8a3bc3e49b47` (backlog `docs/planos/033-…`), proposal v2 `codex-cli/default`, base `448fdde`.
- Attempt `9be379ad-cfb0-4660-9d6b-27ec2a4d13d1`: `execution_failed` retryable em ~32 s, "Codex CLI terminou com exit 1", sem candidate. A branch da attempt é idêntica à base (diff vazio) e nenhum arquivo do módulo existe: foi FALHA EXTERNA do CLI nativo (a que originou o SDC-18/19), NÃO defeito do desenho nem do código. Permaneceu `failed`, não foi recuperado nem reaberto; o SDC-22 é uma nova ocasião governada.

## 3. SDC-22 — Post-Approval Classification in Resident Host V0

- Item `1ca51cd1-62d6-44ce-bfa7-7c5212aa6aab`; backlog `docs/planos/038-post-approval-classification-resident-host-v0-backlog.md`. Decisão humana: escopo T3 no V0 (T1 geral é evolução posterior sobre o mesmo módulo; T2 rejeitado).
- Materialização canônica com planner determinístico e medição do prompt real: objetivo 6.027 caracteres; prompt 14.520 de 24.000 (folga 39,5%), sem truncamento. Ajustes por limites do planner: máximo de 7 gates (o typecheck de `packages/core` saiu, pois core não é alterado) e UM padrão de jest por gate; o backlog 038 foi ajustado em duas frases para refletir isso.
- Proposal v2 (`reviseProposal`, só `coder_backend`/`model` → `codex-cli/default`), approve (`86266`), `prepare-autonomous` manual (`86267`, necessário porque a capacidade ainda não existia), 1ª volta do Host barrada por `user_attempt_budget_exhausted` (`86268`/`86269`), UM `work supervise` (`86270`), UMA attempt `de2074c6-6f29-4c02-aa72-9cf19e0d4f91` (Codex 176,1 s), `review`.
- Candidate `534a1bd1b3942f1655082788599fd2b9b590e5ce` (filho direto de `ce3d310`), 4 arquivos, +299/−1: `post-approval-classification.ts` (+73, novo), `post-approval-classification.test.ts` (+119, novo), `backlog-host-turn-run.ts` (+21/−1), `backlog-host-turn-run.test.ts` (+86). Gates (host): typecheck apps/web, módulo novo, composição, planned-project-classification, autonomous-backlog-driver, resident-host, in-process-host-turn — todos passed. Verifier `work-verifier-v3` verified, 19 checks, 0 violations.
- Desenho T3 (reuso total do primitive; sem segundo classificador, evento, tabela ou migration):
  - `readPostApprovalClassificationConfig(env)`: exige `ANIMA_POST_APPROVAL_CLASSIFICATION === '1'` e `ANIMA_POST_APPROVAL_CLASSIFICATION_SINCE` em ISO-8601 estrito COM fuso (calendário validado); caso contrário `null` ⇒ comportamento idêntico ao anterior.
  - `classifyApprovedUnclassified(candidates, {ensure, since, maxItems=3, attempted})`: só `state=approved`, aprovação vigente da MESMA proposalVersion, `approvedAt > since` (estritamente posterior), sem classificação, sem claim ATIVO, origem T3 (`canonical_backlog_v1` via `readCanonicalProvenanceFromIntent` OU `cli_propose_investigation_v1` via `isInvestigationPreparationEnvelope`); FIFO por `approval.seq`; chama o `ensure` existente; absorve falha/exceção; o par id/versão entra em `attempted` ANTES do await.
  - `backlog-host-turn-run.ts`: só na via da FILA (sem `requestedWorkItemId`) e só com config válida, o `readBacklog` DO CICLO passa a ler → classificar → reler UMA vez se houve classificação ou replay → planejar. `attempted` vive por toda a chamada (todos os ciclos da mesma host-turn). `peekMoreWork` continua com o `readBacklog` original (read-only).
- Revisão humana focal (diff e testes lidos integralmente): sem defeito material; ACCEPT. Aceite (`86283`, accepted_result_event `7a23299f-f159-4c9f-90c4-1ea47476ebac`), `completed`.
- Integração governada ff_only (primitive `authorizeIntegrationEffect` + `executeAuthorizedIntegrationWithSupabase`, wrapper scratch, clone dedicado `…\anima-integration-sdc22`): authorization `6e22c0de-8b42-4c9f-8a32-22c0ffee6e22`, eventos `86284 integration_effect_authorized` e `86285 integration_completed` (Trusted System Writer); receipt `previousTargetSha=ce3d310` → `resultingTargetSha=534a1bd`, `mergeCommitSha=null`, `mergeParents=[]`. Depois: sync de `G:\anima` por `git merge --ff-only` (interseção WIP × candidate vazia) e push `ce3d310..534a1bd` sem force.

## 4. Prova viva — INV-09 (LIVE PROOF PASS)

Objetivo: provar que uma unidade T3 `proposed → approved por humano → SEM prepare-autonomous → o Resident Host classifica sozinho, antes de qualquer routing/claim/attempt → para em user_attempt_budget_exhausted`.

- Item `41f80b3a-2043-4e2f-8c67-0c62aa795bda`, ref **INV-09**, criado por `anima work propose-investigation` (provenance `cli_propose_investigation_v1`, referência INV-09, base `534a1bd`): capability research, `effect_class read_only`, executor `investigation-v1`, `codex-cli/default`, `workspace_read`, advisory, 1 attempt, 30 min; proposalVersion 1. Estado inicial: classificação 0, attempts 0, claims 0.
- Cutoff exato: `2026-10-07T03:02:47.795Z`. Approve humano (`86288 work_approved`, author=user, `2026-10-07T03:02:50.960Z`, decided_proposal_version 1). Após o approve e antes do Host: classificação = 0 (conferida duas vezes), item fora da fila (read-only peek: `classified=false`, `afterCutoff=true`).
- Host real (`scripts/resident-host.ts`, transporte in_process, `ANIMA_RESIDENT_MAX_ITERATIONS=1`): `ANIMA_POST_APPROVAL_CLASSIFICATION=1`, `ANIMA_POST_APPROVAL_CLASSIFICATION_SINCE=2026-10-07T03:02:47.795Z` (parseado igual ao cutoff), `ANIMA_AUTONOMY_ENABLED=1`, Router OFF (`routerEnabled:false`), `OPENAI_API_KEY` = sentinel inválido (nenhuma chave real no processo; `credentialPresent:true` no log refere-se ao sentinel).
- Sequência observada: `86288` work_approved (03:02:50.960Z) → `86289` work_intelligence_classified (system, 03:03:09.598Z, proposal_version 1, approved_proposal_version 1, revision 1, policyVersion `human-approved-project-investigation-v1`, classifierId `cli_propose_investigation_v1-bridge`) → `86290` input_requested (03:03:10.037Z) → `86291` work_blocked (mesma instante). Razão: `user_attempt_budget_exhausted` (awaits_budget_window, limit attempts). A classificação ocorreu 0,27 s depois de o Host entrar em `running`; o gate de orçamento barrou antes do routing.
- Contagens finais: classificações 1; routing 0; claims 0; work_started 0; execution_started 0; attempts 0; result_submitted 0; approvals 1 (user), 0 system; sem `authority` em nenhum evento de aprovação (nenhuma execution request manual); resume/budget authorizations 0. Estado final: `blocked` v1, aguardando decisão humana.
- ZERO `prepare-autonomous`, ZERO `supervise`, ZERO attempt, ZERO invocação do Codex para executar a investigação, ZERO paid authority/API (ledger pago 0), ZERO Git mutation. O item permanece `blocked` como evidência viva e NÃO deve ser executado.

## 5. Auditoria read-only da Evolution (claims que a prova torna stale)

Registry em `534a1bd` (`packages/core/src/capability-registry.ts`):
- Linha 711 — frontier de `agency.continuous-self-development`: "Classificação pós-aprovação pelo Resident Host é missing; preparação/classificação e configuração/autenticação são humanas."
- Linha 1421 — advancement de `interaction.resident-host`: "…ensurePlannedProjectClassification existe para humanos via CLI work prepare-autonomous, rota API e botão da UI; Host não classifica aprovados não classificados."
- Linha 1423 — frontier de `interaction.resident-host`: "Classificação pós-aprovação pelo Resident Host é missing; preparação/classificação exige ato humano (ensurePlannedProjectClassification). SDC-17 falhou e não está integrado."
- O `history` de `interaction.resident-host` (nota de 2026-10-05 sobre o SDC-14) é um fato datado e continua verdadeiro. O teste `capability-registry.test.ts` (linhas ~306–329) FIXA hoje `/Classificação pós-aprovação pelo Resident Host.*missing/` nos dois nós e exige `work prepare-autonomous` no texto do host: precisa mudar junto com o registry.

Mudança mínima recomendada: trocar "missing" por um estado honesto de PARCIAL: existe, integrado e publicado (SDC-22, `534a1bd`), mas só com flag `ANIMA_POST_APPROVAL_CLASSIFICATION=1` + cutoff ISO-8601 estritamente posterior, apenas para origens T3 (`canonical_backlog_v1` e `cli_propose_investigation_v1`), só na via da fila e com UMA ocasião viva (INV-09, ramo investigação). Continuam missing/partial: ativação por padrão; origens de planner/chat; sucessores de recovery/correção (sem provenance própria); o ramo canonical_backlog_v1 ao vivo; controles negativos ao vivo; distinção do autor da aprovação; supervise humano; lifecycle autônomo do Host. `work prepare-autonomous` continua como fallback e como caminho das origens fora de T3. Acrescentar em `interaction.resident-host` uma entrada de `history` `proof_added` (commit `534a1bd` e os testes do módulo) SEM mudança de maturity.

Maturity deve mudar? NÃO. Uma ocasião viva de uma capacidade de borda do Host, atrás de flag e cutoff, não implica operational/autonomous: `interaction.resident-host` já é `operational` (runtime admitido) e permanece assim; `agency.continuous-self-development` continua `projected`. Não há nó novo: a capacidade cabe como frontier/history dos nós existentes.

Escopo provável da reconciliação (não executada): `packages/core/src/capability-registry.ts` e `capability-registry.test.ts`, com as proofRefs só em commits/testes que existam no snapshot (o próprio registro só pode ser citado se estiver commitado antes). Próximo número livre a verificar (esperado SDC-23, `docs/planos/039-…`).

## 6. Limitações e dívidas

- `canonical_backlog_v1` NÃO foi exercitado ao vivo; o ramo T3 vivo foi `cli_propose_investigation_v1`.
- Os controles negativos NÃO foram exercitados ao vivo (origem fora da allowlist; aprovação anterior ao cutoff); só por testes.
- A feature continua desligada por padrão: depende de flag + cutoff por processo (o Host só enxerga mudança após reinício).
- G1: falta teste negativo explícito de `canonical_provenance` inválida (kind/sourceId/planningGeneration…); G2: falta teste do caminho default lendo `process.env` com flag+cutoff válidos. O validador canônico do core aceita strings vazias em `document`/`heading`/`canonicalObjective` e não exige `materializationReason`.
- O módulo não distingue o autor da aprovação (aprovações `system`/`autonomous_policy` existem só historicamente); a rota HTTP compartilha a composition root, então a flag vale para ela também na via da fila.
- Semântica: com a ativação ligada, approve de origem T3 torna o item elegível à fila autônoma e a primeira volta do Host o leva a `blocked` aguardando `work supervise`.
- Lições operacionais: no PowerShell `$env:X=''` REMOVE a variável (o env-file a repõe); usar um sentinel não-secreto para impedir a chave real; o planner canônico aceita no máximo 7 gates e um padrão de jest por gate.
- Dívidas anteriores NÃO resolvidas aqui: retry/recovery genérico de Investigation falha, descoberta durável do Codex, CLI/UX de integração governada, sync manual do checkout, push governado, lifecycle autônomo do Resident Host.

## Efeitos externos e invariantes

- Realizados: 1 integração governada em ref local de clone dedicado, 1 sync ff-only do checkout humano e 1 push `ce3d310..534a1bd` de `dev` (sem force), todos com autorização humana explícita.
- NÃO realizados: push de `main`, de `anima-work/*` ou de `refs/anima/*`, tags, commit de docs, migration, deploy, prova paga, execução da INV-09.
- Preservadas: `authorized ≠ reserved ≠ settled`; Router OFF; nenhuma paid authority; nenhum auto-approval; `work supervise` humano; max_attempts=1 respeitado em todos os itens; origin/main intacta.

## Ambientes

- Clones dedicados: `C:\Users\GeanTeco\AppData\Local\Temp\anima-integration-sdc20`, `…-sdc21`, `…-sdc22` (origin canônico; refs `refs/anima/candidate/sdc20|21|22`).
- 143 branches `anima-work/*` preservadas; scripts scratch em `apps/web/scripts/_session/` (incluindo `sdc22-*`).

## Próximo ponto de retomada

Este registro e os backlogs 036/037/038 ainda não estão commitados. Reconciliar o Capability Map (seção 5) só depois de decidir commitar este registro; em seguida, candidatos: generalização T1 sobre o mesmo módulo, prova viva do ramo `canonical_backlog_v1`, G1/G2, recovery genérico de Investigation, descoberta durável do Codex, CLI first-class de integração governada.
