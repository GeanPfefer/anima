# Local Planner — compatibilidade Hermes/JSON de tool call

**Data:** 2026-09-29

**Tipo:** desenvolvimento e prova isolada

**Branch:** `dev`
**HEAD inicial:** `8fc65b7` (`origin/dev` igual; `origin/main=99bec54`)

## Objetivo

Reconhecer no planner local a mesma chamada de ferramenta quando o
`qwen2.5-coder` a representa como objeto textual Hermes/JSON, preservando o
formato textual legado e todas as barreiras posteriores. A unidade foi executada
sem materializar [TPC-01](../planos/008-primeira-prova-trusted-produce-change-backlog.md).

## Causa confirmada

`LocalOllamaProjectWorkPlanner` já tinha fallback para chamadas textuais, mas
`parseTextualToolCalls` só reconhecia `<function=...>...</function>`. A resposta
Hermes válida chegava em `message.content`, com `tool_calls=[]`, era tratada como
conversa sem progresso e terminava em `planning_failed` após três rodadas.

## Mudanças

- o parser aceita exatamente um objeto `{name, arguments}`, puro ou envolvido por
  uma fence `json` completa;
- `name` precisa ser string e pertencer ao catálogo conhecido da rodada;
- `arguments` precisa ser objeto não nulo e não-array;
- o objeto raiz só pode conter as duas chaves contratuais;
- o parser não extrai JSON de prosa, fence incompleta/com conteúdo extra, arrays,
  múltiplos objetos ou payloads ambíguos;
- o parser legado foi preservado;
- `executeProjectTool` e `parseProposal` continuam sendo as validações posteriores
  autoritativas dos argumentos e da proposta.

Não havia helper web reutilizável com esse contrato. O parser fenced do advisor
extrai o primeiro JSON de prosa e por isso seria permissivo demais; o parser do
runner Python deliberadamente não promove conteúdo textual a tool call.

## Provas e gates

- focal do parser/planner: 21/21 PASS;
- oito suítes relacionadas ao planner/tool protocol: 116/116 PASS;
- `npm.cmd run typecheck --workspace=apps/web`: PASS;
- fixture exata observada (`project_search`, path `apps/web/cli`, query
  `work approve`): interpretada e encaminhada uma vez;
- submit Hermes incompatível com `parseProposal`: recusado fail-closed;
- consulta read-only ao banco após a fronteira trusted: zero work items não
  cancelados;
- projeção canônica read-only: 33 elegíveis, 0 positivas, 8 negativas, 23
  inconclusivas e 2 não atribuíveis; zero lineages alteradas.

## Invariantes e efeitos externos

- `apps/web/cli/args.ts` e `args.test.ts` não foram tocados;
- prompt, rounds, `noProgress`, modelo, timeout/contexto, classificação,
  materializer e provenance não foram alterados;
- TPC-01 não foi materializado; attempts = 0; paid authority = 0;
- chamadas OpenAI/Ollama = 0; custo = US$0;
- nenhum banco, work item, approval, authority, reservation ou attempt foi criado;
- `origin/main` permaneceu em `99bec54`.

## Próximo ponto exato

Depois de integrar esta correção em `dev`, é seguro fazer em unidade separada UMA
nova materialização canônica de TPC-01 com `qwen2.5-coder:14b`, mantendo a parada
antes de qualquer execução conforme o plano e a autorização humana aplicável.
