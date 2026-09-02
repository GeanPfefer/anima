# 2026-09-02 — CLI operacional do Anima como adapter oficial (capability-first)

**Tipo:** desenvolvimento + prova. **Branch:** `dev`. **HEAD inicial:** `40c5005`.
**HEAD final:** commit que contém este registro.

## Objetivo

Criar a primeira fatia funcional de uma CLI oficial do Anima, desacoplando capacidades
operacionais essenciais da interface web **sem duplicar lógica de domínio**, e provando-a
com o PIN-02: inspecionar sua evidência e registrar **REQUEST_CHANGES** pelo fluxo canônico
**sem subir o Next.js**. Princípio: **CAPABILITY FIRST → INTERFACES SECOND** — web, CLI e
futuramente mobile/TUI são adapters sobre os mesmos contratos e application services.

## Seam existente (mapeamento)

As rotas web de orquestração já eram adapters finos: `route → createWorkOrchestrationService(client)
→ service.<op>()` (ex.: `app/api/work-orchestration/reviews/route.ts` → `reviewResult`). O único
acoplamento web era o `client` (Supabase server por cookies via `next/headers`). A CLI reusa
exatamente o mesmo `createWorkOrchestrationService` ([server.ts](../../apps/web/lib/work-orchestration/server.ts))
e as projeções puras do core (`reconstructWorkPresentation`, `verifyPersistedWorkResult`,
`planResultReview`). Identidade pela via do resident host (ADR-003 §11): `createGoTrueIdentityProvider`
([ports.ts](../../apps/web/lib/resident-host/ports.ts)) → access token → `createBearerClient`
([bearer.ts](../../apps/web/lib/supabase/bearer.ts)) → RLS/`auth.uid()`. **Nunca `service_role`.**
A CLI **não** fala com `localhost:3000`.

## Mudanças

- **core (compartilhado):** `planResultReview` puro ([result-review.ts](../../packages/core/src/work-orchestration/result-review.ts))
  monta o `ReviewWorkResultCommand` (`accept`/`request_changes`) derivando a correlação
  (`reviewedResultEventId`, `expectedProposalVersion`) e reusando a regra `availableWorkActions`;
  a autoridade final permanece no `WorkOrchestrationService.reviewResult`/RPC.
- **CLI (`apps/web/cli/`):** `args.ts` (parser puro), `identity.ts` (identidade residente), `app.ts`
  (runners sobre a porta `WorkOrchestrationPort` = subconjunto do application service), `render.ts`
  (humano derivado do payload estável), `exit-codes.ts`, `anima.ts` (entrypoint fino), `README.md`.
- **runtime:** roda por Node 24 TS nativo + `--import ./scripts/ts-resolve.mjs` + `--env-file-if-exists=.env.local`,
  idêntico ao `local-host`; scripts npm `anima` (raiz e `apps/web`).
- **comandos:** `status`, `work list`, `work show <id>`, `work evidence <id>`,
  `work request-changes <id> --reason "…"`, `work approve <id>`. `--json` em todos; modo humano
  derivado do mesmo payload. Exit codes: `0` sucesso · `1` operacional · `2` uso · `3` recusa por regra.

## Bug encontrado e corrigido (nesta sessão)

`process.exit()` no encerramento corria com o fechamento dos sockets keep-alive do undici (usados
pelo supabase-js via `fetch`) e disparava, de forma não-determinística, a assertion do libuv no
Windows `!(handle->flags & UV_HANDLE_CLOSING)` (`src\win\async.c`), abortando com **exit 127** e
mascarando o exit code real — quebra do contrato de saída. Corrigido em `anima.ts`: o fluxo normal
só define `process.exitCode` e fecha o dispatcher global do undici (best-effort, sem `any`), deixando
o loop drenar. Exit codes voltaram a ser determinísticos (status→0 ~690ms, item inexistente→1, uso→2).

## Provas / gates

- **typecheck:** `apps/web` e `packages/core` limpos (`tsc --noEmit`).
- **core:** 66 suites / 1379 testes verdes (inclui os 5 novos de `planResultReview`).
- **web (unit, `lib/work-orchestration`, sem integração):** 58 suites / 789 testes verdes.
- **CLI:** 21 testes verdes (`args` 11, `app` 6 com duplo do service, `render` 4). Sem snapshot de terminal.
- **prova viva (Next DOWN, Supabase UP):** porta `3000` ausente, `54321` no ar. `anima status` conectou
  como `e570e43b-…` (RLS via GoTrue). `anima work show PIN-02` e `work evidence PIN-02` expuseram o
  contraste **Verifier registrado `verified` (v1) × Verifier ao vivo `inconclusive` (v2, 0 violações /
  3 lacunas / 11 checks)** e cobertura de aceite 0/3. `anima work request-changes PIN-02 --reason "…"`
  (razão autorizada exata) → `{ok:true, state:"changes_requested"}` exit 0 pelo `reviewResult` canônico.
  `anima work show`/`status` confirmaram `review → changes_requested` (ações passaram a `[start]`;
  contagem `review` 1→0, `changes_requested` 1→2).

## PIN-02

`8e9fd82b-…` passou de `review` para `changes_requested` (proposal v2, tentativa
`5a0c7716-…`, resultado revisado `845d138b-…`). A branch `anima-work/5a0c7716-…` / checkpoint
`2602dac` **não** foi editada. Detalhe da barreira de cobertura em
[2026-09-02-cobertura-aceite-verifier-v2.md](2026-09-02-cobertura-aceite-verifier-v2.md) e
[2026-09-02-pin02-prova-viva-self-dev-review.md](2026-09-02-pin02-prova-viva-self-dev-review.md).

## Segurança e efeitos externos

Sem `service_role` (RLS via GoTrue/Bearer; token nunca logado nem impresso). Sem migration, sem
`db reset`, sem publish externo, sem PR/merge/deploy, sem alteração de `origin/main`. Único efeito
persistido: o evento canônico `changes_requested` do PIN-02, autorizado pelo usuário nesta sessão
com a razão exata. Artefatos locais `.worktrees/`, `watch4-sensors.txt`, `apps/web/.env.local`,
`.claude/settings.local.json` preservados. Nenhum aplicativo interativo do usuário foi encerrado.

## Fronteiras humanas / próximo ponto de retomada

O próximo ciclo de correção **não** é autônomo a partir de `changes_requested`: `correctReviewedWorkItem`
([review-correction-orchestration.ts](../../apps/web/lib/work-orchestration/review-correction-orchestration.ts))
só é acionado pela rota web `review-corrections` — não pelo host autônomo — e o sucessor nasce em
`proposed`, exigindo **aprovação humana**. Não foi inventado retry/successor. Retomada exata:
materializar o sucessor de correção (rota `review-corrections`, ou um futuro `anima work correct`) e
aprová-lo; então o self-dev implementa as provas focadas do codec `ProjectIdeaV0` (round-trip;
campo extra/shape ausente/malformado/versão desconhecida fail-closed) → gates com `covers` ligados
ao aceite → Verifier v2 `verified` → volta a `review`. PIN-03 (migration) permanece adiado até a
convergência do PIN-02.
