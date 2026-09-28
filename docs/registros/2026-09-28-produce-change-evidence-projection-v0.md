# 2026-09-28 — Produce-Change Evidence Projection V0

Remover o viés de sobrevivência na avaliação de `agency.produce-change` SEM promover
maturidade. Base: `dev` = `origin/dev` = `0b5f08d` (Pending Verification Human Recovery V0;
snapshot `backup/marco-pending-verification-recovery-v0-2026-09-28`). `main` = `99bec54`
intacta. US$0. Sem migração.

Referências: [Capability Proof Engine V0](2026-09-28-capability-proof-engine-v0.md) ·
[Trusted System Writer V0 / Mandated Verifier](2026-09-28-mandated-verifier-enforcement-v0.md) ·
[Pending Verification Human Recovery V0](2026-09-28-pending-verification-human-recovery-v0.md).

## Problema

`deriveCanonicalWorkCapabilityEvidenceFromEvents` só emite observação de produce-change para
a cadeia FORTE positiva (resultado + Git + gates + Verifier `verified`). Attempts que falharam,
ficaram inconclusivas ou foram rejeitadas não aparecem: a pergunta "produce-change é
operational?" seria respondida só com os sobreviventes. Esta unidade responde antes: "o que
aconteceu em TODAS as oportunidades reais?".

## Superfície

`packages/core/src/produce-change-operational-evidence.ts` — pura, determinística, sem I/O:

```
projectProduceChangeOperationalEvidence({ events, items, lineageLinks,
  trustedSystemEvidenceSince, currentFingerprint? })
→ occasions[], excluded[], eligibleLineages, positives{total,independent,humanRecovered,
  scopeReduced}, negatives, inconclusive, notAttributable, attributedNegativeAttempts, causes,
  coverageByChangeClass, coverageByFingerprint, recoveryBurden, gaps, maturityCeiling='proven'
```

Nada a consome para maturidade: registry, readiness, authority e auto-approval inalterados.

## Denominador e ocasião

- Ocasião = LINEAGE (raiz da união original→sucessores de `work_recovery_lineage`). Attempts
  e sucessores são fatos internos da lineage; não são independência operacional.
- Elegível: toda lineage cujos itens são `capability=programming` e que tem ≥1 attempt
  governada (`execution_started` com `attempt_id`). Não parte de `result_submitted` nem de
  sucesso do Verifier.
- Excluídas com motivo explícito: `not_exercised` (proposta/aprovada sem attempt),
  `not_programming`, `work_item_facts_missing` (evento sem fato do item ⇒ gap).

## Outcomes e causas

Por attempt, depois agregado: `qualified_positive | attributed_negative | inconclusive |
not_attributable`. Agregação: última attempt positiva ⇒ positiva; senão qualquer negativa
atribuída ⇒ negativa; senão qualquer inconclusiva ⇒ inconclusiva; senão não atribuível.
`causes` preserva as causas de TODAS as attempts (sucessor não apaga negativa anterior);
`attributedNegativeAttempts` conta negativas inclusive em lineages recuperadas.

- Atribuídas ao produtor: `candidate_or_coder_failure`, `scope_violation`,
  `candidate_gate_failure`, `invalid_candidate`, `no_result_after_valid_execution`,
  `verifier_rejected_candidate`, `candidate_defect_from_human_review`, `no_progress`,
  `candidate_contract_violation`.
- Outra camada (`not_attributable`): `harness_failure`, `provider_failure`,
  `transport_failure`, `toolchain_or_baseline_failure`, `requirement_gap`,
  `preference_change`, `verifier_failure`.
- Indeterminadas (`inconclusive`): `unknown`, `failure_unclassified`,
  `gate_failure_unattributed`, `verification_pending`, `verifier_inconclusive`,
  `technical_evidence_not_system_proven`, `human_review_undetermined`, `cancelled`,
  `attempt_abandoned`, `in_flight`. `unknown` não é jogado para outra camada.

Fontes (reuso, sem taxonomia paralela): `recoveryFailureCode`/`RecoveryFailureKind`
(allowlist de `decideRecovery`) + 4 tokens estruturados `[ollama_*]` já emitidos pelo backend;
findings estruturados do parecer do Verifier (`change_*_scope`, `attested_contradicts_observed`,
`gate_exit_code_incoherent`, correlação…); baseline diferencial do gate (base passava ⇒
candidato; base falhava ⇒ baseline; timeout ⇒ indeterminado; sem baseline ⇒
`gate_failure_unattributed`); marcador estruturado `harness_recovery` (failureClass=harness,
ato humano) no sucessor ⇒ a falha original é `harness_failure`. Prosa nunca classifica.
`no_result_after_valid_execution` só com coder host-observed `succeeded`, sem código e sem gate
reprovado observado.

Positiva exige: attempt governada; coder host-observed `succeeded`; candidato terminal com
handoff `succeeded`; Git observado = commit e arquivos do handoff; arquivos dentro do
`included_scope` e fora do `excluded_scope` da versão aprovada; gates terminais verdes
observados; parecer `verified` correlacionado ao resultado; nenhuma revisão humana contrária;
e evidência técnica `system_proven`. Aceite humano NÃO é requisito universal.

## Human review cause

Contrato fechado: `candidate_defect | verifier_miss | requirement_gap | preference_change |
undetermined`, lido SÓ de `payload.data.human_review_cause`. Nenhum evento grava esse campo hoje
⇒ todo o histórico é `undetermined` (gap `human_review_cause_missing`); nada é inferido
retroativamente. `candidate_defect`/`verifier_miss` ⇒ negativa; `requirement_gap`/
`preference_change` ⇒ não atribuível; `undetermined` ⇒ inconclusiva. Capturar a causa exige
ampliar `review_work_result`/`resolve_pending_verification` (migração) — FUTURO, fora desta
unidade. Recuperação humana de candidato pendente (`origin=pending_verification_recovery`)
aparece como fato humano e nunca vira `candidate_defect` automaticamente.

## Recovery burden

`human_recovered` (sucessor com `human_resume`/`harness_recovery`, `work_approved` humano com
authority +1, ou decisão de pendente) > `scope_reduced` (sucessor com `correction_scope` ou
retomada `resume_from_checkpoint`) > `recovered` (sucessor sem marcador, ou retry governado
pedido por humano na mesma unidade) > `self_corrected` (nova attempt com re-admissão só de
sistema) > `direct`; sem dados ⇒ `unknown`. `independentPositive` só para direct/self_corrected/
recovered; `human_recovered` não é produção independente; `scope_reduced` prova só o escopo
reduzido (`provesReducedScopeOnly`).

## Change class

Não há taxonomia canônica de TIPO de mudança (gap permanente `change_class_taxonomy_missing`).
A classe V0 é um proxy ESTRUTURAL, nunca texto livre: `execution_spec.target.kind` +
`impact_level` + `complexity`/`risk` da classificação INTEL-01 persistida; qualquer parte
ausente/`unknown` ⇒ `unknown`, que não entra em `coverageByChangeClass`.

## Operational fingerprint

`pcf0-<fnv1a>` de: versão da projeção, `executor_id`, backend do coder, exigência+versão do
Verifier, contrato de gate (`none|observed_v1|differential_v1`), esquemas de evidência
presentes, semântica de escopo (`exact_path_v1`), handoff (`worktree_handoff_v1`) e classe.
Nunca HEAD/SHA global. `currentFingerprint` opcional ⇒ gap
`fingerprint_current_generation_uncovered` sem positiva independente naquela geração.

## Trusted evidence

O payload dos fatos técnicos NÃO carrega a identidade do writer (Trusted System Writer V0 só
restringiu quem pode chamar as RPCs). Logo o único critério verificável é uma fronteira de
geração: `trustedSystemEvidenceSince` (momento a partir do qual, NAQUELE ambiente, só o writer
provisionado podia gravar `author=system`). Sem fronteira ⇒ nada é `system_proven`. Cadeias
fortes legadas ficam `inconclusive: technical_evidence_not_system_proven` com
`wouldQualifyWithTrustedEvidence=true` — nunca promovidas retroativamente. Negativas NÃO exigem
evidência confiável (assimetria conservadora: nunca favorece promoção).
`result_submitted` do executor sozinho ⇒ `verification_pending`.

## Histórico real (read-only, identidade residente, `trustedSystemEvidenceSince=null`)

Scratch não commitado `apps/web/scripts/_session/produce-change-projection-readonly.ts`:

- 1343 eventos; 33 lineages elegíveis; excluídas: 19 `not_exercised`, 6 `not_programming`.
- `qualified_positive` 0 · `attributed_negative` 8 · `inconclusive` 23 · `not_attributable` 2.
- 23 attempts com negativa atribuída; 4 cadeias fortes legadas marcadas
  `technical_evidence_not_system_proven` (seriam positivas com evidência confiável).
- Causas (por attempt): failure_unclassified 18, gate_failure_unattributed 15,
  candidate_or_coder_failure 9, no_progress 9, human_review_undetermined 7,
  technical_evidence_not_system_proven 4, transport_failure 4, harness_failure 3, unknown 3,
  verifier_rejected_candidate 3, candidate_contract_violation 1,
  no_result_after_valid_execution 1, verifier_inconclusive 1.
- Burden: direct 25, scope_reduced 3, human_recovered 3, recovered 2.
- Classe: 2 chaves estruturais (todas as lineages classificadas).
- Gaps: change_class_taxonomy_missing, fingerprint_current_generation_uncovered,
  human_review_cause_missing, negative_attribution_incomplete,
  operational_predicate_not_defined, trusted_evidence_generation_missing.
- Maturidade canônica de produce-change: declared=proven, derived=proven, `aligned`
  (inalterada; esta projeção não a alimenta).

## Por que ainda não é operational

Nenhuma positiva qualificada (sem geração de evidência confiável: writer não provisionado);
negativas e inconclusivas dominam; atribuição de falhas incompleta (prosa sem código, gates sem
baseline); causa humana não capturada; classe de mudança sem taxonomia; predicado operacional
não definido nesta unidade (deliberado). Próximos passos: provisionar o writer (operador) e
fixar a fronteira; capturar `human_review_cause` nas decisões humanas (migração); códigos
estruturados para falhas hoje em prosa; baseline diferencial em todos os gates; só então
especificar o predicado operacional sobre este denominador.

## Provas

- Jest `produce-change-operational-evidence.test.ts`: 29/29 (os 26 casos pedidos + denominador,
  determinismo e reclassificação por harness).
- Core completo 2351/2351; `npm run typecheck` verde; web (evolution, auto-approval,
  capability) 80/80.

## Não feito

Promoção operational, Option C, auto-approval, readiness, authority, score/porcentagem,
classificador causal por LLM, provider, compute pago, self-dev, provisionamento do writer,
migração.
