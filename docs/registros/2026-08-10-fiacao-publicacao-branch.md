# 2026-08-10 — Fiação da publicação protegida de branch ao caminho vivo

**Tipo:** desenvolvimento. **Branch:** `claude/integration-application-layer`.
**HEAD inicial:** `1fa67aa` · **HEAD final:** `1229410`. Sessão autônoma sob
ratificação humana (Gean) da próxima fronteira do [ADR-002](../arquitetura/adr-002-integracao-aplicacao-publicacao.md).

## Objetivo

Fiar a publicação protegida de branch — o **primeiro efeito Git externo real** do
produto — ao caminho vivo da aplicação: uma autorização de integração já
persistida deve alcançar `executeAuthorizedBranchPublication` por um caminho
autenticado, confiável, fail-closed e idempotente, sem executar push externo real
nesta sessão.

## Commits (5)

| Hash | Assunto |
|---|---|
| `01d9d5b` | Tipe as precondições da publicação de branch |
| `d311784` | Fie a publicação protegida de branch ao caminho vivo |
| `3576f0b` | Endureça a tradução HTTP e remova código morto da fiação |
| `18f361f` | Prove o isolamento por dono da publicação de branch |
| `1229410` | Registre a fiação da publicação de branch nos documentos vivos |

## Mudanças relevantes

- **Rota autenticada** `POST /api/work-orchestration/branch-publications`
  (`apps/web/app/api/work-orchestration/branch-publications/route.ts`).
- **Target reconstruído exclusivamente pelo servidor** — `integration-target.ts`
  lê `ANIMA_INTEGRATION_REPOSITORY_ID/_REMOTE_NAME/_BASE_BRANCH/_REPO_ROOT`;
  ausente por padrão ⇒ 503 fail-closed. Provider fixo `git-branch-publication-v1`.
- **Validação de `workItemId` como UUID** na rota (malformado ⇒ 400).
- **Tradução HTTP fail-closed** — `branch-publication-http.ts` (classificador +
  `settle` + `runAuthorizedBranchPublication{,WithSupabase}`) e precondições
  tipadas `BranchPublicationPrecondition` no coordenador.
- **Remoção de código morto** — a rota passou a usar
  `executeAuthorizedBranchPublicationWithSupabase` (antes sem uso).
- **Isolamento por dono** provado em pgTAP (`supabase/tests/branch_publication.test.sql`).
- Documentação viva atualizada: ADR-002 (§ "Fiação da publicação de branch ao
  caminho vivo"), [PRD](../../anima-prd.md), [Plano 002](../planos/002-modo-autonomo-v0.md).

Detalhes canônicos no ADR-002; este registro apenas amarra e resume.

## Decisões

- O corpo da rota carrega **somente `workItemId`**; remote/repositório/base/provider
  vêm do servidor, e branch/commit/SHA/idempotencyKey do log persistido. Campos do
  cliente (`target`/`remote`/`refspec`/`provider`/`idempotencyKey`) são ignorados.
- `invalid_request` do provider ⇒ **500** (inconsistência do servidor), não 400.
- Habilitar o efeito Git externo é um **ato de configuração do operador** (env do
  alvo), não um payload — sem config, 503.

## Bugs encontrados e corrigidos (2ª passagem adversarial)

- `workItemId` malformado caía como erro de cast UUID no Postgres e virava 500
  opaco → **corrigido** com validação de UUID na rota (400).
- `invalid_request` mapeado como 400 (implicava erro do cliente) → **corrigido**
  para 500.
- `executeAuthorizedBranchPublicationWithSupabase` estava sem uso (código morto) →
  **corrigido** fazendo a rota usá-lo.

## Provas/testes e gates

- Unit: `integration-target.test.ts`, `branch-publication-http.test.ts`.
- Rota: `branch-publications/route.test.ts` (401/400/503, delegação, alvo do
  servidor, rejeição de campos do cliente).
- **Integração Git real contra bare remote LOCAL**: `branch-publication-http.integration.test.ts`
  — publicação real, idempotência (`already_existed` no retry, sem 2º push),
  invariante "sem tags" **com efeito** (`push.followTags=true` no ambiente ⇒ zero
  tags no remote), base intocada.
- pgTAP `branch_publication` 16→17 (isolamento por dono: 2º usuário allowlistado ⇒ P0002).
- **Gates verdes em `1229410`:** typecheck 5 workspaces · core 673 · web 360 (serial)
  · mobile 33 · pgTAP `branch_publication` 17 (via `docker exec psql`, BEGIN/ROLLBACK,
  sem `db reset`).

## Flake conhecido (não é regressão)

O run **paralelo** de web tem 1 flake ambiental em `WorkProposalCard.test.tsx`
(contenção de fetch-mock sob os testes git-pesados de worktree). Verde isolado e
serial. Não foi tocado nesta sessão.

## Invariantes de segurança preservadas

Sem force, sem tags (`--no-follow-tags`), sem wildcard; apenas branch do namespace
`anima-work/`; SHA publicado = SHA autorizado; remote = o configurado pelo servidor;
nenhum dado do cliente vira argumento Git; publicação idempotente; retry reconcilia
antes de repetir efeito; divergência falha fechada; autoridade por `auth.uid()`/RLS.

## Efeitos externos

**Nenhum push externo** (nem origin, nem GitHub) — a fiação foi provada só contra
remote bare local. **Nenhum PR, merge ou `integrated`.** `origin/main` intacta
(`973ef46`). Branch sem upstream (nunca pushada).

## Worktrees/ambientes preservados

`.worktrees/mobile-completed-result`, `.worktrees/roadmap-003-006`, `G:/anima-demo-mateus`
e `G:/anima-local-test` (detached `1fa67aa`, ambiente de prova manual do operador)
**não foram tocados**.

## Fronteiras humanas restantes (`BLOCKED_BY_HUMAN_DECISION`)

1. Gatilho de UI (botão "publicar branch" no cartão) — decisão de produto.
2. Criação real de review request/PR (provider mutante + GitHub).
3. Transição `merged`/`integrated` (sem caminho alcançável, por design).

## Próximo ponto exato de retomada

A partir de `1229410`, com o operador tendo configurado `ANIMA_INTEGRATION_*`
apontando para um alvo real, `POST /api/work-orchestration/branch-publications`
com `{workItemId}` de um item com integração autorizada executará o primeiro push
protegido real. A decisão seguinte é o **provider de review request**
(`ReviewRequestProvider`/`recordReviewRequestCreated` já existem puros no core),
atrás de nova aprovação humana.
