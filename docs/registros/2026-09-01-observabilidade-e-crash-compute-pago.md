# 2026-09-01 — Observabilidade e crash do compute pago

**Tipo:** desenvolvimento + auditoria adversarial. **Branch:** `dev`. **HEAD inicial:** `63b3de7`.
**HEAD funcional:** `16e1833`; o commit posterior contém este registro e a atualização do PRD.
`origin/main` observado em `99bec54` e não alterado.

## Objetivo e resultado

O contador concorrente deixou de usar `Infinity` como sentinela: zero observado e falha de leitura
agora são resultados distintos. `paid_node_count_unavailable` bloqueia antes de reserva,
`provision_requested` e provider, com retry saudável comprovado. A leitura do reconciler também
deixou de converter erro de lifecycle/versão em lista vazia observada e reporta indisponibilidade.

## Auditoria e provas

No domínio pago, negar autoridade em erro permanece corretamente fail-closed. As projeções de UI
não são write gates. A matriz existente, revalidada, cobre provider ausente/running/unreachable,
identidade persistida, autoridade expirada, `shutdown_requested`, stop/destroy parcial,
falha/timeout e replay idempotente. Não foi encontrada janela nova que justificasse arquitetura
adicional; as invariantes estão detalhadas no [Plano 005](../planos/005-provisionamento-on-demand-v1.md)
e na [arquitetura](../arquitetura/provisionamento-lease-seguranca.md).

- Focados web do recorte: `48/48`; typecheck web: PASS; `git diff --check`: limpo.
- Core completo: `1348/1348`; web completo: `1168/1168` (warnings React `act(...)`
  preexistentes); pgTAP relevante: `38/38`; typecheck: 5 workspaces; Next build: PASS;
  `git diff --check`: limpo.

## Efeitos externos e retomada

ZERO chamada RunPod real, ZERO compute pago, ZERO gasto e ZERO credencial real. Nenhum deploy,
PR, merge ou alteração em `main`. `.worktrees/`, `.claude/settings.local.json` e
`watch4-sensors.txt` preservados fora dos commits. Push autorizado somente a `origin/dev` após os
gates amplos. Próximo ponto: avaliação objetiva do preflight antes de uma microprova paga; a prova
continua bloqueada por autorização humana explícita separada, teto de custo e duração.
