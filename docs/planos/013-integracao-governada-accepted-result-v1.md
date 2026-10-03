# Plano 013 — Integração governada de resultado aceito (V1)

Status: F0 + F1 em implementação (2026-10-03). Fases seguintes dependem de decisão humana.

## Problema

O ANIMA chega canonicamente a `work item → execução → evidência → Verifier → review → accept → completed`,
mas não existe caminho operacional para `resultado aceito → integração em dev → receipt → publicação`.
Nos AKT-03 (`83f7fd2`) e AKT-04 (`c536eff`) a integração foi **manual**: `git merge --ff-only` + push.

## Fluxo atual (órfão)

`completed` → **[sem caller]** `authorizeIntegrationEffect` → `integration_effect_authorized` (user)
→ **[sem caller]** `executeAuthorizedIntegration` (merge-tree → commit-tree de 2 pais → `update-ref` CAS)
→ Trusted System Writer → `integration_completed` (system) → **[nenhuma projeção/UI "integrado"]**.
Push de dev: não existe.

`integration_effect_authorized` ≠ `integration_decided`: o segundo (botão "Autorizar integração") alimenta só
branch-publication/PR; o primeiro congela o efeito Git exato (resultado aceito, commit derivado do handoff,
repositório, alvo, SHA esperado, modo) e é o único que o executor consome.

## REUSE / WRAP / BUILD

- **REUSE:** `authorizeIntegrationEffect`, `planIntegrationEffect`, `classifyIntegrationTarget`,
  `executeAuthorizedIntegration`, `update-ref` CAS, `TrustedSystemWriter.integrationReceipt`,
  `record_integration_completed`, `projectIntegrationStatus`.
- **WRAP (fases futuras):** comandos CLI de autorizar/executar; projeção "Integrado" na UI/mobile.
- **BUILD:** modo `ff_only` (F1); Modo W (F2); gate pós-integração (F2); publicação de dev (F3).

## F1 — modo `ff_only` (este plano implementa)

- Autorização humana escolhe o modo explicitamente; ausente ⇒ `merge_no_ff` (V0 preservado). `ff_only` nunca é default.
- Só `refs/heads/dev`. Só se `isAncestor(expectedTargetSha, resultCommitSha)` e, na execução, alvo == `expectedTargetSha`.
- Efeito: `update-ref refs/heads/dev <resultCommit> <expectedTargetSha>` (CAS, sem force). Sem fallback para merge.
- Receipt `ff_only`: `mode`, `previousTargetSha`, `resultingTargetSha == resultCommitSha`, `mergeCommitSha = null`,
  `mergeParents = []` — nenhum commit inventado. Validação **por modo** em core e SQL; o ramo `merge_no_ff` não foi afrouxado.
- Alvo em checkout (`target_checked_out`) continua `human_required` nos dois modos.
- Migration aditiva `20261003000000_integration_effect_ff_only.sql` (assinaturas/grants/vocabulário inalterados).
  **Criada e NÃO aplicada** até checkpoint humano.

## Modo R e Modo W

- **Modo R** (dev fora de checkout): `update-ref` CAS — implementado em F1.
- **Modo W** (dev em checkout, ex.: checkout principal com WIPs): `git merge --ff-only` dentro da worktree com
  preflights rígidos (HEAD == esperado, sem operação Git em curso, sem sobreposição com paths sujos, sem staged).
  **Fica para F2.**

## Publicação

Etapa governada **separada** (F3): provider próprio para `refs/heads/dev`, autorização e receipt próprios
(`integration_published`). Até lá, o push de `origin/dev` continua **manual**.

## Histórico

AKT-03 e AKT-04 permanecem históricos **MANUAIS**, sem backfill: com dev já contendo o commit, o mecanismo os
classificaria como `ambiguous`, por desenho.

## Fases

F0 config/readiness · **F1 `ff_only` (núcleo)** · F2 CLI + Modo W + gate pós-integração + projeção "Integrado" ·
F3 publicação governada de dev · F4 registro append-only/PRD (só com autorização).
