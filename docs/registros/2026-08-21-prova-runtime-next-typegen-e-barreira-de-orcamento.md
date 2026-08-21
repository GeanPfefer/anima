# Prova runtime Next do typegen em worktree e barreira de orçamento

Data: 2026-08-21

## Contexto

A prova anterior pela superfície real de produto:

`/api/ai/chat → proposta → aprovação → supervisor-turn → worktree`

revelou uma falha de produção depois de o coder concluir a edição e antes dos gates:

`Falha ao preparar o ambiente de validacao: Cannot read properties of undefined (reading 'resolve').`

A tentativa afetada foi:

- work item: `820115be-22ab-4517-b7c9-e862be55a072`
- attempt: `d854ba6d-0d87-4154-bd80-a63594b2da1a`
- backend: `ollama:qwen3-coder:latest`
- evidência host-side do coder: `outcome=succeeded`
- duração observada do coder: `26088 ms`

O defeito estava em `prepareAnimaValidation`, que resolvia o CLI do Next por:

`createRequire(...).resolve('next/dist/bin/next')`

Embora essa resolução funcione em Node puro, ela falhou no runtime empacotado do Next usado pela rota real.

## Correção

Commit local de correção:

`3d6fb9d2eec983e7f75649bff905eaab1253ab32`

Mudança causal:

- remove a dependência de `createRequire` nessa fronteira;
- resolve explicitamente o CLI em:
  `apps/web/node_modules/next/dist/bin/next`
  a partir do `webRoot` da própria worktree;
- falha explicitamente se o CLI não existir;
- adiciona regressões focadas para resolução existente e workspace sem Next.

Validações determinísticas antes da prova viva:

- `executor-selection.test.ts`: 22/22 PASS
- `npm run typecheck --workspace=apps/web`: PASS
- `git diff --check`: PASS

## Nova tentativa pela superfície e orçamento persistido

Uma nova proposta real foi criada pela superfície `/api/ai/chat`:

- work item: `1a323a97-bae5-40b0-8352-6cfc1f03c6bb`
- alvo: `project:anima`
- executor: `worktree`
- backend: `ollama`
- modelo: `qwen3-coder:latest`
- gate: `npm run typecheck --workspace=apps/web`
- escopo incluído:
  `apps/web/lib/work-orchestration/__surface-typegen-proof-v2.ts`

A proposta foi aprovada, porém o Supervisor não abriu uma tentativa.

Resultado persistido:

- outcome: `budget_interrupted`
- estado final: `blocked`
- `attemptId`: ausente
- razão: `user_attempt_budget_exhausted`

O orçamento V0 reconstruído pelo banco mostrou:

- `itemAttempts24Hours = 0` para o item novo
- `userAttempts24Hours = 6`
- teto global = `6 tentativas / 24h`
- `remainingUserAttempts = 0`
- runtime usado em 24h = `354 s`
- teto de runtime em 24h = `7200 s`
- runtime autônomo em 60 min = `27 s`
- reserva protegida = `2700 s`

Portanto, a recusa foi exclusivamente pelo teto global de tentativas. Não foi pressão de máquina, tempo de execução ou falha do executor.

Nenhum bypass, alteração manual do banco ou relaxamento do orçamento foi feito.

## Achado separado: checkpoint humano não respondível do orçamento

`block_work_on_budget` materializou:

- `input_requested`
- `work_blocked`

com razão:

`persistent_inability_after_limits`

e explicação:

`O orçamento autônomo foi atingido; continuar exige decisão humana.`

Porém o evento real não contém:

- `options`
- `attempt_id`
- `checkpoint_reference`
- `executor_signal`

A projeção `projectPendingWorkDecision` exige esses elementos, incluindo pelo menos duas opções válidas, e portanto ignora esse evento.

Além disso, `respond_to_work_decision` só aceita eventos que possuam `executor_signal` e uma opção previamente apresentada.

Conclusão estreita:

o orçamento V0 está correto ao bloquear a execução quando `userAttempts24Hours >= 6`, mas a mensagem "continuar exige decisão humana" não corresponde hoje a uma decisão efetivamente respondível pela superfície existente.

Esse é um defeito/coerência de UX/contrato separado. Ele não foi corrigido neste recorte.

## Prova viva direta no runtime real do Next

Como o Supervisor estava legitimamente impedido pelo orçamento persistido, a correção foi provada sem adulterar essa governança.

Foi criada temporariamente uma rota local não versionada no App Router apenas para executar, dentro do mesmo Next dev server, a rota real de seleção e o executor real.

A rota temporária foi removida após a prova.

Fluxo exercitado:

`Next runtime`
→ `resolveExecutorRoute`
→ `WorktreeExecutorAdapter`
→ `ollama:qwen3-coder:latest`
→ worktree real
→ links de `node_modules`
→ `prepareAnimaValidation`
→ Next typegen
→ `npm run typecheck --workspace=apps/web`
→ commit local da worktree
→ result

Base autorizada:

`3d6fb9d2eec983e7f75649bff905eaab1253ab32`

Attempt da prova:

`c9ae3d9e-fd44-41f8-a24d-410b7a76705a`

Work item efêmero da prova:

`03165403-da5c-4c06-b8c4-b8f1530ddb49`

Branch produzida:

`anima-work/c9ae3d9e-fd44-41f8-a24d-410b7a76705a`

Commit produzido pelo executor:

`55dabb66eb498c3ea43d4788bd06ff37c331a784`

Arquivo único alterado:

`apps/web/lib/work-orchestration/__runtime-next-proof.ts`

Conteúdo observado na branch:

`export const runtimeNextProof = "next-runtime-proof-1787332363559";`

Evidência do coder:

- backend: `ollama:qwen3-coder:latest`
- outcome: `succeeded`
- duração host-observed: `24584 ms`

Gate observado:

- label: `Typecheck do workspace web`
- comando efetivo:
  `npm.cmd run typecheck --workspace=apps/web`
- exit code: `0`
- duração: `6366 ms`
- timeout: `false`
- cancelled: `false`

Terminal:

- `kind=result`
- validation outcome: `passed`
- worktree status: `succeeded`
- changed files: 1
- insertions: 1
- deletions: 0
- publication state: `local_only`

Invariantes confirmados:

- branch nasceu do SHA corrigido `3d6fb9d`;
- coder real foi executado;
- gate real foi observado pelo host;
- gate terminou com exit code 0;
- escopo observado contém exatamente um arquivo;
- workspace original não recebeu o arquivo de prova;
- rota temporária do Next foi removida;
- nenhuma regra de orçamento foi modificada ou contornada.

Resultado:

`DIRECT_NEXT_RUNTIME_PROOF=PASS`

## Conclusão

A falha original de `prepareValidation` causada pela resolução de `createRequire(...).resolve(...)` no runtime do Next está fechada por evidência viva.

O caminho abaixo foi demonstrado com sucesso no runtime real:

`qwen3-coder`
→ worktree
→ dependency layout
→ Next typegen
→ typecheck web
→ resultado isolado

A prova completa pela superfície:

`chat → proposal → approval → supervisor-turn → executor → review`

não foi repetida até o terminal após a correção porque o orçamento persistido V0 já havia atingido corretamente o teto global de 6 tentativas autônomas em 24 horas.

Não tratar essa barreira como falha do fix e não contornar o orçamento foi parte da prova de governança.

Próximo recorte elegível, separado desta correção:

investigar e corrigir a incoerência entre `block_work_on_budget` e o contrato de decisões humanas, de modo que um bloqueio que afirma exigir decisão humana seja de fato representável/respondível — ou que a mensagem/estado deixe claro quando a única retomada possível é aguardar a janela móvel do orçamento.
