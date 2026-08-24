# Project Advisor Item Drill-down V0 — primeira E2E

- **Data / tipo:** 2026-08-24 — prova viva e correção determinística local.
- **Resultado:** `PROJECT_ADVISOR_ITEM_DRILLDOWN_V0_E2E = NOT_PROVEN`.
- **Branch / HEAD inicial:** `dev` / `719dd7c47448cbe2154d10671ce631f480c942f9`.
- **Pergunta única:** “O que aconteceu no item
  `d3890a38-fefe-45d5-b9b6-67cfaf75a1c8`, qual foi a última tentativa e que
  evidência governada existe para ele?”.

## Baseline e reconstrução segura

- Git: `dev=origin/dev=719dd7c`, `origin/main=99bec54`, diff rastreado vazio.
- Banco: `work_items=60`, `work_events=601`, `work_focus=2`,
  `ai_conversations=189`.
- O item existe no banco sob a identidade descartável da prova remota, em
  `review`, versão 1, com 16 eventos.
- Tentativa `6e9c7935…`: `result_submitted`; coder remoto `succeeded` em 10.272
  ms; um gate observado aprovado em 21.462 ms; Git observado no commit `1078d1f`,
  um arquivo/3 inserções; Verifier `verified`, 7 checks, 0 gaps/violações.
- Nenhuma falha foi registrada; nenhum payload bruto foi impresso ou persistido
  neste registro.

## Execução e ponto exato da falha

- `next dev` partiu de `.next` limpo; login e seis assets CSS/JS responderam 200.
- A UI enviou uma vez. O servidor registrou `POST /api/ai/chat 404` em 758 ms.
- Não houve `project-advisor provider request started`: a resolução user-scoped
  não encontrou o item porque a conta do navegador não é a identidade-fixture.
- Portanto não houve projeção, schema, parser, semantic validator ou resposta do
  Advisor, e a chamada OpenAI autorizada **não foi consumida**.
- A UI mostrou “Erro desconhecido”: o cliente espera JSON em erro HTTP, mas o
  ramo `not_found` devolvia texto puro.

## Correção e gates

- O 404 `not_found` agora usa JSON e explica que o item precisa ser visível para
  a conta atual. RLS, status 404, ausência de provider e mutation `none` foram
  preservados.
- Regressão focada da rota: 4/4.
- Typecheck: cinco workspaces verdes.
- Build Next: 56 páginas, com `next dev` encerrado.
- `git diff --check`: verde.

## Ausência de mutação e limites

- Pós-tentativa: banco continuou `60/601/2/189`; HEAD/origens e diff continuaram
  idênticos ao baseline.
- Nenhum retry, coder, workflow, foco, backlog, PR, merge ou deploy foi iniciado.
- `.worktrees/`, `.claude/settings.local.json` e `apps/web/.env.local` preservados.
- Próxima prova: usar um ID pertencente à conta autenticada da UI, ou autenticar
  explicitamente como a identidade descartável. Qualquer egress exige nova
  autorização.
