# 2026-10-14 — Durability D1: importação manual preparada (branch isolada, NÃO integrada)

Registro append-only, sanitizado. Fora do fluxo governado de self-dev: **sem Verifier, sem work accept, sem integração governada**; os itens 4dd96db2, 61607ca5 e e173a267 continuam `failed` e fad07a1f `proposed`. Antecedentes: `2026-10-14-durability-d1-attempt-733164b7.md`, planos 068–070. US$0.

## O que foi preparado
- Branch `manual/d1-restore-proof-import` em worktree separada (`C:\Users\GeanTeco\anima-recovery\d1-import-wt`), criada de `b6d2dda`. Checkout principal, `dev`, `origin` e WIPs intactos.
- Commit único `f7c629aa66619ad67b999687236b953190908ddd` (filho de b6d2dda), 6 arquivos, +746 linhas, autor GeanPfefer, trailers `Source-Candidate: f2bc461e…`, `Source-Work-Item: e173a267…`, `Integration-Mode: human-supervised-manual`, `Verification: independent-tests-only` (+ Co-Authored-By do assistente).
- Arquivos importados com blobs idênticos aos do candidato `f2bc461eaee341032afba7703e89c9d195779d93`. **Única diferença**: `apps/web/lib/restore-proof/restore-proof-gate.test.ts` linha 6, `path.resolve(__dirname, '../../../../..')` → `'../../../..'` (5→4 níveis).

## Verificações (na worktree, com working tree em CRLF por core.autocrlf=true; blobs em LF, 0 CR)
Jest do gate 5/5; suíte Python sintética 35/35 (~34 s); `tsc --noEmit` do web sem erros; `git diff --check` limpo; escopo exatamente os 6 arquivos; sem `__pycache__`; 0 containers `anima-restore-proof-*` residuais; análise estática: sem DML/DDL/rolpassword/pg_authid (única ocorrência = lista `VALUES` de privilégios em roles-projection); teste negativo: com `core.autocrlf=false` (via variável de ambiente, sem tocar config) `test_files_format` detecta CRLF (5 falhas). Privacidade: testes de sentinela da suíte passam; sonda cruzada anterior sem scram/md5/password nas saídas.

## Limites
Prova manual por testes independentes, não pelo fluxo governado. Banco residente nunca consultado pelas ferramentas.

## Integração e publicação (2026-10-14, autorizadas por humano)
- `git merge --ff-only manual/d1-restore-proof-import` no checkout principal: `dev` b6d2dda → `f7c629aa66619ad67b999687236b953190908ddd` (sem merge commit, squash ou cherry-pick; índice vazio; status dos WIPs idêntico antes/depois; `git diff --check` limpo).
- `git push origin dev` normal, sem force: `b6d2dda..f7c629a`. Remoto confirmado: `origin/dev = f7c629aa…`; `origin/main = 99bec54e3ab42bfe882a8686cd1385d8058b916e` intacta.
- Proveniência: `Integration-Mode: human-supervised-manual`; `Source-Candidate: f2bc461eaee341032afba7703e89c9d195779d93` (attempt 733164b7); `Source-Work-Item: e173a267-aa49-4c59-80eb-1aa85f172cd9`; `Verification: independent-tests-only`. **Sem parecer do Verifier**; sem `work accept`/integração governada; nenhum evento de integração no ledger.
- Ledger: 4dd96db2, 61607ca5 e e173a267 continuam `failed`; fad07a1f `proposed` e bloqueado. Último evento 86765; 156 migrations; 0 claims e 0 leases vigentes; `restic-repo` vazio.
- Pendente (fora deste registro): este arquivo permanece untracked; branch/worktree `manual/d1-restore-proof-import` preservadas.
