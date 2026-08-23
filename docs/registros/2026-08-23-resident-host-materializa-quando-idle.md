# Resident host materializa o backlog canônico quando a fila operacional esvazia

Data: 2026-08-23
Tipo: desenvolvimento (engine + entry) + META-PROVA viva

## O que foi provado

O resident host, no seu PRÓPRIO laço (sem nenhuma chamada manual à rota), quando a fila
OPERACIONAL esvazia, **descobre o backlog canônico e materializa UM candidato em um
work_item `proposed` sozinho** — e PARA honestamente na fronteira de aprovação (humana).
Elimina a camada humana do "escolher + materializar o próximo trabalho" no laço vivo.

- Branch: `dev`. HEAD inicial: `c3242cc`. `origin/main`: `99bec54`, intacta.

## Mudança

- **engine (`resident-host.ts`)**: porto OPCIONAL `materializeWhenIdle(identity, signal)` +
  `MaterializationAttempt`. Quando a ação é `idle` E o host-turn esvaziou a fila operacional
  (`stopReason=no_eligible_work`), a engine chama o materializer ANTES de quiescer — sob a
  MESMA identidade user-scoped já adquirida e o mesmo kill-switch (só chega aqui com
  autonomia habilitada). Nunca lança (erro → `{materialized:false}`). Ausente ⇒ comportamento
  inalterado. Só na fila VAZIA (não em `wait_human`/`control_applied`/`resource`). 5 testes
  novos (31/31 na engine).
- **entry (`scripts/resident-host.ts`)**: fia `materializeWhenIdle` quando
  `ANIMA_RESIDENT_MATERIALIZE_DOCUMENT` (docs/….md) está setado — lê o doc, `parseCanonicalBacklog`,
  compõe `buildCanonicalMaterializerDeps` sob o Bearer do usuário e chama
  `materializeNextCanonicalCandidate`. Telemetria `materialization` no state log.
- **loader (`ts-resolve.mjs`)**: passou a resolver o alias `@/…` do tsconfig do apps/web
  (a cadeia do planner `lib/ai/*` usa `@/`), além dos imports relativos extensionless.

## META-PROVA (in_process, planner LOCAL qwen2.5:14b, Next NÃO necessário)

Usuário descartável FRESCO allowlisted (`daf00263-…`, SEM itens). Resident host
(`ANIMA_RESIDENT_MATERIALIZE_DOCUMENT`=fixture, `maxIterations=2`, autonomy=enabled),
**sem chamada manual à rota**. Telemetria real:

```
starting → materialize-source(fixture) → reconcile → running →
  idle (host_turn: no_eligible_work; materialization={materialized:true, detail:FIX-01,
        workItemId:f71f157f}) →                      ← MATERIALIZOU SOZINHO
  [wake por evento dos próprios work_events] → reconcile → running →
  waiting_human_or_recovery (o proposed FIX-01 é fronteira humana — aguarda aprovação) →
  stopping → stopped
```

Desfecho persistido (item `f71f157f`, usuário `daf00263`): `state=proposed`,
`intent.canonical_provenance.sourceId=FIX-01`, cadeia `work_proposed,context_attached`
(NENHUMA execução). Contagem de work_items FIX-01 do usuário = **1** (sem duplicata). Repo
byte-intacto (`HEAD=c3242cc`), `origin/main` intacta, **sem scratch file** (materialização ≠
execução). Fixture/itens descartáveis preservados como evidência.

**Ponto central:** na 2ª iteração o host-turn devolveu `awaiting_human_or_recovery` — o item
recém-`proposed` é reconhecido como fronteira HUMANA (aprovação). O resident host PARA ali.
Não há auto-approval (investigado: NÃO existe no código — aprovação é ato humano
`resolve_approval`; o laço autônomo só executa itens JÁ aprovados). Isto é a fronteira de
**autonomia progressiva** e NÃO foi burlada.

## Invariantes

Desfecho máximo `proposed` (materialização ≠ aprovação ≠ execução). Identidade user-scoped
(Bearer/RLS) — sem service_role. Correlação estável por `sourceId`; sem duplicata; a
materialização só ocorre com autonomia habilitada + identidade + fila operacional vazia.

## Dependência humana eliminada (antes → depois)

- ANTES (deste recorte): o resident host executava só a fila operacional (itens aprovados);
  um humano escolhia+materializava o próximo trabalho canônico.
- DEPOIS: o resident host, ao esvaziar a fila operacional, **descobre e materializa** o
  próximo candidato canônico sozinho, parando na aprovação humana. A camada "human
  materializer" foi eliminada do laço vivo; resta a fronteira de APROVAÇÃO (auto-approval =
  próxima decisão de autonomia progressiva, exige ratificação — NÃO implementada).

## Próximo ponto de retomada

1. **Auto-approval** para uma classe de trabalho local madura — decisão de AUTONOMIA
   PROGRESSIVA (ratificação humana): modelar authorization envelope/maturity explicitamente;
   fechar o loop materialize→approve→execute apenas sob esse envelope.
2. **Projeção operacional do estado canônico** (source status + linked work_items + event
   state → effective canonical state).
3. **Avaliação de conclusão de objetivo** por slice (objective_complete | more_work_required
   | blocked | human_decision_required) → próximo slice/objetivo.
