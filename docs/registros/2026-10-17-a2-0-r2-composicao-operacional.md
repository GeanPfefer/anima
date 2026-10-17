# A2-0 / Recorte 2 — composição operacional do aceite sob mandato — 2026-10-17

Append-only. Tipo: desenvolvimento + prova em banco descartável. Base `921634d5` (= `origin/dev`). **Sem commit, sem efeito no residente.**
Complementa [`2026-10-17-a2-0-r2-aceite-sob-mandato.md`](2026-10-17-a2-0-r2-aceite-sob-mandato.md) e [`acceptance-mandate-v1.md`](../arquitetura/acceptance-mandate-v1.md).

## O que foi composto (reuso antes de criar)

`acceptUnderMandate`, `collectCandidateIntegrity` e o sink `mandatedAcceptance` do Trusted System Writer já existiam. Faltava ligá-los:
`trusted-git.ts` (Git confiável), `mandated-acceptance-run.ts` (leitor do ledger + CLI testável) e `cli/accept-mandated.ts` (entrada fina).
`collectCandidateIntegrity` ganhou a leitura dos pais do PRÓPRIO objeto commit, que precisa coincidir com o grafo (`git_graph_inconsistent`).

## Provas

- Jest (Git real em repositórios temporários): `trusted-git.test.ts` 8, `mandated-acceptance-run.test.ts` 46, `acceptance-mandate.test.ts` 47 — adulteração de GIT_DIR/OBJECT_DIRECTORY/ALTERNATES/REPLACE/CONFIG,
  `refs/replace`, `.git/shallow`, config hostil (`fsmonitor`, `hooksPath`, `diff.external` sem execução), link simbólico, arquivo extra, merge/pai errado, troca de candidato,
  mandato ausente/expirado/futuro/revogado/consumido, ação/política/base/escopo divergentes, resultado divergente, parecer v5/lacuna/violação/rejeitado/inconclusivo, sem contexto, writer
  indisponível (antes de ler) e indisponível na RPC, replay, recusa do banco. Sinks indevidos do writer são armadilhas (qualquer chamada falha o teste).
- Mutações (5/5 detectadas): ambiente do pai repassado, sem `--git-dir`, sem conferência dos pais do objeto, guarda do ambiente do runner, `writer.available` ignorado.
- E2E em banco descartável (migrations R2 aplicadas como `postgres`, não-superuser) com Git REAL, ledger/RPC REAIS e `createTrustedSystemWriter` real: **11/11 PASS**
  (S1 aceite `system`+`human_mandate`, 1 evento, mandato consumido, commit real no relatório; S2 reexecução recusada; S3 revogado; S4 leitor enganado ⇒ o BANCO recusa `mandate_revoked`;
  S5 arquivo extra; S6 writer indisponível; S7 residente sem EXECUTE; S8 `refs/replace` plantado). Ambiente do processo continha `GIT_DIR`/`GIT_OBJECT_DIRECTORY` hostis.
- pgTAP R2 175/175 (migrations inalteradas); catálogo +13 funções, 0 alteradas.
- Web: `tsc` limpo; 192/195 suítes, 3222 testes; falhas = as 3 preexistentes (backlog-cycle, project-tools, project-context-builder), idênticas sem o R2.
- Sonda REAL somente-leitura no repositório principal: o Git confiável (`G:/anima/.git`) enxerga o candidato A2R1 `f546ee69…` e produz relatório íntegro
  (pai único = `2888118d`, 1 commit, 0 merges, 2 adições). Nada foi aceito, escrito ou criado.

## Bloqueios restantes para a prova viva (nenhum de código)

1. Backup restic novo e aplicação, uma a uma, de `20261017000000` e `20261017000001` no residente (autorização própria).
2. Provisionar o grantor (usuário GoTrue `role=anima_mandate_grantor`, registro em `private.acceptance_mandate_grantors` pelo dono do banco) e definir o repositório confiável (`ANIMA_TRUSTED_REPO_ROOT`).
3. Launcher/auditor da prova viva para um item NOVO: mandato concedido ANTES da attempt, attempt agendada, depois `accept-mandated` no processo do operador (não do runner).
4. Regenerar `database.ts` do residente após as migrations (typegen) e reexecutar a suíte.
