# 2026-08-31 — Teardown pago independente do workload

**Tipo:** desenvolvimento + prova adversarial. **Branch:** `dev`. **HEAD inicial:** `64ca767`.
**HEAD funcional:** `e392788`; o commit imediatamente posterior contém somente este registro.
`origin/main` observado em `99bec54` e não alterado.

## Objetivo e resultado

Fechar a janela em que cancelamento/deadline/shutdown do workload podia abortar a própria
tentativa de teardown de um recurso pago conhecido. O cleanup imediato e o reconciler agora
usam signal próprio e timeout bounded. Providers que expõem `destroy` só permitem
`shutdown_confirmed → offline` depois de `stop + destroy`; falha ou timeout permanece como
`shutdown_failed`/lease reconciliável. Fontes canônicas atualizadas no [Plano 005](../planos/005-provisionamento-on-demand-v1.md)
e na [arquitetura](../arquitetura/provisionamento-lease-seguranca.md).

## Decisões e bugs corrigidos

- `finish()`, health-failure, falha da evidência `health_confirmed` e compensação após
  `provider_identified` usam o mesmo helper de teardown seguro.
- O reconciler deixou de tratar `destroy` como best-effort quando ele é necessário para eliminar
  o recurso; nenhuma falha fabrica `offline`.
- A documentação oficial do RunPod confirma que `stop` libera a GPU, mas mantém o Pod e pode
  manter cobrança de storage. A política on-demand é convergir para ausência, sem capacidade
  aquecida implícita.
- Nenhum TTL provider-side foi presumido. Watchdog continua best-effort; reconciler durável é a
  segunda linha de defesa.

## Commits

- `e392788` — Garanta teardown mesmo após cancelamento.
- Commit imediatamente posterior — registre esta sessão append-only.

## Provas e gates

- Focados web: `75/75` (teardown bounded, Resident, RunPod, reconciler e wiring).
- Core completo: `1348/1348`.
- Web completo: `1165/1165`; warnings React `act(...)` preexistentes, sem falha nova.
- pgTAP relevante: `38/38` em 2 arquivos.
- Typecheck: 5 workspaces. Next build: PASS. `git diff --check`: limpo.

## Efeitos externos, invariantes e retomada

ZERO chamada ao RunPod real, ZERO compute pago, ZERO gasto e ZERO credencial tocada. Nenhum
deploy, PR, merge ou alteração em `main`. Push permitido somente para `origin/dev` após commit.
`.worktrees/`, `.claude/settings.local.json` e `watch4-sensors.txt` foram preservados e excluídos
do commit.

Os recortes de `provider_identified`, falso `offline` no `confirm_offline` e leitura fail-closed
da contagem paga já estavam fechados em `dev` antes desta sessão e não foram refeitos. Próxima
retomada segura: continuar a auditoria adversarial das janelas restantes entre reserva, create,
readiness, execução e confirmação de ausência; primeira prova paga continua bloqueada por
autorização humana explícita separada.
