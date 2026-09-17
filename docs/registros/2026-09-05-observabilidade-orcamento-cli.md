# Observabilidade do orçamento autônomo na CLI

- **Data/tipo:** 2026-09-05 — desenvolvimento e prova.
- **Objetivo:** tornar o budget autônomo observável pela CLI sem modificar admissão.
- **Branch/HEAD inicial e final:** `dev`, `799950f` (sem commit nesta sessão).

## Mudanças

- `anima budget status <id> [--json]` usa identidade residente e a RPC user-scoped.
- `autonomous_work_budget_status` foi enriquecida de modo read-only; a decisão
  continua vindo de `private.autonomous_work_budget_decision`.
- Próximas expirações usam apenas `execution_started.created_at`; a liberação por
  contagem aponta o N-ésimo vencimento necessário. Nenhuma previsão de runtime é
  inventada.

## Provas e estado vivo

- CLI focada: 3 suítes, 49/49.
- Typecheck `apps/web`: verde; `git diff --check`: verde.
- pgTAP `work_budget_observability`: 9/9, transacional com rollback.
- Consulta real: `ce90eb14-810d-4125-833c-4c7b35666855` permaneceu `blocked`,
  proposal v2, `admitted=false`, `reason=user_attempt_budget_exhausted`, 9 attempts
  de usuário/24h e liberação calculada em `2026-09-06T07:05:05.8296+00:00`.
- A migration `20260905000003` foi aplicada somente ao Supabase local para a prova.

## Limites, regressões observadas e invariantes

- As regressões preexistentes `work_budget_local_vs_external` (4/12 falhas) e
  `budget_blocked_human_resume` (falha de replay/subquery) expõem conflito entre a
  policy V2 e a redefinição V1 recente. Não foram corrigidas: fazê-lo alteraria
  admissão e excederia o escopo read-only.
- Nenhum OpenAI/compute pago, push, merge, deploy, service role na CLI, attempt,
  recovery, readmission ou alteração do Work Item foi realizado.
- Caminhos preexistentes não rastreados (`.claude/settings.local.json`,
  `.worktrees/`, `watch4-sensors.txt`) foram preservados.

## Próximo ponto

Revisar o diff e, em tarefa separada e explicitamente autorizada, reconciliar a
policy V2 local/external com human recovery antes de tratar suas regressões.
