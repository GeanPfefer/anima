# 2026-10-13 — Publicação governada de `dev` (Single-Item V1)

Tipo: efeito remoto autorizado (push sem force de `dev`). Sem `main`, sem apagar refs/branches, sem limpeza de worktrees, sem código, migration ou
self-dev. Sequência da [sincronização local](2026-10-13-single-item-sincronizacao-local-dev.md).

## Preflight (2026-10-13T05:14:27Z) — PASS
HEAD/dev == 1a18fc8e95bb3327252bb0861e701081ddd693cd; sem operação Git pendente nem node/codex/git; índice vazio; 46 worktrees; WIPs protegidos íntegros;
sem hooks ativos nem refspecs extras de push (`push.default` padrão). Remoto REAL consultado (`git ls-remote`): `dev` 5391073fab… e `main` 99bec54e3a… —
iguais às refs locais; 5391073 é ancestral de HEAD ⇒ fast-forward de 8 commits, 0 merges. Varredura das 4130 linhas adicionadas: nenhum caminho suspeito
(.env/chaves/dumps/tmp), nenhum padrão de segredo real (um acerto genérico é o literal falso `'outro-segredo-falso'` do teste com Proxy); maior arquivo: 342 linhas.
`git push --dry-run --porcelain origin dev:refs/heads/dev` → única ref, `5391073..1a18fc8`.

## Os 8 commits publicados (ordem cronológica)
`fcb8243` transporte WSL opt-in ao investigation-v1 e readiness do Codex via WSL (9 arq.) · `8548f6a` Marco 009 Resiliência por Substituição (4) ·
`a9b95aa` revisão nativa de investigações ao CLI (18) · `6bc4aad` fase de investigações read-only concluídas (5) · `db75ce0` promoção do Single-Item V1 ao residente:
3 migrations + registro (4) · `bbb9c0e` gate fail-closed por sonda da RPC scoped (4) · `a4f46f8` fecho do Single-Item V1: volta isolada e gate integrado (37) ·
`1a18fc8` checkpoint do ANIMA: resolvedor único do modelo local do Project Work Planner (3; integração governada seq 86397).

## Publicação (05:15:14Z)
`git push --porcelain origin dev:refs/heads/dev` (única, sem `+`/force): exit 0, `5391073..1a18fc8`.
Verificação no remoto real (`ls-remote`): `dev` == 1a18fc8e95bb3327252bb0861e701081ddd693cd; `main` == 99bec54e3ab42bfe882a8686cd1385d8058b916e (inalterada).
Local: `dev...origin/dev` em dia (0 não publicados); `git status` idêntico ao do preflight (210 entradas; as 209 do mandato + o registro da sincronização);
índice vazio; WIPs `20260905000001/2` com os mesmos hashes; 46 worktrees. Preservados sem alteração: `refs/anima/integrated/d795e414`, branch `anima-work/2893a772-…`
(1a18fc8), clone `anima-integration-d795e414` (dev 1a18fc8). ANIMA: max seq global 86397; integração do item só 86396/86397; Verifier 86393 `rejected`; 0 claims; ledger 156.

## Pendências
Limpeza opcional (branch `anima-work/2893a772-…`, refs `refs/anima/*`, clone, worktrees antigas) — só com autorização. Governança: Modo W, contrato de aceite
(lint covers ⊆ expected_effects + tipos de aceite), mensagem automática do checkpoint, recovery de falha de runtime. `main` (99bec54) segue sem este trabalho.
