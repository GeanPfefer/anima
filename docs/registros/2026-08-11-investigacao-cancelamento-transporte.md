# 2026-08-11 — Investigação do cancelamento por transporte e nova prova UI

- **Tipo:** desenvolvimento e prova.
- **Branch:** `claude/integration-application-layer`.
- **HEAD inicial:** `4bfd60e`.
- **Commit de código:** `3c9ac70` — Desacople a execução do transporte HTTP.
- **Objetivo:** determinar por evidência se abandonar a conexão que iniciou
  `/supervisor-turn` deve cancelar uma tentativa já aprovada e repetir o fluxo
  completo pelo clique real em `Executar autonomamente`.

## Ratificação inicial

Branch e commits reportados confirmados: `4bfd60e` no HEAD, precedido por
`a41cd06`; `origin/main` permaneceu em `973ef46`. A working tree continha somente
os preservados não rastreados `.claude/settings.local.json` e `.worktrees/`.

## Investigação e decisão

O cancelamento anterior não era apenas uma hipótese de browser. A cadeia no
código era determinística:

1. `WorkProposalCard` iniciava um `fetch` longo para `/supervisor-turn`, sem um
   `AbortController` próprio;
2. a Route Handler, baseada no `Request` web, repassava `request.signal` ao
   Supervisor;
3. Supervisor, worktree, coder e processos filhos recebiam esse mesmo sinal;
4. no abort, o executor emitia terminal `cancelled`;
5. `record_commanded_work_terminal` projetava esse terminal como
   `work_cancelled`, `reason=execution_cancelled` e, indevidamente, `author=user`.

Isso divergia da intenção normativa do Marco 003 e do Plano 002: o trabalho deve
sobreviver a encerramento da aplicação/falha de rede, enquanto cancelamento
humano explícito possui fluxo separado e auditável (`work_control_requested`,
aplicado em checkpoint). Portanto `work_cancelled [user]` da tentativa anterior
não prova uma decisão humana; foi uma interrupção de transporte projetada como
terminal do executor e depois atribuída ao usuário pela RPC.

A menor correção desacopla, na rota, o lifetime da tentativa do
`request.signal`. Não cria daemon, fila, scheduler ou processo residente. A
durabilidade continua limitada ao processo da invocação: queda do Node/máquina
deixa tentativa aberta para lease, checkpoint e reconciliação; não inventa
cancelamento humano. O fluxo explícito de Pausar/Cancelar não mudou.

## Provas automatizadas

- teste focado da rota: **1 suite / 6 testes, PASS**;
- typecheck dos **5 workspaces: PASS**;
- web serial no HEAD da sessão: **34 suites / 366 testes, PASS** (os 365
  reportados no `4bfd60e` mais o novo caso de desacoplamento);
- o novo teste aborta o sinal do request depois de chamar a rota e comprova que
  o sinal entregue ao Supervisor é distinto e permanece ativo.

Avisos não regressivos preservados: mensagens React `act(...)` em testes de
cartão e `console.warn` deliberado no teste do limite de ferramentas; nenhum gate
falhou.

## Prova viva pela UI real

Conta local descartável `cancel-proof-1786481388168@test.invalid`
(`504e7045-abf9-4538-9b72-5fadd7a3a2a5`), criada pela tela de cadastro,
allowlistada e preservada como evidência. A habilitação temporária dessa conta
em `ANIMA_DEVELOPMENT_CHAT_USER_IDS` foi removida ao final.

Fluxo realizado sem `/start`, Bearer manual ou `Iniciar execução manual`:

`Dev do Anima` → banner → mensagem de programação → planejador OpenAI →
item novo `b6ab5eeb-f8dd-44d1-88da-58b0e2a8a155` (`programming/low`, um arquivo,
worktree, gate Jest) → Aprovar → `approved` → clique real em
`Executar autonomamente` → routing → claim → attempt
`e6a828fe-0133-4ddd-9480-260944a3ccda` → worktree isolada → coder.

Com a conexão mantida estável, o terminal foi **`execution_failed`**, não
`work_cancelled`: `[ollama_read_round_limit] o modelo esgotou as 3 rodadas de
leitura sem propor edições`. Nenhum checkpoint de edição foi produzido e o gate
não rodou. Assim, a prova não alcançou `review` e nada foi forçado.

O diagnóstico permanece deliberadamente composto: o modelo local, o protocolo
que exige leitura antes da edição, o orçamento fixo de três rodadas e a tarefa
interagem; esta prova não isola qual fator domina. Nenhum deles foi alterado para
obter verde.

## Invariantes e efeitos externos

- repositório original preservado; worktree descartável limpa ao terminal;
- `.claude/settings.local.json`, `.worktrees/` e `origin/main` preservados;
- nenhum `db reset`, push, PR, merge, deploy, publicação, aceite de resultado ou
  integração automática;
- item, eventos e conta descartável preservados como evidência;
- Fase G permanece em andamento: a prova completa ainda não chegou a `review`.

## Próximo ponto exato

Investigar `ollama_read_round_limit` separando protocolo, três rodadas, prompt,
natureza da tarefa e capacidade do modelo antes de alterar qualquer contrato.
A autoria histórica de terminais `cancelled` do executor continua sendo uma
imprecisão da RPC a tratar por migration própria se esse terminal permanecer
alcançável por uma causa não humana; o caminho de transporte que a expôs foi
fechado nesta sessão.
