# 2026-09-04 — Compute Router V1: composição fechada atrás de feature gate

**Tipo:** desenvolvimento + prova (determinística, sem gasto)

## Objetivo

Fechar a **composição** do Compute Router V1 herdada parcial do Codex, com a
invariante central: **Router OFF é semanticamente invisível** (preserva
integralmente o caminho legado); **Router ON** decide apenas entre **Ollama local**
e **OpenAI API**; a **cloud on-demand** permanece FORA do Router e sem regressão.

## Branch / HEAD

- Branch: `dev`.
- HEAD inicial: `5c04442` (= `origin/dev`; Compute Economics V1 já integrado).
- HEAD final: `e0391aa` (= `origin/dev` após push fast-forward).
- `origin/main`: `99bec54` — **intacta**.

## Estado parcial herdado (não commitado)

O trabalho do Codex estava **inteiro no working tree** (nada commitado): core do
Router + testes (16/16), migration + pgTAP (`compute_routing_decided`), e a fiação
em `autonomous-backlog-deps.ts`/`supervisor.ts` com o feature gate **começado mas
não terminado**. Reconciliação inicial: typecheck 5/5, web work-orchestration
874/874 e os 3 testes de composição focados já **passavam** — a correção parcial do
gate já havia neutralizado as 6 regressões nos testes existentes.

## Mudanças relevantes

- `packages/core/src/compute-router.ts` (+ teste, + export em `index.ts`) — núcleo
  PURO `decideComputeRoute` (herdado do Codex; commit atômico próprio).
- `supabase/migrations/20260904000001_compute_routing_decision.sql` + pgTAP +
  `packages/types/src/database.ts` — evento dedicado `compute_routing_decided` e
  RPC `record_compute_routing_decision`; `p_attempt_id` tornado nullable no tipo.
- `apps/web/lib/work-orchestration/autonomous-backlog-deps.ts` — **refatoração da
  composição**: extração de `routeCompute` (módulo-level) e `computeRouterEnabled()`;
  `runTurn` passou a **early-branch** — com o gate OFF, `computeDecision` fica null e
  NADA do Router roda (nenhuma decisão, nenhum lookup de authority/economics, nenhum
  evento); o `placement`/model legado deixou de depender de `computeDecision`.
- `apps/web/lib/work-orchestration/supervisor.ts` — herdado: persiste a decisão
  `selected` correlacionada à tentativa.
- `apps/web/lib/work-orchestration/autonomous-backlog-deps-router.test.ts` (novo) —
  provas de composição A–E.

## Decisões

- **Router OFF provado por estrutura, não por sorte.** O parcial do Codex computava
  `decideComputeRoute`/`evaluatePaidComputeAuthorization` incondicionalmente e
  acoplava o `placement` legado a `computeDecision.selectedProvider`. Reestruturei
  para que o gate OFF não execute nenhuma linha do Router.
- **Cloud fora do Router.** O Router só tem `ollama|openai`; o burst on-demand
  continua sendo entrada do placement local e é exercido por Router→Ollama.
- Persistência de `selected` fica na tentativa (supervisor); `waiting`/`blocked`
  são persistidos no wiring sem `attempt_id`.

## Bugs corrigidos

- Acoplamento residual do caminho legado à decisão do Router (o `placement` lia
  `computeDecision.selectedProvider` mesmo com o gate OFF). Corrigido pelo
  early-branch — Router OFF não referencia nenhum valor do Router.

## Provas / gates (números)

- Core router: **16/16**. Core completo: **1533/1533** (72 suites).
- Composição A–E (novo teste de wiring): **5/5**.
- Web work-orchestration: **879/879**. Web completo: **1306/1306** (116 suites;
  os flakes conhecidos `WorkProposalCard`/`project-tools` passaram nesta rodada).
- typecheck: **5/5** workspaces. build web: **OK**. `git diff --check`: limpo.
- pgTAP compute routing: **8/8**. Suíte DB ampla: **52 arquivos / 1123 testes / PASS**.

## Prova sem gasto (determinística)

- A. Router OFF → legado (zero authority lookup, zero `compute_routing_decided`,
  supervisor sem decisão).
- B. Router ON + local cabe → Ollama (`local_sufficient`, sem persistência no wiring).
- C. Router ON + local incapaz + authority válida (**fixture**) → OpenAI
  (`provider_api`, `local_model_incapable`, `authorizationId` da fixture).
- D. Router ON + local incapaz + sem authority → `waiting_for_human_authorization`
  (persistido sem tentativa; supervisor não roda).
- E. Router ON→Ollama não captura o cloud: o burst on-demand ainda engata
  (provisioner instanciado) — cloud inalterado.
- **Zero chamadas OpenAI pagas**: nenhuma credencial real; tudo mocks/fixtures.

## Invariantes de segurança preservadas

- Autoridade paga continua obrigatória e é ATO HUMANO; o Router nunca a fabrica.
- Falha temporária de infra local **não** promove gasto automaticamente.
- RPC `SECURITY DEFINER` com auth + allowlist + `FOR UPDATE` + replay idempotente;
  a decisão **não inicia tentativa**.

## Efeitos externos

- **Realizado:** 3 commits atômicos e **push fast-forward** para `origin/dev`
  (`5c04442..e0391aa`).
- **Não realizado:** nenhum toque em `origin/main`; nenhuma chamada paga; nenhum
  `supabase db reset`; nenhum PR/merge/deploy.

## Ambientes preservados

- `.worktrees/` e `watch4-sensors.txt` mantidos fora dos commits (artefatos).
- Docker/Supabase local foi **subido nesta sessão** apenas para rodar o pgTAP; a
  migration já estava aplicada ao DB local (função + enum presentes).

## Fronteiras humanas / próximo ponto

- Router permanece **OFF por padrão** (`ANIMA_COMPUTE_ROUTER_V1_ENABLED` ausente).
  Ligá-lo em ambiente real é decisão de operador.
- **Próximo recorte** (autorizado só após este fechamento): conectar observações
  econômicas REAIS ao Router (`economics` ainda entra como `null` no wiring) — sem
  tocar a cloud. Ver também o pgTAP `provider_api` pendente da sessão anterior.
