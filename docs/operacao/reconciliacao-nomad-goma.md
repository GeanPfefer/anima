# Reconciliação Nomad → Goma

Procedimento para trazer à Goma o trabalho feito no Nomad enquanto a Goma estava inacessível, sem divergência descontrolada. Origem: [NOMAD-01-A](../registros/2026-11-09-nomad-01-a-encerramento-de-arvore-posix.md).

## Regras

- O trabalho do Nomad vive **só** em branches `nomad/*`, sempre com base num commit que existe no GitHub (hoje `origin/dev` = `21b2af9`).
- O Nomad não faz push nem merge em `dev`; a integração é decidida na Goma, que tem o `dev` mais novo (`506980c` e as branches locais `ACC-02-A1`/`CLOUD-04`).
- O transporte padrão é um **git bundle** (arquivo), que não exige publicar nada. Publicar as branches `nomad/*` no GitHub é uma alternativa, mas é decisão humana.

## 1. No Nomad: exportar

```powershell
cd C:\dev\anima
git bundle create ..\nomad-<data>.bundle origin/dev..nomad/posix-process-tree-kill
git bundle verify ..\nomad-<data>.bundle
git log --oneline origin/dev..nomad/posix-process-tree-kill   # anote os commits
```

Para várias branches, liste todas no `bundle create` (ou use `--branches=nomad/*` com a base excluída por `^origin/dev`).

## 2. Na Goma: inspecionar antes de integrar

```powershell
cd <checkout principal>
git status                       # precisa estar limpo; preserve WIPs existentes
git bundle verify <caminho>\nomad-<data>.bundle
git fetch <caminho>\nomad-<data>.bundle "refs/heads/nomad/*:refs/remotes/nomad/*"
git log --oneline 21b2af9..dev   # o que a Goma tem e o Nomad não viu
git diff --stat 21b2af9 nomad/posix-process-tree-kill
git log --oneline 21b2af9..dev -- apps/web/lib/work-orchestration/worktree.ts apps/web/lib/work-orchestration/worktree.test.ts
```

Se o último comando não listar nada, a Goma não tocou nos mesmos arquivos e o rebase é trivial. Faça a mesma checagem contra `ACC-02-A1` e `CLOUD-04`.

## 3. Na Goma: rebasear numa branch própria

```powershell
git switch -c nomad/posix-process-tree-kill-goma nomad/posix-process-tree-kill
git rebase dev
npm.cmd run typecheck
npm.cmd test --workspace=apps/web -- lib/work-orchestration/worktree.test.ts lib/work-orchestration/native-cli-coder.ai-memory.test.ts
```

Conflito em `runProcess`: preserve o caminho Windows da Goma e reaplique apenas o `detached` + `SIGKILL` ao grupo fora do `win32`.

## 4. Integrar

Com os testes verdes no Windows, integre em `dev` pelo fluxo habitual (fast-forward após o rebase) e registre a integração num novo registro em `docs/registros/`. Só então apague as branches `nomad/*` já integradas.
