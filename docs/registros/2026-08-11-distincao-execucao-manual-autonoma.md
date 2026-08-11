# Sessão — distinção entre execução manual e autônoma

- **Data:** 2026-08-11
- **Tipo:** desenvolvimento e prova
- **Objetivo:** registrar a prova viva, investigar `/start` versus Supervisor e
  corrigir somente gaps dentro do contrato ratificado.
- **Branch:** `claude/integration-application-layer`
- **HEAD inicial:** `44785fb`
- **HEAD funcional ao encerrar:** `47d528b`

## Commits

- `bec0309` — Registre a prova do início manual.
- `47d528b` — Esclareça os modos de execução.
- O commit deste arquivo apenas persiste o fechamento append-only da sessão.

## Diagnóstico e decisão

`POST /api/work-orchestration/start` chama `start_work`, registra
`work_started` com autoria humana e abre o ciclo manual original. Ele não é a
fronteira de claim/attempt. O caminho autônomo é separado: o botão **Executar
autonomamente** chama `/supervisor-turn`, que seleciona trabalho elegível e abre
claim/attempt pelas fronteiras atômicas ratificadas.

Logo, o item manual `in_progress` sem attempt não demonstra bug de criação de
tentativa. `attempt_missing → requires_human` é a resposta fail-closed correta
quando o Supervisor é chamado posteriormente: ele não pode inventar nem assumir
uma execução humana. A lacuna confirmada era de UX/orientação, não de domínio ou
fiação. A interface agora explica a distinção antes do início e orienta o
fechamento pelo registro de resultado durante o ciclo manual. Nenhuma RPC ou
transição de estado foi alterada.

## Provas e gates

- Reprodução automatizada adicionada antes da correção: 2 testes falharam pela
  ausência das orientações esperadas.
- `WorkProposalCard.test.tsx`: 34/34 após a correção.
- Web: 34 suítes, 362 testes, todos passando.
- Core: 31 suítes, 687 testes, todos passando.
- Mobile: 4 suítes, 33 testes, todos passando.
- Supabase: 7 testes passando; 2 ignorados conforme configuração existente.
- Typecheck de mobile, core, Supabase e types passou.
- Typecheck web pelo script raiz encontrou `EPERM` ao tentar escrever
  `apps/web/tsconfig.tsbuildinfo` sob o usuário isolado; repetido com
  `--incremental false`, passou. É limitação de ambiente/cache, não regressão.
- `git diff --check`: passou.

Ruído conhecido: testes React existentes ainda escrevem avisos de atualizações
fora de `act(...)`; as suítes passam e esta sessão não introduziu o padrão.

## Segurança e efeitos externos

- `G:/anima-local-test` permaneceu detached em `44785fb` e não foi modificada.
- Nenhuma worktree paralela foi alterada.
- Nenhum banco foi resetado e nenhuma migration foi criada/aplicada.
- Nenhum push, PR, review request, merge, deploy, publicação externa,
  `origin/main`, estado `integrated` ou integração real foi realizado.
- Os não rastreados preexistentes `.claude/settings.local.json` e `.worktrees/`
  foram preservados.

## Varredura e próximo ponto exato

Plano 002, ADRs, PRD e backlog confirmam que o caminho autônomo já possui botão
separado e fronteiras de seleção, claim, attempt, worktree, coder, testes e
review. O próximo passo seguro é uma prova viva nova, sem reutilizar o item
manual: criar/aprovar uma proposta **elegível pelo contrato vigente de baixo
impacto**, acionar **Executar autonomamente** diretamente em `approved` e
verificar a cadeia persistida `claim → attempt → worktree → coder → testes →
review`. Ampliar a ponte automática para `impact = structural` não é consequência
ratificada e permanece `BLOCKED_BY_HUMAN_DECISION`; não foi feito silenciosamente.

