# 2026-10-13 — Aprovação do sucessor Single-Item V1 e bloqueio de classificação

Tipo: governança (sem código). Branch dev, HEAD a4f46f8 inicial e final; sem commit/push/migration/Host/attempt.
Sequência do [registro do sucessor](2026-10-13-single-item-sucessor-compativel.md).

## Executado (comandos oficiais, identidade residente)

- Contrato persistido de `d795e414-d603-4153-883e-124fea9ac732` reconferido == proposta revisada (intent, proposta,
  mensagem de origem, base `a4f46f87…`, 3 arquivos, 1 tentativa/30 min, codex-cli/default, sem `resume_from_checkpoint`).
- `work approve d795e414…` exit 0: evento `work_approved` seq 86380 (author user); estado `approved` v1.
- `work prepare-autonomous d795e414…` exit 3 (**recusa**, nenhuma escrita): `classification_policy_not_applicable`.

## Causa comprovada

`ensurePlannedProjectClassification` (`apps/web/lib/work-orchestration/planned-project-classification.ts`) só se aplica
quando `classificationSource !== null`, isto é, quando a origem é um planner suportado ou tem proveniência canônica.
O planner do item é `human_explicit_independent_proposal`, fora dessa política. É o mesmo caso de `b5f8178a`,
cujo registro de 2026-10-10 já dizia para não chamar `prepare-autonomous` e usar a porta geral de classificação humana.

## Parada (regra da autorização)

Sem contornar: nenhuma classificação gravada, **`b5f8178a` NÃO foi retirado** (a retirada era condicionada ao sucesso
da preparação) e o preflight operacional não foi executado. `cde9684e` intocado.

Estado: `d795e414` approved v1, 3 eventos, **sem classificação** (inelegível para a fila autônoma); `b5f8178a` approved v1,
4 eventos, classificado (humana), `resume_from_checkpoint` ainda presente; `cde9684e` changes_requested v2. Ledger 156,
claims 0, sem attempts novas.

## Menor correção (decisão humana)

Classificação humana pela porta geral `record_work_intelligence_classification` (como no precedente de 2026-10-10:
`p_expected_proposal_version=1`, `p_expected_classification_revision=0`, proveniência `human_confirmed`), com os valores
escolhidos e confirmados pelo humano (o precedente usou complexity bounded, risk low, reversibility reversible,
planClarity clear, urgency normal). Depois: retirar `b5f8178a` (`work withdraw`) e rodar o preflight. Evidências em
`C:\Users\GeanTeco\anima-recovery\approval-d795e414-*\`.
