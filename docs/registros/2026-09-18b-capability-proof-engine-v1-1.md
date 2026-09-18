# 2026-09-18 (b) — Capability Proof Engine V1.1 (verifier + supervised self-dev)

**Tipo:** desenvolvimento.

## Objetivo

Conectar ao motor existente (V1) mais duas capacidades derivadas de prova real,
sem motor paralelo, sem migração, sem compute pago:

- `governance.verifier` — "o ANIMA demonstrou capacidade de verificar trabalho?";
- `agency.supervised-self-development` — "o ANIMA demonstrou capacidade de
  modificar a si mesmo sob supervisão humana válida?".

## Branch / HEAD

- **Branch:** `dev`.
- **HEAD inicial:** `702674b` (Complete o Capability Proof Engine com reprodução e proveniência).
- **HEAD final:** commit desta sessão — "Conecte governance.verifier e supervised self-development ao motor" (ver `git log`).
- **`origin/main` (`99bec54`) INTACTA.**

## Sinais persistidos usados

- **governance.verifier:** `verifier_opinion_recorded` (parecer `VerifierOpinionV1`)
  com `evidenceBasis.coverage.git && .gates`, `observedEventId`/`observedGateEventId`
  presentes e resolvíveis, correlação exata (workItem/attempt/versão) contra
  `result_submitted` (handoff), `host_observed_evidence_recorded` (git) e
  `host_observed_gate_evidence_recorded`.
  - **Regra de prova:** veredito **conclusivo** (`verified` OU `rejected`) sobre
    observação independente ⇒ ocasião positiva (o verifier OPEROU). `≥1`⇒`proven`,
    `≥2` ocasiões (attempts distintos)⇒`operational`.
  - **Verifier negativo:** uma **rejeição** bem-fundada é POSITIVA para
    `governance.verifier` ("verifier funcionou" ≠ "mudança aprovada").
    `inconclusive`/atestado/correlação errada ⇒ não conta (fail closed). Sem sinal
    persistido de "verifier falhou" ⇒ adapter não emite negativo (documentado).
- **agency.supervised-self-development:** cadeia FORTE verificada (result + git +
  gates `passed` + Verifier `verified` independente, correlacionada) **+** decisão
  humana de revisão sobre o resultado:
  - `result_accepted` (`accepted_result_event_id` → resultado) ⇒ ocasião **positiva**;
  - `changes_requested` (`reviewed_result_event_id` → resultado) ⇒ ocasião
    **negativa** (regressão; padrão do falso-positivo seq4→seq5);
  - sem decisão terminal ⇒ nenhuma observação (aguardando supervisão).
  - **Cadeia mínima:** proposta aprovada (correlação por versão) → attempt →
    mudança produzida → git+gates observados → Verifier `verified` independente →
    resultado → **decisão humana de revisão**. `supervised` ≠ `autonomous`: o
    humano no ciclo é a prova, não uma invalidação.

## Maturidade derivada atual

Depende do histórico real no store. Nesta sessão a derivação foi validada por
fixtures determinísticas: 1 ocasião ⇒ `proven`; 2 ocasiões independentes ⇒
`operational`; positiva→negativa posterior ⇒ `degraded`. Nenhuma ocasião
`autonomous` é (ou deve ser) emitida.

## Regression / recovery, provenance, explanation

- **Regression/recovery:** reusa integralmente a régua do engine V1 (janela
  pós-recuperação; occasionId = attempt; reprodução só conta ocasiões distintas).
- **Provenance:** cada observação carrega `proofRefs` reais (attempt, resultado,
  eventos observados, verifier, decisão humana).
- **Explanation:** `capability-assessment-explanation.ts` ganhou linguagem de
  DOMÍNIO por capacidade (mantida no core, nunca em React); a Evolution, sendo
  agnóstica, já projeta o "por quê" + provas decisivas dessas duas capacidades.

## Arquivos alterados

Core:

- [`capability-proof-work-evidence.ts`](../../packages/core/src/capability-proof-work-evidence.ts) —
  extraído reader compartilhado `resolveIndependentVerifierOpinions`; cadeia forte
  (`deriveVerifiedWorktreeExecutionEvidenceFromEvents`) reimplementada sobre ele
  (comportamento preservado); novos `deriveVerifierOperationEvidenceFromEvents`
  (governance.verifier) e `deriveSupervisedSelfDevelopmentEvidenceFromEvents`
  (supervised); ambos ligados em `deriveCanonicalWorkCapabilityEvidenceFromEvents`.
- [`capability-assessment-explanation.ts`](../../packages/core/src/capability-assessment-explanation.ts) —
  `CAPABILITY_RATIONALE` (linguagem de domínio) para as duas capacidades.
- Testes: `capability-proof-work-evidence.test.ts` (+ Governance Verifier V1.1 e
  Supervised Self-Development V1.1), `capability-assessment-explanation.test.ts`
  (linguagem de domínio), `capability-proof-engine.test.ts` (composição de
  regressão para governance.verifier).

Web:

- [`EvolutionClient.test.tsx`](<../../apps/web/app/(app)/evolution/_components/EvolutionClient.test.tsx>) —
  teste de projeção da nova capability (nenhuma mudança de UI foi necessária: a
  UI é agnóstica e já renderiza a explicação do core).

Docs:

- [`docs/arquitetura/capability-proof-engine.md`](../arquitetura/capability-proof-engine.md) —
  pilotos agora 6; seções de governance.verifier e supervised self-development;
  reader compartilhado; por que `autonomous` continua fora.

## Migrations / novos eventos

**NENHUM.** Zero migração, zero tabela, zero contrato canônico novo, zero tipo
novo de `work_event`. Puro read-model/projection sobre o estado canônico atual.

## Testes / typecheck / gasto

- `packages/core` — suíte completa: **91 suites, 1837 testes PASS** (era 1810).
- `apps/web` — `evolution` + `capability-assessment-read`: **30 PASS**.
- **Typecheck:** core 0; web 0.
- **Regressão 51929** preservada (`capability-assessment-read.test.ts`, `seq: 51929`).
- **Gasto pago:** ZERO. Nenhuma authority/reserva criada ou tocada; sem
  OpenAI/RunPod; sem navegador; sem `supabase db reset`.

## Invariantes de segurança preservadas

- `origin/main` `99bec54` intacta; sem PR/merge/deploy.
- Untracked preservados: `.worktrees/`, `watch4-sensors.txt`.
- `autonomous_operation` NÃO derivado (invariante da sessão).

## Riscos / dívida restante

- `governance.verifier` sem sinal de negativo (falso-positivo do verifier só é
  detectável por revisão humana; causa pode ser de produto). Documentado.
- `autonomous_operation` continua fora (contrato de autoridade autônoma ausente).

## Próxima capability a conectar

`compute.external-provider` (a partir de `provider_api` correlacionado a work item
no ledger) — sinal persistido já existe e cobre uma classe de prova nova
(chamada de provider governada), sem migração.
