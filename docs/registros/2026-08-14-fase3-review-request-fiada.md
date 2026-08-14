# 2026-08-14 — Fase 3 do review request fiada atrás dos gates (local, sem efeito)

**Tipo:** desenvolvimento + prova (local). **Objetivo:** fechar o recorte
interrompido (rota de review request) e avançar autonomamente pela cadeia
protegida `integration_authorized → branch_published → review_request_created`,
com trabalho local, reversível e provado, sem atravessar a fronteira externa.

## Estado do Git

- **Branch:** `claude/integration-application-layer`.
- **HEAD inicial:** `8007560` · **HEAD final:** `fc17cae`.
- **`origin/main`:** `973ef465acaa3955f8e176c72903975cf3912ac6` — **intacta, sem push**.
- **Working tree final:** só `docs/` + `anima-prd.md` (este registro e docs vivos)
  e o não-rastreado `.worktrees/` (preservado). Nenhum arquivo não relacionado
  tocado.

## Commits criados (nesta sessão)

1. `137976f` — Rota `POST /api/work-orchestration/review-requests` atrás dos gates
   do operador (fail-closed, duplo gate: alvo + token). Fecha o recorte que o
   limite anterior interrompeu (os arquivos existiam untracked, sem rodar/commitar).
2. `8276540` — **Bugfix determinístico:** liveness da autoridade persistida.
   `sameReviewReceipt` (core, agora exportado) compara o review observado com o
   persistido; divergência de identidade ⇒ `remote_drift` (409). Antes, só
   `observed===null` falhava fechado.
3. `43aa07d` — **Evidência:** E2E composto com transportes reais locais
   (`review-request-chain.integration.test.ts`): bare Git local + servidor HTTP
   local emulando o GitHub, pelo grafo exato da rota.
4. `358a572` — **Bugfix de consistência:** rotas `branch-publications` e
   `review-requests` desacopladas de `request.signal` (AbortController fresco),
   alinhando ao padrão ratificado de `/supervisor-turn` (3c9ac70) e
   `/execute-commanded`.
5. `fc17cae` — Projeção `review_request_created` na apresentação (core + web +
   mobile); fecha a afirmação "Nenhum PR foi criado", que seria falsa após a
   criação do PR.

Docs vivos atualizados fora de commit até o fecho da sessão:
[ADR-002](../arquitetura/adr-002-integracao-aplicacao-publicacao.md) (banner +
seção *Fase 3 — 2026-08-14*) e [PRD](../../anima-prd.md) (estado tático + tabela
de maturidade). Este registro os amarra.

## Bugs encontrados e corrigidos (com teste de regressão primeiro)

- **Liveness cega à identidade** (`authorized-review-request.ts`): a reconciliação
  do caminho já persistido aceitava qualquer PR aberto na branch como prova de
  liveness. Cenário: PR persistido fechado + outro PR (número diferente) na mesma
  branch@commit→base ⇒ a resposta afirmava que o PR antigo seguia aberto.
  Reproduzido (retornava 200), corrigido para `remote_drift` (409). Commit `8276540`.
- **Acoplamento ao transporte HTTP em rota mutativa** (`branch-publications` e
  `review-requests`): `request.signal` propagava a desconexão do cliente ao efeito
  externo (push / `POST /pulls`), podendo abortá-lo no meio ⇒ efeito possível sem
  persistência = ambiguidade mascarada como erro transitório. Reproduzido
  (`aborted=true` chegava ao runner), corrigido para signal desacoplado. Commit
  `358a572`.

## Não-bugs investigados (documentados, sem alteração)

- **Liveness análoga na publicação de branch:** `inspectBranch` já falha fechado em
  commit divergente (`remote_branch_conflict`) e o receipt é 100% derivado da
  request (não há campo de identidade não-derivado como o número do PR). Um
  `sameBranchReceipt` no caminho já-persistido seria dead code — **não adicionado**.
- **Concorrência / duplicação de PR / caminho `422`:** já coberto por unit tests
  (`github-review-request.test.ts`: 422→reconcilia e 422→`validation_failed`) e por
  idempotência real na E2E. Um teste de concorrência adicional seria redundante —
  **não adicionado**.

## Provas / gates (números)

- **pgTAP:** `supabase test db` — **30 arquivos / 747 testes PASS** (inclui
  `review_request` plan(17), `branch_publication`, `integration_decision`). SQL
  **inalterado** nesta sessão; execução é reconfirmação de autoridade.
- **Jest core:** 31 suítes / **689** testes.
- **Jest web `work-orchestration`:** 29 suítes / **351** testes (inclui a E2E
  composta e os testes de signal desacoplado).
- **Jest web `WorkProposalCard`:** **35**.
- **Jest mobile:** 4 suítes / **33**.
- **Typecheck:** 5 workspaces limpos.
- **Flakes:** nenhum observado nesta sessão.

## Invariantes de segurança preservadas

- Fail-closed: rota de review request `503` sem alvo OU sem token; token só do
  ambiente, nunca do cliente; corpo só `workItemId`.
- Autoridade dos fatos persistidos: composição lê o log; RPC amarra receipt↔handoff
  ↔branch e isola por dono (`FOR UPDATE`); apresentação só promove estado com
  correlação exata.
- Hierarquia Supervisor → Executor → Reviewer/Verifier e revisão humana nas
  fronteiras protegidas preservadas.

## Efeitos externos

**Explicitamente ZERO.** Nenhum push, PR, merge, deploy, token real, chamada a
GitHub/`gh`, alteração de remote ou de `origin/main`. Toda prova usou bare Git
**local** e servidor HTTP **local**. `origin/main` intacta; branch nunca pushada.

## Fronteira humana restante (`BLOCKED_BY_HUMAN_DECISION`)

A **primeira criação real de PR** contra o GitHub. Menor ação humana necessária
(no nó autorizado, ver ADR-002 *Fase 3*): (1) configurar o alvo do operador
`ANIMA_INTEGRATION_*`; (2) configurar `ANIMA_INTEGRATION_GITHUB_TOKEN` (e
`ANIMA_INTEGRATION_GITHUB_API_URL` se GHE); (3) sobre um item com `branch_published`
persistido, chamar `POST /api/work-orchestration/review-requests` com
`{ workItemId }`. Nada além disso; nada executável por payload de cliente.

## Próximo ponto exato de retomada

Substrato da fase 3 completo e provado localmente, **pronto para revisão, NÃO
ratificado**. Retomar por: (a) ratificação humana da fase 3 e/ou execução da
primeira prova externa acima; ou (b) se novo trabalho local for pedido, o próximo
fato do protocolo (`merged`/`integrated`) permanece **sem caminho alcançável** e
exige nova decisão humana antes de qualquer substrato.
