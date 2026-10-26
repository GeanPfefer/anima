# Project Builder V0 — T5-R1: autocrlf no executor de integração externa — 2026-10-26

Append-only. Tipo: **correção** (código + testes; sem schema). Formato de [`README.md`](README.md). Antecede: [`2026-10-26-project-builder-v0-t5-integracao-git-externa-governada.md`](2026-10-26-project-builder-v0-t5-integracao-git-externa-governada.md).

## Dados

- Branch `claude/t5-r1-autocrlf`, base `dev` = `origin/dev` = `fe78176c4bfb6af653551bfa9ded7bffe8f6872c`. Não integrado, não publicado.
- Contexto: a primeira integração externa real (PROOF-EXT-02: laboratório `main` 3405172 → 62a1d1e, recibo `integration_completed` seq 86893, `integrated`) deixou `src/clamp.js` com CRLF no worktree do laboratório (`status` = `M`, diferença só de EOL; ref, recibo e `npm test` corretos).

## Causa raiz

`operatorWorkTreeOptions` lê `core.autocrlf` global/sistema do operador (Git for Windows: `true`) e o executor o repassava como `git -c core.autocrlf=true` ao `status` e ao `merge --ff-only`. Pela precedência do Git, `-c` vence a configuração do repositório, então sobrescreveu o `core.autocrlf=false` LOCAL do laboratório e o `merge` gravou o arquivo com CRLF. O Git confiável ignora a config global/sistema por segurança; o padrão do operador só existe para repositórios que NÃO escolheram o próprio. Os testes T5 não cobriam repositório com `core.autocrlf` local.

## Correção (menor possível)

`ExternalGitIntegrationProvider.treeOptions()` (nova, privada): só devolve o padrão do operador quando `git config --local --no-includes --get core.autocrlf` retorna 1 (chave ausente). Chave definida localmente (0) ou erro (>1) ⇒ nenhuma opção é adicionada: a configuração efetiva do repositório é respeitada e nunca sobrescrita (fail-safe). Usada pelo `status` do pré-requisito e pelo `merge --ff-only`. Nenhuma outra mudança: ambiente Git confiável, hooks desligados, varredura de config insegura (`filter.*`, `include*`, `core.hooksPath` etc.), CAS, recibo, lease e checkout continuam como estavam. Sem novo subsistema de configuração.

## Provas

- Cinco testes novos (Git real, repositórios descartáveis): `local=false` + operador `true` ⇒ arquivo em LF, hash = blob de HEAD, `status` limpo; `local=true` + operador `false` ⇒ CRLF, limpo; sem config local + operador `true` ⇒ CRLF, limpo; o pré-requisito (`status`) não acusa sujeira indevida; filtro local continua recusando (`unsafe_repository_config`, sem `pwned.txt`).
- Os dois primeiros testes **falham** contra o código anterior (reproduzem o defeito) e passam com a correção.
- Suíte T5 web: 26/26. Regressão: 19 suítes / 308 testes (external*, integration-effect*, Single-Item, trusted-git/writer, executor-selection). `tsc` core e web limpos (ruído só em `scripts/_session`). `git diff --check` limpo.

## Restauração do laboratório (fora do commit)

Com `main` = `HEAD` = 62a1d1e, nenhuma operação Git em andamento, `src/clamp.js` como único arquivo modificado e diferença comprovadamente só de EOL (`git diff --ignore-space-at-eol` vazio), o arquivo foi restaurado com `git checkout -- src/clamp.js` (caminho único, hooks desligados), respeitando o `core.autocrlf=false` local. Bytes = blob de HEAD (`5ae5320…`), `status` limpo, `npm test` 4/4. Cópia do estado anterior guardada fora do repositório. Refs, commits, branches e recibos intocados.
