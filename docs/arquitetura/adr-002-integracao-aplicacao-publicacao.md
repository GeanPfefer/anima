# ADR-002 — Camada de aplicação/integração/publicação real

> Estado: **decisão humana persistida e superfície ratificadas; protocolo puro da
> execução protegida implementado, ainda sem provider real.** Este documento
> mapeia a fronteira aberta no item 10 do [ADR-001](adr-001-execucao-local-de-codigo.md)
> e propõe o menor contrato implementável para ela. Nenhuma decisão aqui
> autoriza efeito Git externo: a ação protegida continua atrás de aprovação
> humana explícita, conforme o [Marco 003](../marcos/003-trabalho-autonomo-seguro.md).

## Contexto: o que já existe (e o que falta)

Três substratos já ratificados/implementados delimitam esta fronteira. **Não se
cria conceito novo concorrente a nenhum deles.**

1. **Contrato puro de fronteira de integração — INT-03, RATIFICADO (2026-07-20).**
   `IntegrationBoundary` em [`integration-boundary.ts`](../../packages/core/src/work-orchestration/integration-boundary.ts)
   é a máquina de estados fechada e fail-closed:

   ```text
   result_produced → result_accepted → integration_authorized → integrated
                                        └→ integration_refused
   ```

   - `produceResultForIntegration`: abre a fronteira de uma tentativa
     `succeeded/result_produced` com o item em `review`, exigindo `IntegrationHandoff`
     tipado que casa com `attempt.handoffReference`.
   - `acceptResultForIntegration`: exige item `completed`, origem `user`, e o ID
     exato do resultado apresentado. É o **aceite do resultado**.
   - `decideIntegration({decision:'authorize'|'refuse'})`: é a **segunda aprovação
     humana**, origem `user`, distinta do aceite. Mapeia diretamente a razão do
     Marco 003 "aprovação final para integrar, publicar ou mergear".
   - `recordIntegrated`: origem `system`, exige `integration_authorized`; **registra
     o fato, não executa efeito externo**.
   - Todas as transições preservam a correlação do INT-02 (item, tentativa, versão
     aprovada), são idempotentes no replay idêntico e falham fechadas em entrada
     divergente. Provado por 12 testes de domínio (`integration-boundary.test.ts`).

2. **Evidência durável de worktree — INT-05 (rótulo de trabalho), implementado.**
   `WorktreeHandoffV1` em [`worktree-handoff.ts`](../../packages/core/src/work-orchestration/worktree-handoff.ts)
   é a evidência git que **sobrevive à remoção da worktree**: `baseSha`, `branch`
   (namespace `anima-work/`), `commitSha`, gates, desfecho e diff em contagens,
   com `parseWorktreeHandoff` fail-closed e `projectWorktreeHandoff` relendo do
   sinal terminal persistido. Hoje **sem consumidor vivo** — existe de propósito
   para esta camada consumir.

3. **Aceite persistido — ciclo de revisão (F5/UX-03), vivo.**
   `review_work_result(accept)` emite `result_accepted` com `accepted_result_event_id`
   e leva o item a `completed`. `completed` significa "resultado aceito", **nunca**
   "aplicado/mesclado/publicado". Não existe `WorkState` `integrated`.

**O que falta (esta fronteira):**

- **(a) Persistência** da máquina de estados de integração além do aceite: hoje
  `integration_authorized`, `integration_refused` e `integrated` **não têm evento
  nem RPC**. A segunda aprovação humana e o registro de integração não são
  persistíveis ainda.
- **(b) Mecânica real** de publicar/mergear/aplicar (branch → PR/remoto → merge/
  deploy) — o único efeito externo, atrás da segunda aprovação.
- **(c) Fronteira provider/core** para manter Git/GitHub fora do `packages/core`,
  coerente com "executores substituíveis" e referências opacas do Marco 003/004.

## Responsabilidade canônica

Transformar um **resultado aceito e explicitamente autorizado** em um **artefato
revisável/remoto** (publicação) e, se a arquitetura ratificada assim exigir, em
uma **integração final** (merge/apply) — cada passo como fato distinto, **sem
que produzir resultado jamais implique integrá-lo**.

| Pergunta | Resposta canônica |
|---|---|
| **Entrada** | Uma `IntegrationBoundary` em `integration_authorized` + a `WorktreeHandoffV1` durável correlacionada. |
| **Saída** | Uma referência revisável opaca (ex.: PR) e um `IntegrationRecord` registrando o fato via `recordIntegrated` → `integrated`. |
| **Quem autoriza** | O humano, por `decideIntegration({authorize})` (origem `user`). |
| **Onde ocorre a 2ª aprovação** | Exatamente em `decideIntegration` — distinta do aceite (`acceptResultForIntegration`). |
| **Antes da aprovação** | Só existem `result_produced`/`result_accepted`/`integration_refused`. Nenhum efeito Git externo é derivável. |
| **Depois da aprovação** | A publicação vira derivável; o efeito é executado por um provider e só então registrado (`recordIntegrated`). |
| **O que deve ser impossível sem aprovação** | Qualquer efeito Git remoto: push, PR, merge, apply, deploy. Impossível por construção — a request de publicação só é derivável de `integration_authorized`. |

### Relação entre os artefatos

- **resultado da execução** (`result_submitted`) → carrega o `handoffReference`
  opaco **e** o `worktreeHandoff` estruturado (INT-05).
- **`IntegrationHandoff`** (INT-03) = ponteiro opaco `{reference, resultEventId}`;
  casa por `attempt.handoffReference`. É a chave de correlação, não a evidência.
- **`worktreeHandoff`** (INT-05) = a evidência git estruturada (`branch`,
  `baseSha`, `commitSha`). É o **insumo material** da publicação.
- **resultado aceito** = `result_accepted` + item `completed`.
- **branch/commit** = `anima-work/<attemptId>` @ `commitSha`, preservados no repo
  real mesmo após a worktree sumir — é o que a publicação empurra.
- **publicação** = tornar `branch`/`commitSha` revisável remotamente (ex.: push +
  PR), **idempotente**, atrás de autorização.
- **PR / integração final** = merge/apply — permanece etapa separada, atrás da
  mesma (ou de outra) decisão humana, conforme a arquitetura ratificada.

## Decisões de desenho

- **D1 — Reusar, não recriar.** A máquina `IntegrationBoundary` ratificada é a
  fonte única de verdade do estado de integração. Esta camada **adiciona** só o
  que falta: derivação da publicação, porta do provider e (futuramente)
  persistência. Nenhum segundo conceito de "handoff" ou "estado".
- **D2 — A 2ª aprovação é `decideIntegration({authorize})`**, origem `user`,
  distinta do aceite. Nenhum atalho a funde com o aceite.
- **D3 — Fronteira provider/core.** O core define a **porta** `IntegrationPublisher`
  (provider-agnóstica), o **request** puro e o **outcome** tipado; o adaptador real
  (git/GitHub) vive fora do core (`apps/web`) e **nunca** é importado pelo core.
  Um fake determinístico prova o contrato. Sem registry, sem sistema de plugins.
- **D4 — Publicação só é derivável de autorização.** `buildIntegrationPublicationRequest`
  é fail-closed: exige `integration_authorized`, `decision==='authorize'`,
  correlação casada entre boundary e handoff, `isAnimaWorktreeBranch(branch)`,
  `status==='succeeded'` e `publicationState==='local_only'`. Sem esses fatos, não
  há request — logo é **impossível** publicar sem aprovação.
- **D5 — Idempotência determinística.** `idempotencyKey` derivada de
  `(authorizationDecisionId, commitSha)`, sem relógio. Retry após crash re-deriva
  a mesma chave; o provider é consultado de forma "create-or-get"; `recordIntegrated`
  é idempotente no replay. Nenhum efeito duplica.
- **D6 — O estado interno nunca mente.** `recordIntegrated` só é chamado **após**
  sucesso externo confirmado. Falha externa mantém `integration_authorized`
  (retryable) e **não** vira `integrated`. Ausência de provider/credenciais é
  falha tipada explícita, nunca sucesso silencioso.
- **D7 — Persistência DIFERIDA à ratificação humana.** Eventos/RPCs/pgTAP para
  `integration_authorized|refused|integrated` são mudança estrutural que o próprio
  INT-03 delegou a "itens posteriores". **Atualização (2026-08-09):** Gean
  ratificou este ADR e autorizou a etapa de persistência; a decisão
  (`integration_authorized|refused`) passou a ser persistida — ver *Persistência
  da decisão* abaixo. O `integrated` **continua diferido** ao publisher real: não
  existe caminho que o registre sem efeito externo comprovado.
- **D8 — Sem acoplamento GitHub no core.** Alvos de publicação são referências
  opacas resolvidas só no nó autorizado (espelha o padrão de alvo opaco do INT-04).

## Menor contrato (substrato puro, sem migration, sem efeito)

Novo módulo `packages/core/src/work-orchestration/integration-publication.ts`:

- `IntegrationPublicationRequest` — o que publicar, derivado fail-closed de
  `(boundary autorizada, worktreeHandoff)`: `idempotencyKey`, correlação,
  `authorizationDecisionId`, `acceptedResultEventId`, `baseSha`, `branch`,
  `commitSha`, `executorId`, `backendId`.
- `buildIntegrationPublicationRequest(boundary, handoff)` — validador/derivador
  fail-closed (D4). Defeitos: `not_authorized`, `correlation_mismatch`,
  `branch_not_owned`, `result_not_succeeded`, `already_published`, `invalid_input`.
- `IntegrationPublisher` — porta provider-agnóstica: `publish(request): Promise<IntegrationPublicationOutcome>`.
- `IntegrationPublicationOutcome` — união discriminada `{ok:true, reviewableReference, idempotencyKey}`
  | `{ok:false, code, message, retryable}`; `code` ∈ `provider_unavailable`,
  `credentials_missing`, `base_sha_mismatch`, `commit_not_found`, `branch_conflict`,
  `publish_failed`. `validatePublicationOutcome` fail-closed.
- `buildIntegrationRecordInput(request, outcome)` — ponte pura para o
  `recordIntegrated` ratificado (recordId determinístico da `idempotencyKey`),
  fechando o laço `autorizado → publicado → integrated` sem efeito real.

## Persistência da decisão (implementada e provada ao vivo, 2026-08-09)

Torna vivo e durável o passo que faltava do `IntegrationBoundary`: a **segunda
aprovação humana** persistida e fiada até a rota HTTP, sem tocar o publisher real.

- **Evento `integration_decided`** (vocabulário isolado) — NÃO-terminal, fora da
  matriz de estados: registra `authorize`/`refuse` sobre um resultado já aceito
  **sem mudar o estado do item** (`completed` continua `completed`; não há
  `WorkState` `integrated`).
- **RPC `public.decide_integration(work_item_id, expected_proposal_version,
  accepted_result_event_id, decision, decision_id)`** — decide só por fato
  persistido, fail-closed: exige item do usuário em `completed`, aceite persistido
  apontando o resultado exato, versão correta e `decision_id` não vazio; deriva a
  tentativa (INT-02) do `result_submitted` aceito. **Uma decisão por resultado
  aceito** (índice único parcial + guardas): replay idêntico sem novo evento,
  conflito e "already decided" falham fechados (`55000`).
- **`projectIntegrationBoundary(events)`** (core, puro) — reconstrói a
  `IntegrationBoundary` ratificada do log, do `result_accepted` em diante; nunca
  projeta `integrated`. É o read model e a ponte para
  `buildIntegrationPublicationRequest` quando `integration_authorized`.
- **`integration-decision.ts`** — contrato do payload (`IntegrationDecisionPayloadV1`)
  + a projeção; `WorkIntegrationDecision = 'authorize'|'refuse'`.
- **Fiação de aplicação:** `DecideIntegrationCommand`/`IntegrationDecisionOutcome`
  + `parseIntegrationDecisionOutcome` (core), método na interface e no
  `WorkOrchestrationService` (valida versão/resultado/decisão), implementação no
  `SupabaseWorkOrchestrationRepository` (mapeia erros pelo `mapSupabaseFailure`
  existente) e rota `POST /api/work-orchestration/integration-decisions` (auth +
  encaminhamento). **Sem publisher, sem efeito Git.**
- **Sem `integrated`, sem publisher, sem efeito Git.** `decide_integration` só
  registra a decisão humana; nenhuma linha marca integração como realizada.
- **Prova (ao vivo):** migrations aplicadas por `supabase migration up` (não
  destrutivo, sobre o volume local em `20260729000003`); **pgTAP `supabase test db`
  verde — 27 arquivos / 704 asserções, incluindo `integration_decision` `plan(34)`**;
  tipos regenerados (adição cirúrgica de `decide_integration`/`integration_decided`/
  `work_integration_decision`, sem o reorder/nullability drift do CLI local).
  Jest: core 637, testes de rota 7, serviço 7, typecheck do monorepo limpo.

## Matriz de invariantes × infraestrutura

| Invariante | Onde vive | Status |
|---|---|---|
| resultado não aceito → integração proibida | `decideIntegration` exige `result_accepted` | ✅ ratificado (INT-03) |
| aceito mas sem 2ª autorização → publicação proibida | `buildIntegrationPublicationRequest` exige `integration_authorized` | 🆕 substrato puro |
| 2ª autorização válida → operação permitida | `decideIntegration authorize` → request derivável | ✅+🆕 |
| replay da mesma autorização → idempotente | `decideIntegration`/`recordIntegrated` replay idêntico | ✅ ratificado |
| autorização para versão antiga → recusada | correlação `approvedProposalVersion` em toda transição | ✅ ratificado |
| handoff adulterado → recusado | `parseWorktreeHandoff` fail-closed + correlação | ✅ INT-05 |
| `baseSha` inesperado → recusado | provider confere `baseSha` do handoff vs base real | 🆕 (validador + adapter real) |
| `commitSha` inexistente → recusado | provider confere objeto git antes de publicar | 🆕 (adapter real; fake determinístico) |
| branch fora do namespace → recusada | `isAnimaWorktreeBranch` no builder | ✅ INT-05 + 🆕 builder |
| worktree removida, handoff válido → fluxo continua | handoff durável; branch/commit persistem no repo real | ✅ INT-05 |
| sinal atrasado de tentativa antiga → não publica obsoleto | `decide_integration` exige o resultado aceito exato; `projectIntegrationBoundary` ignora decisão obsoleta | ✅ contrato + 🆕 persistência |
| dois pedidos concorrentes → no máximo um efeito | `decide_integration`: `FOR UPDATE` + índice único por resultado aceito; `idempotencyKey` + provider idempotente na publicação | ✅ decisão persistida + ◐ publicação (design) |
| crash após efeito externo → retry não duplica | `idempotencyKey` + "create-or-get" + `recordIntegrated` idempotente | 🆕 (design + fake) |
| falha externa → estado interno não mente | `recordIntegrated` só após sucesso; falha mantém `integration_authorized` | ✅ contrato + 🆕 outcome |
| ausência de credenciais/provider → falha explícita | outcome `credentials_missing`/`provider_unavailable` | 🆕 (fake + adapter) |
| ação sem aprovação → nenhum efeito Git remoto | request indeivável sem `integration_authorized` | 🆕 substrato puro |

Legenda: ✅ já existe e está provado · 🆕 substrato/persistência deste trabalho
(a persistência da decisão está **provada ao vivo** por pgTAP — `supabase test db`
verde — e fiada até a rota) · ◐ parcial (o enforcement do efeito de PUBLICAÇÃO
depende do publisher real, adiante).

## Faseamento e fronteiras

1. **Agora (autorizado, sem risco):** substrato puro em `packages/core`
   (tipos, builder fail-closed, porta, outcome, ponte para `recordIntegrated`) +
   fake determinístico + testes cobrindo as linhas 🆕 da matriz. Sem migration,
   sem efeito, inerte até (2) e (3).
2. **Persistência da decisão — IMPLEMENTADA, PROVADA AO VIVO e FIADA (2026-08-09).**
   `integration_decided` + `decide_integration` + `projectIntegrationBoundary` +
   pgTAP (`supabase test db` verde) + tipos regenerados + fiação
   interface/serviço/repositório/rota com testes. Ratificada como etapa por Gean.
   Registra só a decisão humana — **nunca** `integrated` nem efeito externo.
3. **Requer a ação protegida (2ª aprovação humana real, NÃO iniciada):** o
   adaptador `IntegrationPublisher` concreto que faz push/PR/merge de verdade, e o
   registro `integrated` do efeito externo comprovado. Atrás de **nova** autorização
   humana explícita.

**Proibido sem aprovação humana:** push, PR, merge, apply no repositório principal,
deploy, uso de credenciais externas, marcar `integrated` sem efeito externo, e
qualquer simulação de ratificação. Nada implementado até aqui realiza ou é capaz
de expressar esses efeitos.

## Protocolo de execução protegida por fatos distintos (2026-08-09)

O contrato inicial `IntegrationPublicationOutcome { reviewableReference }`
comprimia publicação de branch e criação de review request num único sucesso.
Isso não representa honestamente `push` bem-sucedido seguido de falha ao criar o
PR. Para um provider real, esse outcome e a ponte direta para `recordIntegrated`
ficam **superados** pelo protocolo granular em `protected-integration.ts`.
Permanecem exportados apenas por compatibilidade com os contratos puros
anteriores; não são autorização para implementação externa.

```text
integration_authorized → branch_published → review_request_created
                       → aguarda nova decisão humana sobre merge
```

Não existe transição pura para `merged` ou `integrated`. A request imutável leva
autorização/resultado/correlação exatos, provider, repositório, remote, base
branch/SHA, branch local/remota e commit. `BranchPublicationReceipt` comprova a
branch; `ReviewRequestReceipt` comprova o review request e sua source/base. Cada
receipt registra `created | already_existed`.

Receipts avançam estado somente quando todos os identificadores casam com a
request autorizada. Replay idêntico é idempotente; divergência conflita. Branch
ou PR já existente só é aceito após inspeção comprovar commit e base exatos. A
máquina mantém `branch_published` quando criar PR falha e reconcilia após crash
sem repetir cegamente o efeito.

### Sequência obrigatória do futuro provider real

1. preflight local;
2. inspeção remota;
3. reconciliação (`already_existed` ou falha fechada por divergência);
4. uma única etapa mutante;
5. verificação pós-efeito por nova leitura;
6. emissão de receipt verificável;
7. persistência granular do receipt.

Se o efeito ocorrer e a persistência falhar, o retry volta à inspeção remota e
reconcilia pela mesma chave idempotente. `ProtectedIntegrationProvider` é apenas
a porta inerte: nenhum adaptador, shell, rede, GitHub ou efeito foi implementado.
