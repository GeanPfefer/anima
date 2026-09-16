# Separação entre execução supervisionada e autonomia desacompanhada

- **Data/tipo:** 2026-09-05 — desenvolvimento e prova viva.
- **Branch/HEAD:** `dev` em `799950f` no início/fim; sem commit.
- **Objetivo:** permitir presença humana temporária sem zerar ou aumentar budgets
  unattended, preservando todas as demais guardas.

## Implementação e provas

- Lease user/item/proposal-scoped, TTL 60–3600s, RLS, replay por request id e revoke.
- `autonomous_work_budget_decision` preserva o contrafactual unattended e só muda
  a admissão efetiva durante lease válido.
- CLI inicia/renova e revoga supervisão; budget status mostra ambos os modos.
- PgTAP: human-supervised 12/12, work-budget 15/15, target-exclusivity 31/31.
- CLI 50/50; typecheck web e types verdes.
- UX-03 isolado não rodou por helper não montado pelo runner de arquivo único.

## Prova viva e barreira final

- Mesmo item `ce90eb14…` readmitido; usage 9/24h permaneceu intacto.
- Autoridade OpenAI separada `ac30917d…`, USD 0,25/30min, item/model-scoped.
- Attempt sandboxed `b164c11c…`: falhou antes do provider por permissão `.git`.
- Retry governado `1436d180…` fora do sandbox: worktree OK, OpenAI strong 5 calls,
  13.548 input + 4.362 output = 17.910 tokens, checkpoint persistido.
- Gate Jest falhou (exit 1); coder implementou `--task/--task-file`, divergindo do
  contrato `--message/--message-file`. Item `failed`, retryable false, sem Verifier.
- Supervisão e paid authority foram revogadas. Reserva USD 0,25 ficou registrada;
  nenhum novo retry, aceite, integração, merge, publicação, deploy ou origin/main.

## Retomada

Nova decisão humana é necessária para corrigir o diff/checkpoint ou replanejar o
item. Não repetir a attempt automaticamente.
