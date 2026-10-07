# INV-07 → SDC-20 → INV-08 → SDC-21 — Investigation robusta e Evolution Reconciliation V3

Registro append-only. Data: 2026-10-06 → 2026-10-07 (UTC). Tipo: desenvolvimento + prova viva (self-development governado).
Operador: Claude Desktop como OPERADOR BOOTSTRAP (não autoridade técnica; toda decisão de aceite, request-changes, integração e push foi humana).
Executor de código e de investigação: `codex-cli:default` via assinatura ChatGPT. Router OFF (`ANIMA_COMPUTE_ROUTER_V1_ENABLED=0`); nenhuma API paga; nenhuma paid authority.

## Estado Git

- Início: `dev` = `origin/dev` = `b9d617c33455cd15114698de2fd7a9716b5b78b5`; `origin/main` = `99bec54e3ab42bfe882a8686cd1385d8058b916e`.
- Fim: `dev` = `origin/dev` = `0389906f093e652f239a8c1c52845c85585c365a`; `origin/main` = `99bec54` (intacta).
- Commits publicados em `dev` (4, todos lineares, sem merge commit):
  - `349a35e` — SDC-20 (Investigation Large-File Range Robustness V0);
  - `42846cc` → `d3bdd7f` → `0389906` — SDC-21 (candidate inicial + duas correções governadas, lineage preservada, NÃO squashada).
- Preservados e fora de commit: `anima-prd.md` e `docs/planos/008-primeira-prova-trusted-produce-change-backlog.md` (WIPs tracked, byte a byte idênticos do início ao fim: blobs `239720661a44…` e `d5551a84bdc7…`), `docs/planos/036-…` e `037-…` (backlogs dos SDC-20/21, untracked), scripts scratch em `apps/web/scripts/_session/`, clones dedicados de integração e refs temporárias (ver "Ambientes").

## 1. INV-07 — Audit da Evolution, falha por arquivo grande

- Item `74922765-a2ea-4e65-aab0-c6f3d814a1f1` (capability research, `effect_class read_only`, executor `investigation-v1`, `codex-cli/default`, `workspace_read`, advisory, 1 attempt, base `b9d617c`). Pergunta: auditar a tela Evolution e o Capability Map frente às capacidades provadas.
- Attempt `fc4be551-0131-4950-ac1a-d62e1c728aa5`: roteamento correto (`investigation-v1:configured`, `codex-cli:default`, rejectedCandidates vazio) e resultado produzido pelo Codex, mas `failed`, `retryable=true`, "Investigation structure or evidence does not resolve.", com `investigationFailure {stage:'evidence', reason:'evidence_file_too_large', findingIndex:3, evidenceIndex:0}`.
- Causa observada no código (`inspectInvestigationEvidence`, `investigation-executor.ts`): uma ref `file_at_commit` COM `lines` num blob > 150.000 bytes retornava `fail('evidence_file_too_large')` e invalidava o resultado inteiro. O limite existia porque a validação de range lê o blob para contar linhas; era decisão consciente do SDC-12 (dívida D9). O arquivo exato NÃO foi recuperável (o host descarta o JSON bruto por desenho); a hipótese plausível é `anima-prd.md` (198.117 B no HEAD), não confirmada.
- Auditoria de recovery (read-only): NÃO existe primitive canônico que continue a lineage de uma Investigation `failed`/retryable com 1/1 consumida. Governed retry bloqueia por `attempt_budget_exhausted`; `authorize_work_resume`, `replan_failed_work`, `authorize_harness_fix_recovery` e `authorize_candidate_recovery` exigem evidências/checkpoints/candidate do lane worktree que `investigation-v1` não produz. **`generic retry/recovery for failed read_only investigation is missing`** (limitação real; INV-07 permanece `failed`, sem recovery, sem INV equivalente para contornar max_attempts).

## 2. SDC-20 — Investigation Large-File Range Robustness V0

- Item `92703e61-0257-4723-ace3-b7f6a8be2aac`; backlog `docs/planos/036-…` (SDC-12 estendido, não segunda pipeline). Proposal v2 (revise só `coder_backend`/`model` → `codex-cli/default`). Attempt `51f720c6-6460-4e7a-b27c-8aed7d50bef8`, Codex 135,6 s; candidate `349a35ebc14528f98490f2c58f3659f7ee870094` (filho direto de `b9d617c`), 5 arquivos, +171/−23.
- Comportamento: ref com `lines` em blob > `INVESTIGATION_EVIDENCE_MAX_READABLE_BYTES = 150_000` NÃO invalida mais a investigação; é removida conservadoramente (sem clamp/repair, sem ler o blob), diagnosticada e o resultado é reavaliado pela política do SDC-12. Ref ao arquivo inteiro (sem lines) continua válida. Falhas duras (commit/path ausente, não-blob, `evidence_content_invalid`, git indisponível, transporte/estrutura, overflow) continuam fail-closed; verifier e `resolveInvestigationEvidence` continuam estritos.
- Contrato tipado: `InvestigationEvidenceDiagnosticV1` e a rejeição viram UNIÃO DISCRIMINADA por `reason`: `line_start_out_of_range`/`line_end_out_of_range` exigem `actualLineCount`; `range_not_validated_file_too_large` exige `actualByteSize` e `maxReadableByteSize` e NÃO tem `actualLineCount`; parser de chaves fechadas por variante. Gaps do host: um por CLASSE de rejeição, contadores N/M derivados pelo host (M = findings distintos efetivamente rebaixados que continham rejeição da classe).
- Gates (host): typecheck core e web, `investigation-result`, `investigation-executor` (inclui git real), `verifier-opinion` — todos passed. Verifier `work-verifier-v3` verified, 18 checks, 0 violations. Revisão humana focal confirmou o contrato, N/M com o teste mental A/B/C (EOF N=3 M=2; large N=3 M=1) e a ordem de leitura (tamanho antes do blob; 150000 B segue o caminho normal, 150001 B entra na rejeição).
- Integração governada ff_only (primitive `authorizeIntegrationEffect` + `executeAuthorizedIntegrationWithSupabase`, via wrapper scratch, em CLONE DEDICADO porque `dev` está em checkout em `G:\anima` e o primitive recusa `target_checked_out`): autorização `a2a8f7a0-5d20-4c6e-9d6b-20c0ffee5d20`, eventos `86182 integration_effect_authorized` e `86183 integration_completed` (Trusted System Writer), receipt `previousTargetSha=b9d617c`, `resultingTargetSha=349a35e`, `mergeCommitSha=null`, `mergeParents=[]`. Depois: sync do checkout humano por `git merge --ff-only` (interseção WIP × candidate vazia) e push `b9d617c..349a35e`.
- Dívidas de cobertura/processo (não bloqueantes): G1 falta teste multi-finding de N/M (cenário A+B+C); G2 falta teste de hard failure depois de rejeição large; G3 sem fixture congelada do formato antigo de diagnostics; `target_paths` declarados nos gates por workspace causaram `scopeVerification: declared_scope_differs_from_gate`, e os gates passam também no base (prova diferencial só atestada).

## 3. INV-08 — Primeira Investigation bem-sucedida pós-SDC-20

- Item `5e8d1320-1198-4503-bb8d-f07022f90608` (criado por `anima work propose-investigation`, ref INV-08, base `349a35e`). Attempt `6f2ed424-f5bc-4d5e-b420-43aeebb7bcbb`, 146,6 s, `review` e depois `completed` por aceite humano (evento `86199 result_accepted`).
- Resultado: `outcome=partial`, 22 findings (18 established, 4 inferred), 64 refs de evidência (13 commit, 51 `file_at_commit`, só 3 com `lines`, todas em `capability-registry.ts`, 82 KB), 4 gaps do próprio modelo, sem `evidenceDiagnostics` (zero rejeições e zero gap do host). Verifier `investigation-verifier-v1` verified: 5 checks (3 independentes), 0 violations.
- **Prova viva do SDC-20 (o que foi e o que NÃO foi exercitado)**: `anima-prd.md` (198.117 B, > 150 KB) foi citado com `lines=null` e aceito; nenhuma evidence failure ocorreu. Isto exercitou a mitigação de origem (prompt). **O ramo `range_not_validated_file_too_large` NÃO foi exercitado ao vivo**: continua sustentado por testes com Git real, não pelo INV-08.
- Revisão humana focal dos findings de maior risco: [6], [13], [14], [15] SUPPORTED; [19] needs-nuance por claim; [20] conclusão sustentada pelo código mas evidência citada fraca (usou o PRD); [21] proposta de modelagem, não fato. O INV-08 é insumo advisory, não autoridade de maturity; declarou leitura truncada e auditoria estática (não exaustiva).

## 4. SDC-21 — Evolution Reconciliation V3

- Backlog `docs/planos/037-evolution-reconciliation-v3-backlog.md`; escopo mínimo: `packages/core/src/capability-registry.ts` e `capability-registry.test.ts`. Materializado por wrapper scratch com planner determinístico e MEDIÇÃO DO PROMPT REAL (1ª rodada 22.970 chars, barrada por orçamento de 20.000; após condensar, 18.658 de 24.000 = 22,3% de folga, sem truncamento).
- Lineage (cada item com 1 attempt):
  - `9f22e7ab-ef98-4de5-b408-459c8271da70` (proposal v2 codex-cli) → attempt `d1bda952-…`, candidate `42846cc4da78ace884af5a659e4ab5d76a04dcaa`, verified 19 checks; `changes_requested` (proof semantics em proofRefs/history, redação ambígua, justificativa de relações do novo nó);
  - `05443853-c0c6-4bad-9196-136568bb0368` (lineage `86ab8a6c-…`) → attempt `c8d88351-…`, candidate `d3bdd7f33fc10f618c66f667f131370633ffb286`, verified 16 checks; `changes_requested` (resíduo: 3 proofRefs do lane Investigation em `agency.produce-change`);
  - `ad6d5bd3-6469-45c4-aeac-d6586a07f503` (lineage `74ff9396-…`) → attempt `76c7915c-eb33-484a-84d5-068f1bc7ead1`, candidate `0389906f093e652f239a8c1c52845c85585c365a`, verified 17 checks, diff vs anterior +4/−3; **aceito** (`86260 result_accepted`), `completed`.
- Resultado no registry (base `349a35e` → `0389906`; 66 → 67 nós; 2 arquivos, +452/−29): criado UM nó, `agency.investigation-sessions` (domínio agency, `implemented`, `dependsOn ['governance.authority']`, sem dependentes), com a comparação semântica explícita contra produce-change, external-harness, verifier, action-cards, executor-discovery, supervised-self-development, verify-change e research.web.*; relação a cada candidato documentada no `history` e fixada em teste, SEM edges automáticas. 11 nós existentes tiveram texto/frontier/proofs/history reconciliados (produce-change só texto; recovery-correction; candidate-recovery com a validação checkpoint-relative; governed-integration; continuous-self-development; external-harness com diagnóstico nativo do Codex via JSON; executor-discovery com a lane read_only; verifier com o lane advisory de Investigation; paid-settlement; resident-host; action-cards).
- Correções de proof semantics obtidas por request-changes: removido `349a35e` como proofRef/proof_added de governed-integration (é código do SDC-20, não prova de integração; permanecem `f6117f7`, `52a745e`, o primitive e os testes); removidos de produce-change a entrada proof_added e os 3 proofRefs `3bfa619`, `2d8546f` e `executor-selection.ts` (provam só o lane read_only; os commits permanecem em executor-discovery e investigation-sessions); removido proof_added de continuous-self-development (projected); frase truncada do verifier reescrita. Testes fixam as ausências.
- MATURITIES: nenhuma capacidade existente mudou (comparação programática base × candidate). `compute.paid-settlement`, `governance.governed-integration`, `governance.candidate-recovery`, `agency.external-harness`, `agency.executor-discovery` = `implemented`; `interaction.resident-host` = `operational`; `agency.recovery-correction`, `agency.produce-change`, `governance.verifier` = `proven`; nenhuma `autonomous`. `compute.paid-settlement`: só o advancement foi atualizado por código (catálogo `provider-pricing-catalog.json` com terra e sol, settlement fail-closed, migrations `20260927000000`/`20260927000001`); a barreira que resta é a prova viva paga e a aplicação operacional das migrations fora do ambiente local.
- Integração governada ff_only (mesmo protocolo, novo clone dedicado): autorização `5d21c0de-7a31-4b8e-9f21-21c0ffee5d21`, eventos `86261 integration_effect_authorized` e `86262 integration_completed`, receipt `previousTargetSha=349a35e`, `resultingTargetSha=0389906`, `mergeCommitSha=null`, `mergeParents=[]`; `349a35e..0389906` = 3 commits lineares, 0 merges. Depois: sync de `G:\anima` por `git merge --ff-only` (interseção WIP × candidate vazia) e push `349a35e..0389906`, sem force.

## 5. Conferência visual da /evolution (read-only, 2026-10-07)

- Web subida pelo fluxo normal (porta 3000) e parada ao final; autenticação feita pelo humano no painel do navegador (a senha não foi digitada pelo operador).
- A página carregou: 67 capacidades (Compreensão 6, Memória 9, Agência 16, Governança 12, Compute 8, Interação 6, Pesquisa externa 10); 50 current / 17 future; objetivo "Self-development contínuo": 23 de 27 existem, 1 especificada, 3 projetadas; filtros: Evolução recente 42, Fronteira e humano 13, Reuso externo 8.
- `Investigation Sessions` aparece em Agência como Implementada, aresta única para Authority (mandato); painel completo (meaning, 11 provas, história com a relação justificada, 5 fronteiras, "próximo estágio"); sem sobreposição relevante.
- Maturities conferidas na UI (todas as listadas na seção 4); nenhuma capacidade Autônoma; os 17 futuros continuam Projetados/Especificados; frontiers/missing/future conferidas nos painéis de governed-integration, executor-discovery, resident-host, recovery-correction, paid-settlement, verifier e self-development contínuo. Sem erros de console nem de servidor; nenhuma inconsistência visual ou material.

## 6. Dívidas abertas (não resolvidas por este arco)

1. `generic retry/recovery for failed read_only investigation is missing`.
2. Descoberta durável do executável Codex (hoje `ANIMA_CODEX_CLI_PATH` de deploy do operador ou `codex` no PATH; a readiness só faz probes de versão/login; sem a variável, `work executors` mostra `version_check_failed`).
3. Classificação pós-aprovação automática pelo Resident Host (`ensurePlannedProjectClassification` só é chamado por humanos via CLI/API/UI; SDC-17 falhou e não está integrado).
4. CLI/UX first-class de governed integration (o primitive é só biblioteca; usamos wrappers scratch).
5. Clone dedicado necessário (guarda `target_checked_out` impede integrar no checkout humano ativo; Modo W é fase posterior).
6. Sincronização manual do checkout humano após o integration effect.
7. Push governado inexistente (push manual).
8. Lifecycle autônomo do Resident Host e dependência do operador bootstrap (admissão `user_attempt_budget_exhausted` exigiu `work supervise` humano por item).
9. Cobertura/processo do SDC-20 (G1–G3 e target_paths) e a prova viva do ramo `range_not_validated_file_too_large`.
10. O primitive de correção corta o objetivo do sucessor em 1.000 caracteres: pedidos longos precisam ser terse ou virar adenda por `reviseProposal`.

## Invariantes e efeitos externos

- Preservadas: `authorized ≠ reserved ≠ settled`; Router OFF; nenhuma API paga; nenhuma paid authority; nenhum auto-approval; `work supervise` apenas sob autorização específica por item; max_attempts=1 respeitado em todos os 6 itens da cadeia (INV-07, SDC-20, INV-08 e os 3 itens da lineage do SDC-21) (nenhuma segunda attempt); nenhum recovery de INV-07; nenhum `reset`/stash; `origin/main` não tocada.
- Efeitos externos realizados: 2 integrações governadas em refs locais (clones dedicados), 2 syncs ff-only do checkout humano e 2 pushes de `dev` (`b9d617c..349a35e`, `349a35e..0389906`), todos sem force e com autorização humana explícita.
- NÃO realizados: push de `main`, de branches `anima-work/*` ou de `refs/anima/*`, tags, commit de docs, migrations novas, deploy, prova paga.

## Ambientes

- Clones dedicados: `C:\Users\GeanTeco\AppData\Local\Temp\anima-integration-sdc20` e `…\anima-integration-sdc21` (origin ajustado para a URL canônica; refs `refs/anima/candidate/sdc20` e `sdc21`).
- Branches de attempt preservadas em `G:\anima` (`anima-work/<attempt>`), incluindo `51f720c6`, `6f2ed424` (sem branch, investigação), `d1bda952`, `c8d88351`, `76c7915c`.
- Scripts scratch (não commitar): `sdc20-*`, `sdc21-*`, `inv08-execute-one-turn.ts` em `apps/web/scripts/_session/`.

## Próximo ponto de retomada

Este registro e os backlogs 036/037 ainda não estão commitados. Commitar documentação em `dev` move `dev` além de `0389906`: fazê-lo apenas por decisão humana, sem tocar nos WIPs. Candidatos ao próximo arco: recovery/retry genérico de Investigation, descoberta durável do Codex, classificação pós-aprovação pelo Host, CLI first-class de integração governada, e a prova viva do ramo large-file.
