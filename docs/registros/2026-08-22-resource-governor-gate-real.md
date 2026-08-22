# Resource Governor como gate real de admissão

Data: 2026-08-22  
Tipo: desenvolvimento + prova por doubles

## Objetivo e estado Git

Promover o Resource Governor de advisory para autoridade real antes de iniciar
novo trabalho autônomo, sem implementar o resident local host.

- Branch: `dev`.
- HEAD inicial: `af240cb`.
- HEAD final: commit deste registro.
- `origin/dev` inicial: `af240cb`; `origin/main`: `99bec54`, intacta.
- Preservados: `.worktrees/`, `.claude/settings.local.json`, env local e evidências.

## Mudança

- `decideResourceAdmission` separa `permit`, `defer` e `fail_closed` no core.
- `readResourceAdmission` captura snapshot host-side e falha fechado em erro.
- `buildProjectBacklogCycleDeps` consulta a autoridade antes de cada nova volta;
  somente `permit` inicia Supervisor/Executor.
- Pressão moderada/alta para em `resource_pressure`; desconhecida também bloqueia.
- A semântica vale só para admissão: tentativa iniciada não é morta.

## Provas e invariantes

Cobertura determinística (pressão injetada, **não** alega pressão real do host):
host saudável executa; pressão antes da primeira volta produz zero Supervisor calls;
pressão depois de A impede B; local admitido continua sujeito ao governor; budget
externo permanece autoridade independente; busy/claim não duplica; erro do sensor
falha fechado; cancelamento impede nova volta; nova invocação após recuperação
volta a permitir; pressão não causa tight retry.

- Core focado: 2 suítes, **44/44**.
- Web pertinente (governor, driver, host-turn, rotas e Supervisor): 7 suítes,
  **141/141**.
- Typecheck: 5 workspaces verdes.
- `git diff --check`: limpo (somente avisos de normalização LF/CRLF).
- Prova integrada pequena: o driver real foi composto com gate mutável injetado;
  A executou e, após a pressão mudar, B não iniciou (`resource_pressure`, uma
  consulta por admissão, sem retry). Não foi feita prova viva com pressão física.

Sem schema, service role, daemon, polling de produção, PR, merge, deploy ou efeito
externo. O desfecho máximo permanece `review` e seleção/exclusão seguem server-side.

## Próximo ponto exato

Implementar resident local host V0 sobre gate real + ADR. Identidade padrão deve
ser user-scoped sob RLS; `service_role` permanece proibida como atalho.
