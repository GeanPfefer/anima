# Substrato local de review request (fail-closed, até a fronteira do efeito externo)

**Data:** 2026-08-13
**Tipo:** implementação (substrato local/fail-closed; pronto para revisão, NÃO ratificado)
**Branch:** `claude/integration-application-layer`
**HEAD inicial:** `fae78fe` (após a R3)
**HEAD final:** `90faebf` (+ este registro; ver "Commits")
**`origin/main`:** `973ef46` — **intacta, sem push**

## Objetivo

Sob o mesmo mandato aberto do Supervisor, seguir para o próximo recorte seguro
após a R3: **persistir o fato `review_request_created`** do protocolo ADR-002
(`integration_authorized → branch_published → review_request_created`), de forma
**local e fail-closed**, espelhando `branch_publication`, e **parar exatamente
antes** do primeiro efeito externo real (criar PR no GitHub) — que permanece a
**fronteira humana** (ADR-002, fase 3, "NÃO iniciada"). Fecha a **assimetria**
identificada: o branch já tinha persistência + projeção; o review request só tinha
o contrato puro (`ReviewRequestReceipt`, `recordReviewRequestCreated`,
`ReviewRequestProvider`) sem persistência nem projeção.

## Autorização documental (por que este recorte é seguro)

- [ADR-002](../arquitetura/adr-002-integracao-aplicacao-publicacao.md): o protocolo
  granular já prevê `review_request_created` e diz "`ReviewRequestReceipt` comprova
  o review request e sua source/base". A **fase 2** (persistência de um fato,
  fail-closed, sem efeito externo) é o padrão já aplicado a `branch_published`; a
  **fase 3** (o `IntegrationPublisher`/provider real que faz push/PR/merge) é a que
  exige nova autorização humana — **não** implementada aqui.
- [PRD §1f.1](../../anima-prd.md): "A criação de review request permanece a próxima
  fronteira humana." Este recorte **não cria** review request: só persiste um
  receipt já comprovado por um provider. Sem provider real (não fornecido), o fato
  **nunca é produzido** em produção. A fronteira fica **pronta para uma decisão
  humana mínima** (fiar um provider real).
- Nada é ratificado por conta própria: estado **pronto para revisão, NÃO
  ratificado** (como UX-00/UX-03 em seu momento).

## Commits

- `90faebf` — *Persista o substrato local de review request (fail-closed).*
- (este registro, commit próprio de documentação)

## O que foi implementado

1. **Migrations** (`supabase/migrations/`):
   - `20260813000000_review_request_vocabulary.sql`: `ALTER TYPE work_event_type ADD
     VALUE 'review_request_created'` (vocabulário separado, como o branch, por causa
     do `ALTER TYPE ADD VALUE`).
   - `20260813000001_review_request.sql`: índice único parcial por
     `authorization_decision_id` + RPC `record_review_request_created`. A RPC
     **espelha** `record_branch_published` e acrescenta: (a) **ordenação** — exige
     `branch_published` prévio para a mesma autorização (senão `P0002`); (b)
     **amarração** — o receipt de review é validado contra o handoff **e** contra o
     receipt de branch persistido (source/commit/base/provider/repo/remote). Gates
     idênticos: auth + allowlist, `FOR UPDATE` por dono, item `completed` na versão
     esperada, decisão `authorize`, `result_accepted`→`result_submitted`→handoff,
     idempotência por `authorization_decision_id` (replay vs. conflito), insert
     `author='system'`. **Não** cria PR, não faz push, não muda o estado do item,
     não registra `merged`/`integrated`.
2. **Tipos** (`packages/types/src/database.ts`): regeneração **cirúrgica** — assinatura
   de `record_review_request_created`, valor de enum na união e no array `Constants`.
3. **Core** (`packages/core/.../protected-integration.ts`): `parseReviewRequestReceipt`
   e `projectReviewRequestReceipt` — espelho puro dos de branch, reusando o
   `validReviewReceipt` já existente. Projeção fail-closed: 0 fatos → `null`; >1 →
   `receipt_conflict`; divergência de autor/versão/schema/correlação/target →
   `receipt_mismatch`.
4. **Web** (`apps/web/.../review-request-operation.ts`): `createAndPersistReviewRequest`
   orquestra `inspect → create → máquina de estados (branch_published →
   review_request_created) → persistência` com o `ReviewRequestProvider`
   **injetado**. Reconcilia antes de criar (o PR pode já existir após crash). O
   provider real é a fronteira humana; **nenhum efeito externo é embutido**.

## Gates executados (verdes)

- **pgTAP** completo: `supabase test db` → **30 arquivos, 747 testes, Result: PASS**
  (novo `review_request.test.sql` com **17** asserções: ordenação, autorização
  exata, persistência, idempotência, mismatch de source/branch, conflito por campo
  não fixado, versão divergente, input inválido, estado permanece `completed`, não
  cria `merged`/`integrated`, isolamento por dono).
- **Core** Jest completo: **31 suítes / 689 testes** PASS (2 novos: projeção e parser
  de review).
- **Web** Jest: `review-request-operation` **6/6** PASS (provider fake).
- **`npm run typecheck`**: verde nos 5 workspaces (regeneração de tipos correta).

## Invariantes de segurança / efeitos externos

Nenhuma proteção afrouxada. **Nenhum push/PR/merge/deploy.** `origin/main` intacta
(`973ef46`). A migration é **local** (aplicada por `supabase migration up`, nunca
`db reset`). A RPC é `SECURITY DEFINER` fail-closed e **não** consegue produzir
efeito Git externo — só insere um evento dado um receipt já verificado. **Sem
provider real, `review_request_created` é inalcançável em produção.** Nenhum
`.worktrees/`, `.env.local` ou `settings.local.json` tocado.

## Fronteiras humanas restantes (`BLOCKED_BY_HUMAN_DECISION`)

- **Fiar um `ReviewRequestProvider` real** (GitHub) que crie o PR de fato — primeiro
  efeito externo; ADR-002 fase 3; exige nova autorização humana explícita. Tudo até
  aqui deixa essa fronteira **pronta**: contrato, persistência, projeção, orquestração
  e testes com fake; falta só o adaptador externo, atrás de autorização.
- Ratificar este substrato como etapa aceita (como o branch foi ratificado por Gean).
- `merged`/`integrated`, deploy, agendamento/recorrência.

## Próximo passo exato

Sob nova decisão humana: (a) ratificar este substrato; e/ou (b) autorizar a fase 3
(provider real de PR) — que, quando fiada, deve ser **idempotente por
`idempotencyKey`** ("create-or-get PR"), com preflight/verificação como o provider
de branch, e provada em ambiente controlado antes de qualquer PR real. Até lá, o
fato permanece inalcançável e o repositório fica pronto para a decisão mínima. Sem
push; `origin/main` intacta. Nenhuma rotina/recorrência criada.
