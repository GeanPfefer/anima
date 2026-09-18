# 2026-09-18 — Capability Proof Engine V1 (reprodução + proveniência viva)

**Tipo:** desenvolvimento.

## Objetivo

Consolidar e **completar** o motor de assessments vivos já existente (Capability
Map / Evolution) até um Capability Proof Engine V1 coerente: fechar a lacuna que
travava a escada em `proven`, e fazer a `/evolution` responder "esta capacidade
está neste nível **por causa destas provas reais**", não "porque o registry diz".
Sem criar motor paralelo, sem migração, sem compute pago.

## Branch / HEAD

- **Branch:** `dev`.
- **HEAD inicial:** `454cd0a` (Reconcilie o benchmark settlement B1/B2/B3 e a reserva 11031d53).
- **HEAD final:** commit desta sessão — "Complete o Capability Proof Engine com reprodução e proveniência" (ver `git log`).
- **`origin/main` (`99bec54`) INTACTA.** **`origin/dev`** avançado só com este commit.

## Pipeline que já existia (mapeado antes de tocar código)

`capability-registry.ts` (definição, 40 caps) → `work_events` → `capability-assessment-read.ts`
(pagina, `classifyCanonicalResidentEvent`: readable/incompat/inválido) →
`capability-proof-assessment.ts` (`deriveCapabilityAssessmentsFromWorkHistory`) →
`capability-proof-work-evidence.ts` (extração/atribuição) → `capability-proof-engine.ts`
(`assessCapabilityMaturity`: ranking, regressão→degraded, recuperação) →
`EvolutionClient.tsx` (Avaliação dinâmica: Declarado/Base/Derivado/contagem).

Já derivava 4 capabilities como `verified_execution` → `proven`, com regressão,
recuperação e a barreira 51929 (incompatibilidade ≠ corrupção) funcionando.

## O que estava realmente faltando

1. **A escada morria em `proven`.** `reproduced_operation` (→`operational`) e
   `autonomous_operation` (→`autonomous`) eram tipos definidos mas **nunca
   produzidos** — nenhuma regra/adapter os derivava. Reprodução real não
   promovia nada.
2. **A UI não mostrava a proveniência ("por quê").** Mostrava contagens, não a
   base decisiva, as provas que sustentam o nível, nem o que falta para o
   próximo — exatamente o critério de sucesso. Os dados já chegavam ao client
   (basis, decisiveEvidenceId, proofRefs, contradições); só não eram renderizados
   nem traduzidos para linguagem humana.

## Mudanças relevantes

Core (puro, testável, sem provider):

- [`capability-proof-engine.ts`](../../packages/core/src/capability-proof-engine.ts) —
  campo opcional `occasionId` na observação; `REPRODUCTION_THRESHOLD = 2`; **regra
  de reprodução**: `verified_execution` positivo em ≥2 ocasiões independentes
  (occasionId distinto) na janela válida ⇒ `operational`/`reproduced_operation`.
  Fail-closed: sem occasionId não reproduz; mesma ocasião não conta duas vezes;
  ocasiões anteriores a regressão não são reaproveitadas.
- [`capability-proof-work-evidence.ts`](../../packages/core/src/capability-proof-work-evidence.ts) —
  o adapter carimba `occasionId = attemptId` nas 4 observações (edit-file,
  run-tests, produce-change, verify-change).
- [`capability-assessment-explanation.ts`](../../packages/core/src/capability-assessment-explanation.ts)
  **(novo)** — `explainCapabilityAssessment`: função pura que traduz a conclusão
  em `{ basis, basisLabel, rationale, distinctOccasions, decisiveProofRefs,
  contradictingProofRefs, nextProof }`. Regras no core; UI só renderiza.
- [`index.ts`](../../packages/core/src/index.ts) — exporta o módulo novo.

Web:

- [`EvolutionClient.tsx`](<../../apps/web/app/(app)/evolution/_components/EvolutionClient.tsx>) —
  "Avaliação dinâmica" passa a mostrar o **porquê** (rationale), as **provas que
  sustentam** o nível (tipadas), as **provas que contradizem** (quando regredida)
  e a **próxima prova** necessária. Fallback honesto preservado; declarado nunca
  reescrito.
- [`EvolutionClient.module.css`](<../../apps/web/app/(app)/evolution/_components/EvolutionClient.module.css>) —
  classes `dynamicWhy`/`whyLabel` coerentes com os tokens do app.

Docs:

- [`docs/arquitetura/capability-proof-engine.md`](../arquitetura/capability-proof-engine.md)
  **(novo)** — registry=definição, prova=observação, assessment=conclusão,
  evolution=projeção; pilotos + fonte/regra/insuficiência; critérios de
  maturidade; limites epistemológicos; fallback; incompatibilidade futura; o que
  ainda **não** é derivado.

## Decisões

- **Reprodução = ocasiões, não proofRefs.** `occasionId` explícito (o attempt) é
  o sinal; contagem de ponteiros de prova nunca é força. `REPRODUCTION_THRESHOLD=2`
  é o mínimo semântico de "reproduziu", não estatística.
- **`autonomous` fica fora do V1** honestamente: nenhum sinal atual demonstra
  operação autônoma sob governança.
- **V1 é read-model/projection.** Zero migração, zero tabela, zero contrato
  canônico novo, zero tipo novo de `work_event`. Toda conclusão vem do estado
  canônico existente.
- **Regras no core, UI burra.** A explicação humana é derivada no core (pura,
  testável); o React não codifica maturidade nem duplica régua.

## Provas / gates

- `packages/core` — suíte completa: **91 suites, 1810 testes PASS** (inclui os
  novos: reprodução no engine, `capability-assessment-explanation.test.ts`,
  atribuição de ocasião e reprodução end-to-end no adapter/assessment).
- `apps/web` — `evolution` + `capability-assessment-read`: **29 testes PASS**
  (2 novos de proveniência/reprodução na UI).
- **Typecheck:** `packages/core` 0 erros; `apps/web` 0 erros.
- **Regressão 51929** (`capability-assessment-read.test.ts`, fixture `seq: 51929`,
  transcript V3 com `runtimeEvents`) **verde**.

## Flakes conhecidos

Não executada a suíte web ampla (evita os flakes conhecidos `WorkProposalCard.test.tsx`
+ `lib/ai/project-tools.test` sob carga ampla; escopo desta sessão é `evolution`).

## Limitações / o que não foi feito

- Sem inferência de `autonomous_operation` (dívida honesta, documentada).
- Verificação por testes/typecheck, **não** por navegador (usuário pediu para não
  abrir navegador automaticamente).
- Capabilities fora das 4 pilotos seguem vivendo pela definição (fallback).

## Invariantes de segurança preservadas

- `origin/main` `99bec54` intacta. Sem PR/merge/deploy.
- Nenhum compute pago consumido; nenhuma authority/reserva criada ou tocada
  (reserva `11031d53` e benchmark B1/B2/B3 não reabertos).
- Sem `supabase db reset`; sem migração; sem schema.
- Untracked preservados: `.worktrees/`, `watch4-sensors.txt`.

## Próximo ponto exato de retomada

1. Conectar mais capabilities-piloto ao adapter (naturais: `governance.verifier`
   a partir de pareceres independentes; `agency.supervised-self-development` a
   partir da cadeia completa até `completed`; `compute.external-provider` a partir
   de `provider_api` no ledger).
2. Definir o sinal de `autonomous_operation` (execução verificada sob autoridade
   válida sem interação humana no ciclo) — só quando houver evidência persistida.
3. Refino de UI: agrupar provas por ocasião quando houver reprodução.
