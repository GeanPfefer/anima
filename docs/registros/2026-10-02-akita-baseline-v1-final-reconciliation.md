# 2026-10-02 — Evolution UX V2: reconciliação final Akita Baseline V1

Tipo: desenvolvimento e complemento de prova relatada pelo humano.
Objetivo: representar ambos os executores reais sem promover maturidade.
Branch/worktree: `codex/evolution-ux-v2`, `G:/anima/.worktrees/evolution-ux-v2`.
HEAD inicial: `6b1c926b5e22836ca4215f9be04cec6ec99248b1`.
Base final: `cd73276b1e18eda70f5a65338d744cca9634addc`.
HEAD após rebase: `367b1ad`; HEAD final é o commit que introduz este registro,
recuperável por `git log -1 -- docs/registros/2026-10-02-akita-baseline-v1-final-reconciliation.md`.

## Complemento append-only da prova Codex

O [registro anterior](2026-10-02-akita-baseline-v1-codex-live-proof.md) permanece
intacto. O relato humano posterior agora informa a base exata da prova TPC-01:
`f94bc5a2dc8076be40471d5f7810d81518cb8bfa`. Corrige o campo anteriormente não
fornecido; não é nova execução. Modelo gpt-6.1-sol, reasoning low, coding ~47,9 s,
prova total ~70,6 s, CLI do preflight 0.159.0-alpha.12.1, auth ChatGPT/assinatura,
CoderTaskSpec completa (payload literal indisponível), args.ts/args.test.ts,
E1/E2/E3 e gate host PASS, sem contract violation, sem integração/push do resultado.
A prova continua técnica NÃO GOVERNADA. O estado anterior de Claude NEXT no
registro histórico é sucedido pela [prova Claude](2026-10-02-akita-baseline-v1-claude-live-proof.md).
Mesma base, prompt/spec, aceites e gate das duas provas, conforme relato humano.

## Resultado e limites

Codex/Claude: WRAP, CURRENT FOCUS, integrated, baseline técnico do executor
atingido, live technical proof PASS, governed proof ainda não demonstrada.
Ambos projected preservados, sem regra específica no Proof Engine: not_evaluated,
derivedMaturity=null. Evidência limitada em history; sem novos proofRefs canônicos,
work item, attempt, authority, Verifier ou review governada. Categoria composta
external-harness integrada quanto aos adapters; composição com ai-memory pendente.
ai-memory NEXT; self-development avançado posterior. Akita composto não concluído.
Ollama/DSH/Qwen/RunPod experimentais/estacionados e provas históricas preservados.

Arquivos: registry e testes de registry/avaliação; testes Evolution; PRD (somente
bloco Akita/Evolution), Plano 009, arquitetura dos backends, novo registro Claude
e este registro. Implementações dos dois backends e mecânica comum idênticas a dev.
Um conflito no rebase: documentação codex-cli-coder-backend; preservados contrato
Claude e distinção técnica/governada Codex. Nenhum conflito pendente. PRD de dev
não mudou neste incremento; nenhum WIP externo foi absorvido. `.tmp` preservado,
não versionado. Origin/main `99bec54e3ab42bfe882a8686cd1385d8058b916e` preservada.

Gates finais: core relevante 8 suítes / 234 PASS; Evolution UI e read models
4 suítes / 70 PASS; typecheck de todos os workspaces PASS; git diff --check PASS.
Build PASS (68 páginas). Falhas corrigidas nesta sessão: expectativas
antigas de contagem/candidatura na UI e ordem cronológica da nova entrada de
history (validador detectou; entrada movida após a histórica). Gates repetidos
verdes. Warning preexistente de múltiplos lockfiles/tracing root no build;
nenhum script lint na raiz.
Nenhuma inferência, prova nova, login/logout, banco, provider call, push, merge em
dev/main ou integração dos resultados TPC-01 nesta sessão. Limitação documental:
payload literal das specs e hash dos resultados não fornecidos; duração/modelo
Claude não informados. Não inventar dados ausentes.

Retomada: revisão/integração humana desta branch; preservar WIP externo na
integração. Prova governada exige mandato separado. Nenhum merge em dev autorizado.
