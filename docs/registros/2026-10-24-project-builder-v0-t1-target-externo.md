# Project Builder V0 — T1: Target Registry mínimo (target externo) — 2026-10-24

Append-only. Tipo: **implementação** (código + testes, sem prova viva). Formato de [`README.md`](README.md).

## Dados

- Branch: `claude/t1-external-target` (worktree `C:\Users\GeanTeco\anima-work-t1-ext-target`). Base: `dev` = `origin/dev` = `1d5c4a1646321a92dc6af4d89865999270a592e0`. `origin/main` = `99bec54e3ab42bfe882a8686cd1385d8058b916e`, intacta.
- **Não publicado, não integrado em `dev`.** Sem migration, sem schema, sem executor novo. Nenhuma prova viva (Codex/Ollama) foi executada.

## O que existe agora

- **Contrato puro** (`packages/core/src/work-orchestration/external-target.ts`): referência `ext:<slug>`; identidade `{ repo_root_canonical, git_common_dir_canonical, root_commit_sha, base_sha }` em `intent.execution_spec.target.identity` (JSON existente); leitura estrita (campos fechados, SHAs de 40 hex, caminhos absolutos); comparação que trata grafia (barras, caixa Windows, barra final) como alias e qualquer outro desvio como mudança de identidade.
- **Resolver** (`apps/web/lib/work-orchestration/external-target-resolver.ts`): config explícita do operador `ANIMA_EXTERNAL_TARGET={"reference","repoRoot","rootCommitSha"}` (um target); `realpath`; Git via `trusted-git` (`.git` redirecionado recusado, ambiente limpo, hooks desligados); recusa worktree vinculado (`commondir`), `alternates`, repositório igual/aninhado ao do Anima, SHA-base inexistente/não-commit, história com ≠ 1 commit raiz, commit raiz diferente do pin do operador.
- **Fiação mínima**: `executor-selection` (um `ext:*` só executa com `externalTarget` verificado; sem `projectRoot()`; sem `prepareAnimaValidation`; exige worktree; referência desconhecida no worktree deixa de cair na raiz do Anima); `autonomous-backlog-deps` (verificação em `runTurn`, antes de `runSupervisorTurn` = antes do claim); `post-turn-observation` (Git observado no repositório reverificado; falha ⇒ nenhuma evidência fabricada, Single-Item retém); `verifier-opinion` (investigação nunca resolve target externo).
- **Auto-aprovação**: `autonomous-authorization.ts` NÃO foi alterado de propósito. Seu envelope exige `target.reference === 'anima'` e continua recusando externo (coberto por teste). Target externo só entra por aprovação humana.

## Provas

- Core: 127 suítes / 3137 testes verdes; `tsc --noEmit` core e web limpos.
- Web: 21 suítes / 331 testes verdes nas áreas tocadas (inclui 5 arquivos novos e a cadeia completa em repositórios descartáveis: identidade → verificação → worktree → gate real `npm test` → Git observado → reverificação, com o "Anima" simulado intacto).
- Suíte ampla `lib/work-orchestration app/api/work-orchestration cli`: falhas apenas (a) `backlog-cycle/route.test.ts` — falha idêntica no checkout principal sem esta mudança; (b) `cli/app.test.ts` — artefato do layout de worktree: `node_modules` é junction para o checkout principal, então o processo filho nativo resolve `@anima/core` para o `core` antigo; com `@anima/*` mapeado para esta worktree (hook em escopo temporário) as 56 passam; (c) carga: `mandated-acceptance-run` passa isolado (20 s).

## Limitações para a primeira execução externa real

1. Nada emite ainda um work item `ext:*` (o planner só emite `anima`); falta o materializador/CLI do operador que chama `captureExternalTargetSpec`.
2. Um único target por host (env). Sem catálogo.
3. Gates dependem de o repositório externo ter scripts `npm test`/`typecheck` e dependências já instaladas; `linkNodeModules` do worktree supõe `node_modules` na raiz do alvo. Nada é instalado automaticamente.
4. A identidade não é gravada dentro da evidência de Git/Verifier (isso exigiria mudar contratos persistidos); a continuidade é garantida por reverificação nos pontos de decisão.
5. Substituir o repositório por outro com a mesma história, no mesmo caminho, é indistinguível (mesma identidade).
6. `commit-graph` local corrompido no checkout principal (objeto `ce0e8cb…` ilegível) — não tratado.
7. Root único obrigatório: repositórios com históricos não relacionados mesclados são recusados.

## T1-R2 — hardening dos quatro achados P2 da revisão T1-R1 (candidato fab1895)

Branch `claude/t1-external-target-r2`, base `fab18958380d4539433d2732cc3ad159ba660b42`. Não publicado, não integrado.

- **P2-1** `post-turn-observation.ts`: `strict` passa a valer para qualquer contrato com `targetSpec` (não só Single-Item). Reverificação pós-volta falha/lança, ou evidência Git recusada ⇒ candidato retido (`held`), nenhum Git fabricado, Verifier não roda. Git do externo observado por `createTrustedGitRunner` sobre o `git-common-dir` verificado.
- **P2-2** `external-target-resolver.ts`: a raiz do Anima precisa ser comprovada (`isAnimaProjectRoot`: `.git` + `package.json` + `apps/web/package.json`) e legível, junto com seu `.git`; senão `external_target_anima_root_unknown`. Não há mais `catch` que pula a checagem; cwd arbitrário não é prova.
- **P2-3** `worktree.ts`: `GitWorktree.create({ hardenedGit })` (propagado por `WorktreeTarget.hardenedGit` só para `ext:*`): `worktree add/prune/remove` e `branch -D` no repositório principal com ambiente limpo (`scrubbedGitEnvironment`), `core.hooksPath=/dev/null`, `core.fsmonitor=false`, `core.untrackedCache=false`, `protocol.allow=never`. `/dev/null` é o mesmo valor já usado e provado em `candidateGit`/`trusted-git` (Git for Windows o aceita). O commit já usava `candidateGit` endurecido. O caminho do Anima não muda.
- **P2-4** `external-target-downstream.ts`: `external_target_not_supported_downstream` (e `external_target_state_unreadable` quando não se prova que o item é interno) antes de qualquer efeito em `integration-effect` (execução e autorização), `authorized-branch-publication`, `authorized-review-request`, `candidate-recovery`, `harness-recovery` e `mandated-acceptance-run`. `integration-target.ts` só resolve configuração de ambiente, sem item: é coberto pelos executores que o consomem. Sem fallback para `projectRoot()`.
- Testes novos: hook `post-checkout` hostil (com controle que prova que o hook dispara sem o endurecimento), lane não-Single-Item, raiz do Anima ausente/inválida/ilegível/junction, e as guardas a jusante.
