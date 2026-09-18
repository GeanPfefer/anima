# 2026-09-18c — Self-Development Continuous Loop V0 (deficiência própria → proposta governada)

- **Data:** 2026-09-18
- **Tipo:** desenvolvimento
- **Objetivo:** dar o primeiro passo real de "o humano diz exatamente o que
  corrigir" → "o Anima observa o próprio funcionamento, detecta uma deficiência
  ancorada em evidência, formula uma melhoria governada e a coloca na entrada do
  pipeline existente — SEM executá-la".

## Branch / HEAD

- **Branch:** `dev` (única linha autoritativa; nenhum branch/worktree paralelo criado).
- **HEAD inicial:** `9089034` (= `origin/dev`).
- **HEAD final:** este commit (ver `git log`); `dev` permanece a única linha autoritativa.
- **`origin/main`:** `99bec54` — INTOCADA.

## Contexto arquitetural encontrado (Fase 1)

- **Fonte canônica para criar trabalho novo:** `CreateWorkProposalCommand` →
  `create_work_proposal` (mesma via do `canonical-materializer`). Não exige
  `execution_spec` no tipo; o planner só é necessário para o slice executável, na
  PLANNING BOUNDARY — fronteira que este V0 PARA antes de cruzar.
- **Não havia** primitiva de deficiência/diagnóstico/recomendação/improvement.
- **Detecção parcial de problema já existente:** `decideRecovery`/`recoveryFailureCode`
  (taxonomia canônica de causa de falha, por-item) e o Proof Engine (`degraded`/
  `basis:'regression'`). Reutilizados, não duplicados.
- **Leitura canônica de histórico:** `readCapabilityAssessments` já carregava
  `work_events` com as proteções do incidente 51929 (`mapWorkEvent` +
  `classifyCanonicalResidentEvent`).

## Mudanças relevantes

- `packages/core/src/self-deficiency.ts` (+test): modelo `SelfDeficiencyV0`,
  3 detectores fortes determinísticos (`repeated_failure`, `capability_regression`,
  `verifier_recurrent_issue`), dedup (`kind+subject`), provenance (`evidenceRefs`),
  ciclo de vida vs. trabalho (`resolveSelfDeficiencyLifecycle`).
- `packages/core/src/self-improvement.ts` (+test): `ImprovementProposalV0`
  (templates determinísticos por classe, SEM LLM), proveniência no intent
  (`self_deficiency_provenance`, espelha `canonical_provenance`), construtor de
  `CreateWorkProposalCommand` (sem `execution_spec`) e orquestrador
  `materializeSelfImprovementProposal` (no máximo UMA proposta; portos de efeito
  = ler/persistir-mensagem/criar-proposta, nada mais).
- `apps/web/lib/evolution/capability-assessment-read.ts`: extraído o carregador
  canônico único `readCanonicalWorkHistory` (comportamento preservado).
- `apps/web/lib/evolution/self-deficiency-read.ts` (+test): read-model READ-ONLY
  que reusa o carregador canônico + a cobertura por proveniência no intent.
- `apps/web/scripts/self-deficiency-dry-run-readonly.ts`: dry-run READ-ONLY, US$0.
- `docs/arquitetura/self-development-continuous-loop-v0.md`: o ADR do loop V0.
- `packages/core/src/index.ts`: exporta os dois módulos novos.

## Decisões

- **Sem tabela/migration nova.** A deficiência é PROJEÇÃO derivada do estado já
  persistido (não precisa de storage próprio) — evita por completo a armadilha
  51929. A dedup contra trabalho ativo lê a proveniência no intent dos work_items.
- **3 detectores fortes, não sobrepostos**, cada um sobre um sinal DISTINTO e
  reutilizando uma primitiva canônica. Conservador: recorrência exigida; causa
  não-classificável nunca vira deficiência.
- **Formulação determinística** (templates). O `execution_spec` fica para o
  planner após decisão humana — o V0 não chama LLM.

## Provas / gates (números)

- **Core:** `93 suites / 1865 testes PASS` (era 1837 → +28 novos), typecheck 0.
- **Web:** typecheck 0; focais `capability-assessment-read` 13 PASS,
  `self-deficiency-read` 4 PASS.
- Regressão do incidente 51929 preservada (read-model refatorado, mesmos testes).

## Limitações / o que NÃO foi feito

- **Dry-run contra histórico REAL: BLOQUEADO na BARREIRA AUTH.** Supabase local no
  ar (54321) e Docker up, mas a identidade residente (GoTrue Bearer/RLS) NÃO
  autenticou contra o DB local (usuário residente ausente/chaves divergentes). Não
  se usou `service_role` nem `db reset`. O detector roda de forma real e
  determinística nos testes; só a leitura do histórico real é fronteira humana.
- **Nenhuma proposta real materializada** — apropriado, pois sem leitura do
  histórico real não há dedup segura ("se houver dúvida, não persista; reporte").
- `blocked_progress`/`operational_breakage` e `autonomous_operation` fora do escopo.

## Invariantes de segurança / efeitos externos (explicitamente NÃO realizados)

- approval criado? **NÃO**. authority criada? **NÃO**. reservation criada? **NÃO**.
  attempt criada? **NÃO**. provider pago usado? **NÃO**. LLM externo? **NÃO**.
- `origin/main` intocada. Sem `reset --hard`/`stash`/`clean`/`worktree prune`.
- Preservados: `.worktrees/`, `watch4-sensors.txt`, `.env.local`, `settings.local.json`.
- Reserva `11031d53` e benchmark B1/B2/B3 intocados.

## Próximo ponto exato de retomada

1. Com identidade residente válida (humano na UI ou host residente), rodar o
   dry-run read-only e revisar as deficiências reais projetadas.
2. Se houver UMA deficiência forte, deduplicada e sem work ativo equivalente:
   materializar UMA proposta via `materializeSelfImprovementProposal` (desfecho
   `proposed`) e parar na governança humana.
3. Fechar o laço avaliação-de-resultado → observação (Continuous Self-Dev V1).
