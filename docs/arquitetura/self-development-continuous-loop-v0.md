# Self-Development Continuous Loop — V0 (observação → deficiência → proposta)

Este documento descreve o **primeiro passo** de um loop contínuo em que o Anima
sai de "o humano diz exatamente o que corrigir" para "o Anima observa o próprio
funcionamento, identifica uma deficiência real, formula uma melhoria governada e
a coloca na entrada do pipeline existente — sem executá-la".

Complementa — não substitui — o
[`capability-proof-engine.md`](capability-proof-engine.md) (de onde vem a
regressão de capacidade), a
[`orquestracao-de-trabalho.md`](orquestracao-de-trabalho.md) (o pipeline
governado) e a
[`protecao-contrato-canonico-estado-residente.md`](protecao-contrato-canonico-estado-residente.md)
(a barreira do incidente 51929). O registro da sessão está em
[`docs/registros/2026-09-18c-self-development-continuous-loop-v0.md`](../registros/2026-09-18c-self-development-continuous-loop-v0.md).

## O loop-alvo (visão) e o recorte V0

```
observar funcionamento
      ↓
detectar deficiência própria        ← V0 IMPLEMENTA
      ↓
formular melhoria própria           ← V0 IMPLEMENTA
      ↓
criar trabalho governado (proposed) ← V0 CHEGA ATÉ AQUI (via existente) e PARA
      ↓
[ approval humano → authority → attempt → coder → gates → verifier → review ]
      ↓                                  (pipeline EXISTENTE, intocado)
avaliar resultado → observar de novo
```

O V0 **para antes da proposta virar execução**: nada de approval, authority,
reservation, attempt, provider pago, LLM externo, scheduler/daemon, segundo
backlog ou segundo executor. O desfecho máximo é um `work_item` `proposed`,
aguardando governança humana.

## Quatro papéis distintos (não colapsar)

```
Estado canônico persistido   → OBSERVAÇÃO   (work_events + assessments derivados)
        │
Detector de deficiência      → DIAGNÓSTICO  (SelfDeficiencyV0: o que/por quê/prova)
        │
Formulação de melhoria       → HIPÓTESE     (ImprovementProposalV0: como melhorar)
        │
create_work_proposal         → UNIDADE      (work_item `proposed`, via canônica)
```

- **DEFICIÊNCIA ≠ PROPOSTA ≠ WORK ITEM.** Uma deficiência pode existir sem
  solução; pode gerar mais de uma proposta; uma proposta nunca vira execução
  automaticamente.
- A **UI (`/evolution`) não é fonte de verdade.** A fonte é o event log canônico;
  a regressão de capacidade entra pelo Proof Engine, não pela tela.

## Fontes de evidência e detectores V0

A detecção é **determinística, PURA e fail-closed** (`packages/core/src/self-deficiency.ts`).
Roda sem LLM, sem provider, sem banco; duas execuções sobre o mesmo histórico
produzem o mesmo resultado. Cada detector é FORTE e ancorado num sinal persistido
DISTINTO, reutilizando uma primitiva canônica já ratificada:

| Classe | Sinal | Primitiva reutilizada | Limiar |
|---|---|---|---|
| `repeated_failure` | eventos `execution_failed` | `recoveryFailureCode` (taxonomia canônica de causa) | ≥ 2 work_items distintos com a MESMA causa |
| `capability_regression` | assessments derivados | Proof Engine (`basis:'regression'`, `degraded`) | veredito de regressão sem recovery |
| `verifier_recurrent_issue` | verifier + revisão humana | `deriveSupervisedSelfDevelopmentEvidenceFromEvents` (ocasiões negativas) | ≥ 2 ocasiões `changes_requested` sobre mudança verificada |

Uma causa de falha **não-classificável** (código fora da allowlist) **nunca**
vira deficiência: sem causa identificada, não há afirmação de deficiência.

## Provenance (toda deficiência carrega prova)

Cada `SelfDeficiencyV0` carrega `evidenceRefs` para fatos REAIS — ids de
`work_event`, `attempt`, `work_item` e observações de assessment. "O modelo acha
que deveria melhorar" **não** é evidência; texto livre e memória textual **não**
são fonte autoritativa.

## Deduplicação e identidade

A identidade estável é `kind + subject` (`selfDeficiencyDedupeKey`):

- causas diferentes → deficiências diferentes;
- ocorrências equivalentes → a MESMA deficiência (o detector agrega TODA a
  evidência daquela chave numa só deficiência, então "terceira ocorrência" é
  apenas `occurrences`/`occasions` maiores — deduplicado por construção).

O ciclo de vida (`resolveSelfDeficiencyLifecycle`) cruza a deficiência com os
`work_items` que carregam sua **proveniência no intent**
(`self_deficiency_provenance.deficiencyId`, espelhando `canonical_provenance`):

- work ATIVO/aguardando cobrindo-a → `covered` (não duplicar a proposta);
- work `completed` cobrindo-a, sem sinal posterior → `resolved`;
- work `completed`, mas o sinal recorreu depois → `reopened` (recorrência
  pós-resolução, semântica explícita);
- cobertura só terminal-negativa (failed/rejected/cancelled) → segue `open`.

Só deficiências `open`/`reopened` viram proposta — a garantia de que **work ativo
equivalente impede proposta duplicada**.

## Formulação da melhoria (determinística, sem LLM)

`packages/core/src/self-improvement.ts` gera a `ImprovementProposalV0` por
**templates por classe** de deficiência: objetivo, problema, resultado esperado,
critérios de aceite, restrições, risco e escopo sugerido. A proposta diz **"o que
precisa melhorar e como saberemos que melhorou"**, não "edite a linha X do arquivo
Y". O `execution_spec` detalhado é responsabilidade do **planner**, na PLANNING
BOUNDARY já ratificada, **depois** da decisão humana — fronteira que o V0 não
cruza.

## Integração com o pipeline existente (nenhum segundo sistema)

A saída máxima é um `CreateWorkProposalCommand` — a **mesma via** do
`canonical-materializer` — cujo intent carrega a proveniência da deficiência
(dedup) e o resumo da melhoria, **sem** `execution_spec`. O orquestrador
`materializeSelfImprovementProposal` seleciona no máximo UMA deficiência forte e
não coberta, e cria a proposta via `create_work_proposal` (desfecho `proposed`).
Os únicos portos de efeito são ler correlação, persistir a mensagem de origem e
criar a proposta — **nenhum** de approval, authority, reservation, attempt ou
provider.

O read-model server-side (`apps/web/lib/evolution/self-deficiency-read.ts`)
reutiliza o **carregador canônico único** `readCanonicalWorkHistory` (mesmas
proteções do incidente 51929: `mapWorkEvent` + `classifyCanonicalResidentEvent`,
fail-closed em contrato incompatível), para que ESCRITA e LEITURA nunca divirjam
por leitores separados.

## O que NÃO é deficiência (limites epistemológicos)

- **Uma falha única** não é, por padrão, deficiência estrutural.
- **Uma rejeição de revisão** isolada é governança normal, não deficiência.
- **`human_required`/fronteira humana** é o sistema deferindo corretamente ao
  humano — saúde, não defeito.
- **Capacidade sem adapter/prova** é lacuna de observabilidade, não
  necessariamente deficiência da capacidade.
- Evidência que só existe **no chat/terminal humano** e não foi persistida (ex.:
  `spawn EINVAL` do `dev:supervised`) **não** é observável pelo detector — não se
  inventa evidência para ela.

## Por que não há autoaprovação

Mudança no próprio Anima é tratada como impacto **estrutural** e passa
obrigatoriamente pela governança humana (o manifesto: ações estruturais exigem
aprovação prévia; "AUTO-APPROVAL NÃO EXISTE"). O V0 nasce deduplicado justamente
para que um futuro modo automático de *detecção* não gere propostas
infinitamente — mas a *decisão* permanece humana.

## Evolução para o Continuous Self-Dev (V1+)

- fechar o laço da avaliação de resultado de volta à observação;
- novos detectores fortes conforme mais sinais forem persistidos (ex.:
  `blocked_progress`/`operational_breakage` quando a quebra operacional virar
  evidência canônica);
- persistência própria de `SelfDeficiencyV0` **só** se houver lacuna real (hoje é
  projeção derivada, sem tabela nova) — e, se houver, com versionamento, reader
  compatível, writer guard e contract stamping desde o início (barreira 51929).

## Prova E2E real (2026-09-18)

O **dry-run contra o histórico REAL** (`apps/web/scripts/self-deficiency-dry-run-readonly.ts`,
read-only, US$0) foi executado sob a identidade residente canônica (GoTrue Bearer
+ RLS; nunca `service_role`). Leu **1130 eventos reais** e o detector produziu **6
deficiências determinísticas** (todas `open`, nenhuma coberta — 0 work_items com
`self_deficiency_provenance`):

- `capability_regression|agency.supervised-self-development` (5 ocasiões);
- `repeated_failure|gate_failed` (11 work_items);
- `repeated_failure|ollama_no_effective_edits` (2 work_items);
- `repeated_failure|ollama_read_round_limit` (3 work_items);
- `repeated_failure|ollama_transport_error` (3 work_items);
- `verifier_recurrent_issue|agency.supervised-self-development` (5 ocasiões).

Dos **55** `execution_failed` reais, só **22** (as 4 causas que recorrem em ≥2
work_items) viraram deficiência; as demais são causa não-classificável (ignorada,
fail-closed) ou aparecem num único work_item — o comportamento conservador provado
em dados reais. Todos os `evidenceRefs` de `work_event` resolvem 100% para
`execution_failed` reais; nenhuma proposta foi materializada.

Observações honestas (não são bugs; o detector operou corretamente): (1)
`agency.supervised-self-development` é sinalizado por DUAS classes
(`capability_regression` e `verifier_recurrent_issue`) — duas lentes sobre as
mesmas 5 ocasiões negativas; ambas verdadeiras; (2) `gate_failed` é a causa mais
COARSE (11 tarefas heterogêneas sob um código canônico único) — cabe ao humano
decidir se é UMA deficiência estrutural ou várias.

### Causa-raiz da barreira AUTH anterior (resolvida, não destrutiva)

A sessão anterior não autenticou porque `ANIMA_RESIDENT_PASSWORD` em
`apps/web/.env.local` continha um `#` no meio do valor **sem aspas**. O parser
`--env-file` do Node trata `#` como início de comentário inline em valor não
citado e **truncava a senha**, quebrando o sign-in do runner — o que afeta também
o Resident Host e a CLI (mesmo runner). Correção: **citar o valor** em
`.env.local` (reconciliação não destrutiva do segredo existente; sem
`service_role`, sem `db reset`, sem recriar usuário). O detector NÃO precisou de
mudança.
