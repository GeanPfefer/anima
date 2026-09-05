# 2026-09-05 — Primeira prova E2E com compute forte no PLANEJADOR e no CODER (até `review`)

**Tipo:** prova viva + menor mudança habilitadora. **Branch:** `dev`.
**HEAD inicial:** `4ab99ac` (= `origin/dev`). **HEAD final:** novo commit desta frente em `dev`
(código habilitador + este registro). **`origin/main`:** `99bec54` — **INTACTA** (nenhum push
nesta sessão). Sem `supabase db reset`.

## Objetivo

Obter o **primeiro sucesso end-to-end real** do Anima executando autonomamente uma tarefa de
desenvolvimento com **compute forte (OpenAI) no PLANEJAMENTO e no CODING**, até `review`. A
tentativa anterior morreu no planejador: `AdmissionGatedOpenAIPlanner` sempre caía no planejador
LOCAL (Ollama) porque a admissão interativa recusa por design (`interactive_paid_authority_absent`),
e o local não chegava a uma proposta terminal (Ollama, aliás, estava DOWN nesta máquina). Sucesso
E2E teve prioridade sobre provar execução local ou custo mínimo.

## Estado de partida reconciliado

- Git: `dev`@`4ab99ac`=`origin/dev`; `origin/main` `99bec54` intacta.
- Serviços: Supabase local **UP** (REST 200). **Ollama DOWN** (11434 inacessível) — reforça a
  necessidade de compute forte. OpenAI: chave presente (não exposta), `OPENAI_MODEL=gpt-5.6-terra`
  presente e já confirmado válido em sessões anteriores.
- Identidade: residente GoTrue→Bearer→RLS (`resolveCliIdentity`), NUNCA `service_role`.

## Barreira arquitetural descoberta (não é bug)

O ledger de compute pago endurece `provider_api` (migration
`20260904000000_paid_compute_provider_api_correlation`): uma autorização `provider_api` **exige um
work item concreto** — `work_item_id NULL` é PROIBIDO (seria um wildcard que atravessaria
itens/modelos). Mas o planejamento ocorre ANTES da proposta terminal existir ⇒ **o planejador pago
não pode ser autorizado no instante de criação do item**, por design. A rota canônica
(`planExecutableProjectWork` no materializer/chat) roda o planner ANTES do item — logo o planner
PAGO só é governável como **replan de um item já existente**.

## Menor mudança habilitadora (auditada; NÃO altera comportamento de produção)

1. **`createOpenAIPlannerAdmission(client, workItemId)`** em
   `apps/web/lib/work-orchestration/openai-paid-compute.ts` — a autoridade GOVERNADA que a admissão
   sempre-recusa (`createInteractiveOpenAIAdmission`) deixa como ÚNICO ponto de plugagem. Só admite
   sob autorização HUMANA ativa **amarrada ao item** (provider `openai`, node `openai-api`, classe
   `provider_api:<modelo>`, teto de custo + validade), avaliada por `evaluatePaidComputeAuthorization`
   (puro, fail-closed). Sem autoridade ⇒ recusa ⇒ fallback LOCAL (nunca chamada paga silenciosa). O
   planejador **não reserva** exposição (ainda não há attempt); a barreira é o envelope humano ativo
   + passagem única (timeout + limite de tool-calls). NÃO lê chave/URL (só a borda única o faz).
   `createConfiguredProjectPlanner` (default interativo de produção) **permanece intacto** —
   continua caindo no local; a nova admissão só é injetada pela prova do operador.
2. **`apps/web/scripts/prove-openai-strong-e2e.ts`** — harness do operador (identidade residente),
   modelado no ratificado `prove-openai-paid-coder.ts`, mas com o **planejador forte real**.

Gates da mudança habilitadora: typecheck web 5/5 workspaces; `openai-single-edge.guard` 6/6
(invariante da borda única preservada); `openai-paid-transport` OK; `openai-paid-compute` 4/4
(admissão do coder intacta).

## Cadeia E2E observada (fatos persistidos; item `cde9684e-cdb3-4164-86a6-5395fc403db1`)

Ordem imposta pelo ledger: item aberto com **placeholder de admissão** (rótulo honesto, sem
execution_spec) só para permitir a autoridade paga por-item; a proposta EXECUTADA é a do planejador
forte, instalada por `revise_work_proposal`.

1. **Mensagem** do usuário persistida (`ai_conversations`) → `context_attached` (seq 50448).
2. **Item aberto** placeholder v1 (`work_proposed` seq 50447).
3. **Autoridade paga humana** `03acf099-…` amarrada ao item: provider `openai`, classe
   `provider_api:gpt-5.6-terra`, teto **US$ 0,25**, validade 30 min.
4. **PLANEJADOR FORTE** `openai_project_tools_v1` (gpt-5.6-terra) sob a admissão governada por-item
   investigou o repo (tools read-only) e produziu a **proposta terminal real** → `proposal_revised`
   v2 (seq 50449). Escopo ancorado: `project-work-planner.ts` + `-selectable.test.ts`.
5. **Aprovação humana** v2 (`work_approved` seq 50450) + **classificação** (seq 50451).
6. **Attempt** `fcff0570-…` (`execution_started` seq 50456), **worktree isolada**
   `anima-work/fcff0570-…` a partir do base `4ab99ac`.
7. **CODER FORTE** `openai:gpt-5.6-terra` (placement `remote`), providerCallCount **6**, usage
   provider-reported input **18580** / output **2449** / cached **4681** / total **21029**; host
   duration ~**28,1 s**. READ→EDIT host-mediated aplicou 2 edições estruturadas.
8. **Diff (git independente):** base `4ab99ac` → commit `1c8b419d…`; changedFiles **exatamente**
   `apps/web/lib/ai/project-work-planner.ts` (+14) e `…-selectable.test.ts` (+15). Escopo respeitado.
9. **Gate** `npm.cmd test --workspace=apps/web -- project-work-planner-selectable.test.ts` →
   **passed**, exit 0, 9579 ms (host-observed).
10. **Verifier** `work-verifier-v2` → **`verified`**: 0 violations, 0 gaps, 10 checks (6 attested,
    4 independent), `restsOnAttestedEvidence:true`. (Melhor que a prova paga anterior, que ficou
    `inconclusive` por proposta hand-written — aqui os critérios são do próprio planejador forte.)
11. **Estado final: `review`.** `publicationState: local_only`; workspace original byte-intacto.

## Conteúdo da alteração (satisfaz os requisitos originais)

`resolveConfiguredProjectPlannerConfig(env)`: função **pura**, sem I/O, sem HTTP; reusa
`resolveConfiguredProjectPlannerProvider`; retorna `{provider:'openai'}` ou
`{provider:'local',model}` com `model = env.ANIMA_PROJECT_PLANNER_MODEL ?? 'qwen3-coder:latest'` —
**idêntico** ao default real do `LocalOllamaProjectWorkPlanner` (`project-work-planner-local.ts:61`).
**Allowlist estrita**: o teste prova que `OPENAI_API_KEY` e `OLLAMA_URL` presentes NÃO aparecem no
retorno. Testes: default, local+modelo explícito, ausência de segredos. Não altera seleção nem
comportamento existente do planner.

## Custo e segredos

Teto autorizado por-item **US$ 0,25** (uma autoridade cobre planner + coder). **Reserva:** 1 evento
`reserved` USD 0,25 (`node openai-api`, `provider_api:gpt-5.6-terra`, attempt `fcff0570-…`) — reserva
conservadora do coder na 1ª chamada, NÃO gasto real. Planner não reservou (sem attempt). **Custo
monetário real NÃO fabricado** (preço unitário de `gpt-5.6-terra` não documentado com confiança). A
chave OpenAI **nunca** foi persistida/logada; o harness redige `sk-…` por segurança; 0 segredos na
evidência.

## Fronteira humana / próximo passo

PAREI em `review`. NÃO aceitei, integrei, mergeei, publiquei nem toquei `origin/main`. O item
`cde9684e-…` aguarda a ação humana (aceitar/integrar) dentro do Anima. O commit habilitador em `dev`
é local (sem push). Observação para o revisor: a função é fiel ao default local; se no futuro o
diagnóstico precisar refletir também a URL/modelo do coder ou o provider de chat, é extensão nova.
