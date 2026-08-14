# ADR-002 — Camada de aplicação/integração/publicação real

> Estado: **decisão humana persistida; publicação protegida da branch implementada,
> persistível, reconciliável e FIADA a uma rota autenticada (ratificada por Gean em
> 2026-08-10); substrato de review request (fase 3) implementado e fiado atrás dos
> gates do operador — provider concreto do GitHub, RPC de persistência, rota HTTP
> fail-closed e projeção de apresentação — com ZERO efeito externo; a PRIMEIRA
> criação real de PR permanece proibida e é a próxima fronteira humana.** Este
> documento mapeia a fronteira aberta no item 10 do
> [ADR-001](adr-001-execucao-local-de-codigo.md) e propõe o menor contrato
> implementável para ela. A publicação de branch e agora a criação de review
> request são alcançáveis pela aplicação, mas ambos os efeitos externos permanecem
> atrás de atos explícitos do operador (configuração de alvo e de token no
> servidor, ausentes por padrão); qualquer transição a `merged`/`integrated` segue
> exigindo nova autorização humana, conforme o
> [Marco 003](../marcos/003-trabalho-autonomo-seguro.md). Ver *Fase 3 — substrato
> de review request implementado e fiado (2026-08-14)* ao final.

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

### Sequência obrigatória do provider real

1. preflight local;
2. inspeção remota;
3. reconciliação (`already_existed` ou falha fechada por divergência);
4. uma única etapa mutante;
5. verificação pós-efeito por nova leitura;
6. emissão de receipt verificável;
7. persistência granular do receipt.

Se o efeito ocorrer e a persistência falhar, o retry volta à inspeção remota e
reconcilia pela mesma chave idempotente.

### Implementação da primeira etapa externa (2026-08-09)

`GitBranchPublicationProvider` implementa somente
`integration_authorized → branch_published`. O coordenador
`executeAuthorizedBranchPublication` deriva boundary, handoff e request do log
persistido, recebe somente o target confiável do servidor e nunca recebe branch
da UI. Antes de qualquer mutação ele confere repositório/remote, branch local,
commit, ancestralidade e base remota; reconcilia a branch exata; usa refspec
explícito sem force/tags/wildcard; e só emite receipt após nova inspeção remota.

`record_branch_published` persiste o receipt append-only sob lock do item,
correlacionando ownership, versão, último resultado aceito, autorização,
tentativa e `WorktreeHandoffV1`. Retry após resposta incerta considera
`created|already_existed` descrições do mesmo efeito quando toda a identidade
externa coincide. O read model relê o fato após restart e inspeciona o remote;
branch removida ou alterada depois da persistência falha fechado e não é
recriada silenciosamente. A UX compartilhada distingue `authorized` de
`branch_published` e nunca afirma PR, merge ou integração.

A próxima fronteira permanece apenas pura: `ReviewRequestReceipt` exige
repositório, remote, review ID/referência, estado `open`, source branch/commit e
base branch/SHA exatos. Review já mergeado não satisfaz `review_request_created`.
Não existe provider concreto, RPC ou chamada mutante para criar review request.

## Fiação da publicação de branch ao caminho vivo (2026-08-10, ratificada por Gean)

A publicação protegida de branch — o **primeiro efeito Git externo real** do
produto — passou de maquinaria testada, porém não acionável, a **alcançável pela
aplicação** por uma rota autenticada, sem enfraquecer nenhuma invariante.

**Rota `POST /api/work-orchestration/branch-publications`.** O corpo carrega
**somente `workItemId`** (validado como UUID → 400 se malformado). Tudo o mais é
reconstruído pelo servidor: remote, repositório, branch-base e `providerId` vêm da
**configuração do operador** (`branchPublicationTargetFromEnvironment`, lendo
`ANIMA_INTEGRATION_*` do ambiente); branch, commit, base-SHA, autorização,
resultado aceito, tentativa e `idempotencyKey` são derivados do **log persistido**
pelo coordenador. Nenhum campo do cliente vira argumento Git — payloads com
`target`/`remote`/`refspec`/`provider`/`idempotencyKey` são ignorados.

**Alvo ausente ⇒ 503 fail-closed.** Sem configuração explícita do operador não há
capacidade de push: a rota recusa antes de qualquer efeito. Habilitar o efeito Git
externo real é, portanto, um ato de configuração do operador — nunca um payload.

**Autoridade por RLS.** Autenticação obrigatória (cookie web ou Bearer mobile);
a identidade é `auth.uid()`, jamais um `user_id` do corpo. O item de outra conta
é invisível por RLS (log vazio ⇒ 409 not-publishable) e, em profundidade, a RPC
`record_branch_published` recusa por `user_id` no `FOR UPDATE` (P0002) — provado
em pgTAP.

**Tradução HTTP fail-closed e sem vazamento.** Precondição sobre o estado
persistido ⇒ 409 (código estável, distinto de um inesperado); divergência de
repo/branch/base/commit ⇒ 409; remote indisponível ou push não comprovado ⇒ 502
retryável; inconsistência interna do servidor (`invalid_request`) ⇒ 500; erro da
RPC mapeado por SQLSTATE com **mensagem controlada** (nunca ecoa o Postgres);
qualquer inesperado ⇒ 500. Nenhuma mensagem carrega caminho, remote, stderr ou SHA.

**Prova nesta sessão sem efeito externo.** O caminho fiado foi exercitado
ponta-a-ponta contra um **remote bare LOCAL** (nunca origin/GitHub): publicação
real, idempotência (retry devolve `already_existed` sem segundo push), a invariante
"sem tags" comprovada **com efeito** (mesmo sob `push.followTags=true` no ambiente,
zero tags no remote) e a base intocada. Nenhum push contra remote externo foi
executado; `origin/main` permaneceu intacta.

A fronteira seguinte é inalterada: a criação real de review request continua
apenas pura, e `merged`/`integrated` seguem sem caminho alcançável.

## Fase 3 — substrato de review request implementado e fiado (2026-08-14)

Esta seção **supersede** as afirmações "a criação real de review request continua
apenas pura" e "não existe provider concreto, RPC ou chamada mutante para criar
review request" das seções de 2026-08-09/08-10 acima: o substrato de criação de
review request passou de puro a **implementado e alcançável pela aplicação, ainda
com zero efeito externo**. A criação real de PR contra o GitHub continua sendo a
fronteira humana explícita e **não foi atravessada**.

O que passou a existir (tudo atrás de gates do operador, provado só localmente):

- **Persistência `record_review_request_created`** (migration `20260813000001`):
  append-only sob lock do item, exige a branch já publicada (ordenação
  `branch_published → review_request_created`) e amarra o receipt de review ao
  handoff E ao receipt de branch persistidos (source/commit/base/provider/repo/
  remote). Índice único por `authorization_decision_id` ⇒ um review por
  autorização. Idempotência: replay idêntico devolve `replayed`; divergência de
  `reviewId` conflita (`55000`); isolamento por dono via `FOR UPDATE` (`P0002`).
  pgTAP `review_request.test.sql` (`plan(17)`).
- **Provider concreto `GitHubReviewRequestProvider`** (`apps/web`, fora do core):
  preparar → inspecionar/reconciliar → criar → pós-verificar, com transporte
  (`fetch`) injetado. Idempotente ("create-or-get"): inspeciona antes de criar,
  reconcilia `422 already exists` por releitura, nunca duplica. Só `GET` e
  `POST /pulls`; nunca merge/push/force/deploy. Token EXCLUSIVAMENTE do ambiente
  (`ANIMA_INTEGRATION_GITHUB_TOKEN`), nunca do cliente.
- **Composição server-side** (`authorized-review-request.ts`,
  `review-request-operation.ts`): lê fatos persistidos → projeta boundary/handoff/
  branch-receipt/review-receipt → deriva a request → reconcilia → cria → aplica a
  máquina de estados pura (`branch_published → review_request_created`) → persiste.
- **Rota `POST /api/work-orchestration/review-requests`**: corpo só `workItemId`;
  alvo, provider, branch, SHA e token vêm do servidor. **Dois gates fail-closed**:
  sem alvo `ANIMA_INTEGRATION_*` OU sem token do GitHub ⇒ `503` antes de qualquer
  efeito. Autenticação obrigatória; autoridade por `auth.uid()` via RLS.
- **Apresentação**: `projectWorkIntegration` promove ao estado posterior
  `review_request_created` quando o fato existe e casa autor/versão/autorização/
  resultado/tentativa/idempotencyKey de review; web e mobile exibem o PR aberto
  sem afirmar merge nem integração (fechando a afirmação "Nenhum PR foi criado",
  que seria falsa uma vez criado o PR).

Endurecimentos desta fase (todos com teste de regressão):

- **Liveness da autoridade persistida**: na reconciliação do caminho já
  persistido, comparar o review observado com o persistido por identidade
  (`sameReviewReceipt`) e falhar fechado (`remote_drift` → 409) quando divergem —
  o fato persistido descreve o MESMO review, não um PR qualquer na branch.
- **Desacoplamento do transporte HTTP**: as rotas de publicação de branch e de
  review request usam um `AbortController` fresco (nunca abortado) em vez de
  `request.signal`, alinhando-se a `/supervisor-turn` e `/execute-commanded`: a
  autorização é persistida antes do efeito e o ciclo mutativo não pode ser
  abortado no meio por desconexão do cliente (efeito possível + nada persistido =
  ambiguidade).

**Prova end-to-end LOCAL sem efeito externo** (`review-request-chain.integration.test.ts`):
o grafo exato que a rota constrói — `GitHubReviewRequestProvider` envolvendo o
`GitBranchPublicationProvider` real — exercitado com os DOIS transportes reais
juntos: `git push` contra um remote **bare local** e `POST /pulls` contra um
servidor **HTTP local** que emula o GitHub. Provado: publish real → create real
(um único POST), replay idempotente sem 2º POST, republish sem 2º push, e crash
após criar o PR (persistência falha depois do efeito) reconciliado pela releitura
real sem PR duplicado. Nenhum push/POST contra origin/GitHub; `origin/main`
intacta.

### Menor ação humana para a primeira prova externa

A implementação anterior à fronteira está completa. Para a primeira criação real
(decisão humana explícita, fora de sessão autônoma), basta, no nó autorizado:

1. configurar o alvo do operador (`ANIMA_INTEGRATION_REPOSITORY_ID`,
   `ANIMA_INTEGRATION_REMOTE_NAME`, `ANIMA_INTEGRATION_BASE_BRANCH`,
   `ANIMA_INTEGRATION_REPO_ROOT`) — já exigido pela publicação de branch;
2. configurar `ANIMA_INTEGRATION_GITHUB_TOKEN` (e, se GHE, `ANIMA_INTEGRATION_GITHUB_API_URL`);
3. sobre um item com `branch_published` persistido, chamar
   `POST /api/work-orchestration/review-requests` com `{ workItemId }`.

O provider inspeciona antes de criar, emite exatamente um `POST /pulls`,
pós-verifica head/base/commit/estado e persiste o receipt. Ausência de qualquer
gate mantém o `503` fail-closed. Nada além desses três passos de configuração/
chamada humana é necessário — e nenhum deles é executável por payload de cliente.
