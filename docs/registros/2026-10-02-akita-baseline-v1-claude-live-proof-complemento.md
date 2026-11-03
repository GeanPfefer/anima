# 2026-10-02 — Complemento da evidência Claude live proof

Tipo: complemento documental da mesma prova técnica, conforme fatos fornecidos
pelo humano nesta sessão. Não é nova execução. Supre os campos ausentes no
[registro Claude](2026-10-02-akita-baseline-v1-claude-live-proof.md) e na
[reconciliação final](2026-10-02-akita-baseline-v1-final-reconciliation.md),
preservados como histórico append-only.

- Backend: ClaudeCodeCoderBackend; Claude Code **2.1.286** na prova viva.
- Auth por assinatura: **claude.ai / firstParty / Pro**.
- Modelo observado: **claude-opus-5-5**; `fast_mode: off`; effort **não reportado**.
- Processo: **50,4 s**; envelope `duration_ms: 48044` (48,044 s);
  duração API **39228 ms** (39,228 s); **16 turns**.
- Prova total: **72,0 s**; gate host: **5,7 s**, **PASS**.
- Prompt: **2958 caracteres**; SHA-256 fornecido apenas como prefixo
  **`dfb28260…`**. Hash completo e payload literal não fornecidos;
  não reconstruídos nem inferidos. Mesma spec/prompt TPC-01 relatada anteriormente.
- Base: `f94bc5a` (`f94bc5a2dc8076be40471d5f7810d81518cb8bfa`).
- Arquivos: somente `apps/web/cli/args.ts` e `apps/web/cli/args.test.ts`.
  E1/E2/E3 satisfeitos conforme registro anterior; **sem contract violation**.
- Permission denial: Bash composto `cd && sed && git diff` foi negado.
  Claude recuperou usando **Edit tool**, **sem aumento de permissão**.
- Natureza: **technical live proof, NÃO GOVERNADA**. Não demonstra work item,
  attempt, authority, Verifier ou review governada; não promove maturidade.

## Sessão documental

Worktree: `G:/anima/.worktrees/evolution-ux-v2`; branch `codex/evolution-ux-v2`.
HEAD inicial: `ac85e99fadbbae5aa45c34d5c5d4d5a39b047d38`.
HEAD final: commit que introduz este arquivo, recuperável por `git log -1 --`
este caminho. Mudança restrita a este complemento; backend, direção e maturidade
preservados. Sem transcript, credenciais ou `.tmp` versionados; WIP preservado.
Nenhuma nova inferência, login/logout, merge ou push nesta sessão.

Verificação: registry e avaliação do Proof Engine **2 suítes / 70 testes PASS**;
`git diff --check` **PASS**. Retomada: integração humana da branch;
nenhuma integração em dev autorizada nesta sessão.
