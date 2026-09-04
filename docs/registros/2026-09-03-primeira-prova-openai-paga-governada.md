# Primeira prova viva do coder pago OpenAI governado (até `review`)

Continuação direta de [o backend OpenAI host-mediated](2026-09-03-backend-openai-host-mediated.md)
e da governança de compute pago já existente. Esta sessão FECHOU a governança de
`coder_backend=openai` sobre o ledger existente e realizou a **primeira prova paga real** do
Anima evoluindo a si mesmo por um coder de API paga. `dev`; HEAD inicial `9af5075` (commit local
do Codex, publicado nesta sessão), HEAD final = novo commit desta frente; `origin/main` `99bec54`
intacta. Sem `db reset`.

## Reconciliação (o Codex parou antes de materializar a prova)

- HEAD local era `9af5075` "Governe o consumo pago do coder OpenAI" (autor GeanPfefer), 1 commit à
  frente de `origin/dev` (`f15fe08`), parent = `f15fe08` (fast-forward limpo). Diff = 13 arquivos
  (+206/−7), correspondente ao relato; `git diff --check` limpo; **sem segredos** no diff.
- Reprodução proporcional dos gates: typecheck 5/5 workspaces; testes focados da governança paga
  (web) `60/60`; core `host-observed-coder-evidence` `23/23`. `9af5075` publicado em `origin/dev`
  (push autorizado, não force; `origin/main` intacta).
- DB: NENHUMA materialização parcial da prova pelo Codex — `paid_compute_budget_events` vazio,
  nenhuma `ai_conversations` com `getEraForLevel`, nenhuma `paid_compute_authorization`. O script
  `apps/web/scripts/prove-openai-paid-coder.ts` existia mas nunca fora executado.
- Modelo: `gpt-5.6-terra` CONFIRMADO válido/configurado — `OPENAI_MODEL=gpt-5.6-terra` no
  `.env.local` E presente em `/v1/models` da conta (`owned_by:system`, sem shutdown; chave OpenAI
  presente, 200). Não foi necessário substituir; mesmo teto preservado.

## Bug de infraestrutura paga encontrado e corrigido (causa raiz do bloqueio da prova)

A 1ª execução falhou ANTES de qualquer gasto, no `grant_paid_compute_authorization`:
`forbidden: human authenticated user required` (42501) — apesar de a mesma identidade residente
inserir mensagem e criar/aprovar/classificar o work item (tudo RLS user-scoped).

**Causa raiz (observada ao vivo, não hipótese):** as RPCs de compute pago liam o papel do chamador
por `current_setting('request.jwt.claim.role', true)` — a GUC PLANA/legada. Um diagnóstico
descartável chamado pela identidade residente Bearer/GoTrue mostrou `auth.uid()` válido, o JSON
`request.jwt.claims` com `"role":"authenticated"`, e **`request.jwt.claim.role` = NULL**: este
PostgREST não popula a GUC plana. As RPCs de compute pago eram as ÚNICAS do repo a lê-la; todas as
demais (ex. `authorize_work_resume`) guardam por `auth.uid()` + `GRANT ... TO authenticated`. Os
pgTAP mascaravam o defeito porque SETAVAM a GUC plana manualmente.

**Correção mínima** (migration append-only `20260903000001_paid_compute_robust_jwt_role.sql`,
`CREATE OR REPLACE` das 4 funções — `grant`/`revoke`/`reserve`/`void`): `v_role` passa a
`coalesce(nullif(current_setting('request.jwt.claim.role',true),''), nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role')`.
Trata a GUC plana ausente OU vazia e cai para o papel do JSON (fonte real). Nenhum outro guard,
código de erro, GRANT/REVOKE ou lógica muda; assinaturas idênticas ⇒ privilégios preservados
(EXECUTE só `authenticated`; service_role REVOGADO — segue sem fabricar autorização).

**Regressão** `supabase/tests/paid_compute_jwt_role_source.test.sql` (6/6): identidade dirigida SÓ
por `request.jwt.claims` (GUCs planas nulas) admite grant/reserve/void/revoke; papel `anon` e papel
ausente continuam 42501 (fail-closed). Sem regressão nos suites existentes: `paid_compute_aggregate_budget`
18/18, `node_lifecycle_and_paid_compute` 20/20 (inclui "service role não fabrica decisão humana").
typecheck 5/5.

## Governança de `coder_backend=openai` (commit `9af5075`, auditada)

Sem novo ledger. `resource_class = provider_api:<modelo>`, `provider = openai`, `node_id` NULL
(coringa na leitura, aceito na reserva pois `v_auth.node_id IS NULL`). Gate financeiro
`createOpenAIPaidCallAuthorizer` na BORDA anterior ao fetch do provider (dentro do transport do
`GptCoderBackend`): 1ª chamada reserva conservadoramente TODO o teto do attempt; rodadas seguintes
revalidam a MESMA autoridade (sem nova exposição); replay ⇒ fail-closed (sem 2ª chamada).
Correlação carregada pelo `WorkExecutorRequest` (workItem/attempt/proposalVersion/maxDuration).
`providerCallCount` é HOST-OBSERVED; tokens ficam em `providerUsage` (PROVIDER-REPORTED) — resposta
sem usage não fabrica tokens.

## Prova end-to-end (item reutilizado, append-only)

A 1ª execução (pré-fix) commitou um item aprovado/classificado órfão `3797d7f2`; REUTILIZADO (não
duplicado). O script foi generalizado com `--work-item <id>`. Cadeia observada (identidade
residente Bearer/RLS, sem service_role; base `9af5075`):

- **Autorização humana → ledger:** `grant_paid_compute_authorization` → authorization
  `4a9d8241-1ddc-418c-b3e2-85012447d5e4`, provider `openai`, `resource_class provider_api:gpt-5.6-terra`,
  work item `3797d7f2`, teto **US$ 0,25**, validade **30 min**.
- **Resource Governor:** RAM ~38% livre ≥ 25% ⇒ `permit`/placement `local` (para API paga o
  placement local só destrava a volta; o coder real é o provider).
- **Admissão financeira:** 1 evento `reserved` USD **0.25** em `node openai-api`,
  `provider_api:gpt-5.6-terra`, attempt `2339bba7-15a7-412b-b45a-7f3390501633`. Ceiling 0.25 =
  reservado 0.25, voided 0 ⇒ agregado no teto; nova reserva seria negada (fail-closed).
- **Coder OpenAI:** attempt `2339bba7`, backend `openai:gpt-5.6-terra`. **providerCallCount = 3**
  (host-observed). **providerUsage** (provider-reported): input **4123**, output **1142**, cached
  **1121**, total **5265**. Host duration coder ~**14,9 s**. READ→EDIT host-mediated aplicou 2
  edições estruturadas em worktree isolada.
- **Diff (git independente):** base `9af5075` → checkpoint `d4b91b1d…`; changedFiles exatamente
  `packages/core/src/levels.ts` + `levels.test.ts` (escopo respeitado). `levels.ts`:
  `getEraForLevel` deixa de cair em `ERAS[0]` fora do intervalo — abaixo do mínimo ⇒ primeira era
  (Despertar), acima do máximo ⇒ última era (Lenda). `levels.test.ts`: casos `[MIN_LEVEL-1,'Despertar']`
  e `[MAX_LEVEL+1,'Lenda']`. **O patch foi produzido pelo modelo, não por Claude.**
- **Gate:** `npm.cmd test --workspace=packages/core -- levels.test.ts` → **passed**, exit 0, 3117 ms
  (host-observed).
- **Verifier:** parecer `inconclusive` — **0 violations**, gate coberto, 7 achados ok
  (correlação, posse de branch, escopo observado/respeitado, coerência de status, gates observados,
  critério coberto), 3 gaps `acceptance_criterion_without_evidence` (os `expectedEffects` em texto
  livre não ligados a prova). Honesto: não é `rejected` nem bug — reflete a autoria do proposal, não
  o coder pago. Advisory; não bloqueia `review`.
- **Estado final: `review`.** Não aceito, não integrado, não publicado, não mergeado.

## Invariantes de segurança preservados

Compute local segue independente do ledger pago. OpenAI não é fallback pago silencioso: sem
autoridade ligada ao ledger, `backendFor` recusa (`Backend OpenAI exige admissão de compute pago`).
A chave OpenAI NUNCA foi persistida nem logada: 0 eventos com `sk-proj`, nenhuma no output da prova.
`origin/main` intacta.

## Custo real

Teto autorizado US$ 0,25 (reserva conservadora, NÃO gasto real). Uso registrado (4123 in / 1142 out
/ 1121 cached). Preço unitário de `gpt-5.6-terra` não documentado com confiança no ambiente ⇒ custo
monetário real NÃO fabricado.

## Fronteira humana / próximo recorte

Parei em `review` (aceitação é humana). Próximo recorte estratégico: **Compute Router V1**
(Work Item → decisão local Ollama × OpenAI pago por capability/hardware/Governor/budget, com
provider/modelo/motivo/fallback/autoridade persistidos). Detalhe estratégico em `anima-prd.md`.
