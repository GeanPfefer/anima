# SDC-10 — diagnóstico de defeito de candidato (candidate recovery)

Registro append-only. Data: 2026-10-05. Branch: `dev` (`44db504`). Não houve edição do candidate nem de código do ANIMA.

## Item e attempt

- Work item `abcad207-181f-418a-863e-13bdc047e8d5` (SDC-10, Investigation Sessions V0 — núcleo), estado `failed`, proposta v2.
- Attempt `373ad6fe-c8a1-47a7-b6ca-8b3f34f61758`, backend `codex-cli:default`, evidência do host do coder: `succeeded` (522 s).
- Base `44db5040986c56d9b5dc7f6f3f6e3b97029db9df`; candidato `b0cb4bd7e5fd77fdff72e6b4ab4dbfbf6f87f19f`
  (branch `anima-work/373ad6fe-c8a1-47a7-b6ca-8b3f34f61758`), filho direto da base, exatamente os 12 arquivos do escopo aprovado.
- Orçamento 1/1 consumido; falha `retryable=false` (`[gate_failed]`).

## Falha observada e diagnóstico completo (gates rodados SEM fail-fast em worktree descartável)

- Gate que parou a attempt: `Typecheck do apps/web` (`npm run typecheck --workspace=apps/web`), exit 2 (gate 2 de 7; os gates 3–7 não rodaram).
- Matriz independente: 1 PASS, 2 FAIL, 3 PASS, 4 PASS, 5 PASS, 6 BLOCKED_BY D1, 7 BLOCKED_BY D1. Suíte completa do `packages/core`: 115 suites / 2.506 testes PASS.
  Com o diagnóstico de tipos do ts-jest desligado (só para ver o que o bloqueio escondia): 38 testes, 37 PASS e 1 FAIL (D2).
- Diagnóstico arquitetural: nenhum P0; arquitetura do SDC-10 sustentada; recovery tipo A (correção local nos mesmos 12 arquivos).

### Defeitos bloqueantes (ENTRAM na recovery)

- D1 — TS2741 em `apps/web/lib/work-orchestration/investigation-executor.ts` (130,59): `Record<string, string>` passado onde `NodeJS.ProcessEnv`
  é exigido (o Next declara `NODE_ENV` obrigatório). Causa: o adapter novo chama o runner direto com o resultado de `buildCodexCliEnvironment`,
  enquanto o caminho nativo existente já adapta o tipo (`env as NodeJS.ProcessEnv`, native-cli-coder.ts). Correção mínima: a mesma adaptação de
  tipo no boundary da chamada. NÃO adicionar `NODE_ENV` ao ambiente e NÃO ampliar a allowlist.
- D2 — `apps/web/lib/work-orchestration/investigation-executor.test.ts` (54): o teste espera só `PATH`+`CODEX_HOME`, mas `buildCodexCliEnvironment`
  injeta canonicamente `NO_COLOR=1`. Correção mínima: alinhar a expectativa ao contrato real, mantendo a prova explícita de que `OPENAI_API_KEY` e
  `SUPABASE_SERVICE_ROLE_KEY` NÃO são propagadas.

### Observações registradas como dívida (NÃO entram na recovery; sem mudança de código por causa delas)

D4 falso positivo potencial de refs `anima-work/*` concorrentes; D5 crescimento do baseline `prohibitedRefsBefore`; D6 severity/violation do parecer;
D7 convenção de id do executor; D8 fiação ausente (esperada, SDC-11); D9 arquivos >150 KB na resolução de linhas; D10 tratamento de falha de cleanup;
D11 crescimento do grafo de imports. Motivo: não bloquearam a prova atual e ampliar a correction reduziria a comparabilidade com o candidate diagnosticado.

## Ato

`anima work recover-candidate abcad207-… --diagnosis <json>` (autorização `production_candidate_incorrect_v1`, correções `type_error` e
`test_failure`, `additionalAttempts=1`). O comando NÃO aprova, classifica nem executa; o successor nasce `proposed`.
