# Prova viva de superfície pendente pela janela de orçamento

Data: 2026-08-21
Tipo: prova bloqueada legitimamente por governança

## Objetivo e estado Git

O único recorte autorizado era repetir a prova viva completa pela superfície
real:

`/api/ai/chat → planner → proposta → aprovação → supervisor-turn → worktree → qwen3-coder:latest → Next typegen → typecheck web → evidências host-observed → Verifier → review`.

- Branch: `dev`.
- HEAD inicial: `589686273a9eafa1da26b32a279f80148f303f83`.
- `origin/dev`: `589686273a9eafa1da26b32a279f80148f303f83`.
- `origin/main`: `99bec54e3ab42bfe882a8686cd1385d8058b916e`, intacta.
- Working tree inicial: apenas `.worktrees/` e `.claude/settings.local.json`
  não rastreados, ambos preservados.

## Consulta canônica antes de qualquer aprovação

Foi obtida uma sessão canônica do usuário de desenvolvimento já autorizado pelo
GoTrue (magic link administrativo + `verify`, sem mudar senha, usuário ou dados)
e chamada a RPC pública `autonomous_work_budget_status` com o work item de prova
anterior. Identificadores operacionais e credenciais não são registrados aqui.

Resultado observado:

- `admitted=false`;
- `reason=user_attempt_budget_exhausted`;
- `usage.itemAttempts24Hours=0`;
- `usage.userAttempts24Hours=6`;
- `remainingUserAttempts=0`;
- limite efetivo do item: 3 tentativas;
- `usage.userRuntimeSeconds24Hours=354`;
- `remainingRuntimeSeconds24Hours=6846` (teto 7200s/24h);
- `usage.autonomousRuntimeSeconds60Minutes=0`;
- `remainingAutonomousRuntimeSeconds60Minutes=2700` (reserva 45min/60min);
- política: `autonomous-work-budget-v1`.

A única janela impeditiva é o teto global de **6 tentativas do usuário em 24
horas**. As seis `execution_started` contadas ocorreram em 2026-08-21 entre
10:25:00 e 13:44:25 (`-03:00`). A primeira vaga surge depois de
`2026-08-22 10:25:00.408950 -03:00`, sujeita à avaliação estrita da janela no
instante da nova consulta.

## Decisão e efeitos

Stop condition B aplicada. Nenhuma proposta nova foi criada, nenhum item foi
aprovado, nenhum `supervisor-turn` foi iniciado e nenhum coder/gate/worktree novo
foi executado. Não houve bypass, edição de timestamps/dados, usuário alternativo,
mudança dos tetos, espera em background, merge, PR, deploy ou alteração de
`origin/main`.

O comportamento temporal já está coberto pelos recortes imediatamente anteriores:
bloqueio pré-tentativa é re-admitido por `readmit_budget_blocked_work`; interrupção
em tentativa é re-admitida e retomada do checkpoint por
`readmit_budget_interrupted_work` + `budget_interruption_resumption_source`. Não
foi identificado bug causal pendente nem valor em criar outro harness descartável:
o caminho runtime `qwen3-coder → worktree → Next typegen → typecheck web` já tem
prova viva direta; o único impedimento atual é a admissão persistida.

## Próximo ponto exato de retomada

Depois de `2026-08-22 10:25:00 -03:00`, consultar novamente
`autonomous_work_budget_status` para o usuário real. Somente se `admitted=true`,
criar pela `/api/ai/chat` uma proposta nova com exatamente um arquivo descartável
em `apps/web`, conferir fail-closed todo o contrato persistido antes de aprovar e
então executar uma única volta real até `review`. Não versionar no `dev` o arquivo
produzido pela branch do executor.

**live proof pending budget window**
