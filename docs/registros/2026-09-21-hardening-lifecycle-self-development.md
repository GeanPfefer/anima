# 2026-09-21 — Hardening do lifecycle do Self-Development

- **Data/tipo:** 2026-09-21; desenvolvimento + auditoria.
- **Objetivo:** auditar e endurecer uma frente independente do self-development
  autônomo sem competir com o trabalho concorrente de evidência diferencial.
- **Branch:** `dev`.
- **HEAD inicial:** `aabe73a`.
- **HEAD final:** ver `git log` após o commit documental desta sessão.

## Auditoria e lacunas confirmadas

Foram inspecionados manifesto, PRD, marcos 003/005/008, arquitetura de
orquestração, Resident Host, Continuous Self-Dev, planos do Modo Autônomo,
implementação e testes de detector, lifecycle, materializador e read-model. O
HEAD já continha a linha recente de Differential Evidence / Change Authorization;
ela não foi modificada.

Três lacunas independentes foram comprovadas:

1. cobertura `completed` com timestamp inválido virava `resolved`, fabricando
   sucesso sem ordem temporal verificável;
2. a leitura de eventos era paginada, mas a cobertura em `work_items` não, podendo
   ocultar um item equivalente depois do limite PostgREST;
3. o materializador relia cobertura, mas não recalculava o lifecycle; uma
   completion recente podia ser ignorada por candidato obsoleto (TOCTOU).

## Mudanças e commits

- `ab47402` — **Falhe fechado na resolucao de deficiencias**: introduz
  `indeterminate` e impede inferência/materialização sem tempo verificável.
- `2562c09` — **Leia toda cobertura de deficiencias**: paginação completa,
  ordenada e fail-closed de `work_items`.
- `ffacab8` — **Revalide a cobertura antes de propor melhoria**: reprojeção do
  lifecycle sobre a fotografia fresca antes de qualquer escrita.

## Provas

- Core focal: 2 suites / 36 testes PASS; typecheck PASS.
- Web focal: 1 suite / 7 testes PASS; typecheck PASS.
- Casos novos cobrem timestamp inválido isolado/misto, segunda página, falha em
  página intermediária, completion concorrente e recorrência realmente posterior.
- Core amplo: **96 suites / 1.970 testes PASS**.
- Web amplo: **133 suites / 1.673 testes PASS; 1 suite / 1 teste FAIL**.
  A falha reproduz isoladamente em `verifier-opinion.test.ts`: o fixture espera
  `verified`, mas o contrato corrente produz `inconclusive`. Ela não toca os
  arquivos desta sessão e cruza a linha recente de evidência/readiness; foi
  preservada para evitar correção concorrente com o outro executor.
- Typecheck core e web: PASS. `git diff --check`: PASS.

## Segurança, concorrência e efeitos externos

- `origin/main` intocada; sem merge, push, deploy, cloud paga ou provider pago.
- Nenhuma migration, credencial, segredo, approval, authority, reservation ou
  attempt foi criada.
- WIP não rastreado (`.worktrees/`, `.claude/settings.local.json`, sensores) foi
  preservado.
- A frente recente do outro executor não foi alterada nem reimplementada.

## Limites e retomada

O V0 ainda para em proposta `proposed`; a criação real continua sem superfície
residente automática e a transição estrutural continua sob governança humana. A
próxima fatia independente é tornar mensagem de origem + proposta uma escrita
atômica/idempotente: hoje falha após `persistSourceMessage` pode deixar mensagem
órfã, apesar do comentário antigo afirmar "sem escrita parcial".
