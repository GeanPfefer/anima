# 2026-08-19 — Causa raiz REAL do no-op do coder: `agent-instructions`; correção honesta do "SystemRoot"

**Tipo:** desenvolvimento + prova.

**Objetivo:** repetir a prova viva do fluxo real do Harness após a falha viva pela UI (item `c6b9f1ab-4ee9-448d-b1b2-bde884297e76`, attempt `a29507f0-39f5-4467-824f-af06a425cb32`), validar a correção local pendente e continuar para o próximo gargalo real. Ver a [nota de design](../arquitetura/deepseek-harness-coder-backend.md) (seção 2026-08-19).

**Branch:** `claude/integration-application-layer`. **HEAD inicial:** `da28c1d`. **HEAD final (código):** `ee63387` (+ commit de docs). **`main`:** `99bec54` = `origin/main`, **intacta, sem push**.

## Reconciliação inicial (estado REAL confirmado)

HEAD `da28c1d`; duas alterações locais não commitadas em `node-harness-runtime.{ts,test.ts}` (a "correção SystemRoot" do handoff) e `.worktrees/` untracked. O diff local batia exatamente com o descrito. Gate focado do handoff (`node-harness-runtime.test.ts`) verde 4/4.

## Commits (todos LOCAIS, sem push)

- `12a7d38` — Isole credenciais e garanta SystemRoot não vazio no subprocesso do Harness (reescrita HONESTA do commit do handoff; ver abaixo).
- `f940a33` — Desabilite `agent-instructions` no coder focado (AGENTS.md derrapa o modelo local) — a correção que DESBLOQUEOU a prova viva.

## Bug de DIAGNÓSTICO corrigido: "SystemRoot" era hipótese, não causa raiz

O handoff atribuía a falha viva (`execution_failed`, `durationMs≈102`, sem sessão) a `SystemRoot` ausente no env mínimo. Investigação determinística (Windows, Node 24, `spawn shell:false`) **refutou**:

- **libuv reabastece `SystemRoot`** no filho a partir do pai **quando a CHAVE está AUSENTE**; o env do planejador (que omite `SystemRoot`) já dá `SystemRoot=C:\Windows` no filho. `crypto` sob esse env → **exit 0**.
- `node exit 134` (assert CSPRNG) só com `SystemRoot` **presente e VAZIO** — o planejador nunca faz isso.
- Logo a correção original era **no-op** para produção. Reescrita: garante `SystemRoot` **não vazio** (`process.env.SystemRoot || process.env.windir || 'C:\\Windows'`) como blindagem defensiva do único crash reproduzível (vazio ⇒ 134) — **não** como causa da falha viva (que **não reproduz**). Valor real do commit: **isolamento de credenciais** (regressão injeta `OPENAI_API_KEY`/`DEEPSEEK_API_KEY` reais no pai e prova que o filho não as vê).

## Bug REAL encontrado e corrigido: plugin `agent-instructions` derrapa o modelo local

O perfil `headless` do DSH habilita `@deepseek-ai/dsh-agent-instructions`, que lê `AGENTS.md`/`CLAUDE.md`/`README.md` do workspace (até 64KB) e os injeta como instruções. O worktree do coder é um checkout do repo Anima inteiro, cujo `AGENTS.md` é um roteador humano. **Prova viva isolada** (mesmo cwd pequeno; só a presença dos docs muda): com `AGENTS.md`+`CLAUDE.md` o `qwen3-coder` respondeu "identifiquei arquivos de documentação; o que você gostaria que eu fizesse?" (0 edições); **desabilitando o plugin, criou o arquivo pedido e concluiu**. Isso explica o no-op no fluxo real (repo inteiro) vs a ação num cwd vazio.

**Correção (versionada, só config):** `agent-instructions` entra em `HARNESS_FOCUSED_DISABLED_PLUGINS`, desabilitado via overlay `--patch` (sem editar `node_modules`). O host já entrega objetivo/escopo/restrições via `composeHarnessTask`. Configurável; não universal.

## Prova viva do fluxo REAL (scratch isolado, sem efeito externo)

`WorktreeExecutorAdapter` + worktree isolada do **repo Anima@HEAD** + `createNodeDeepSeekHarnessBackend` (DSH rc.7 + Ollama `qwen3-coder:latest`), `gateRetryLimit:1`, `linkNodeModules`, `emitCheckpoint`. Nova proposta/attempt (`liveproof-*`) — **não** reusa o attempt falho. Resultado APÓS o fix:

- coder REAL editou dentro do escopo (`durationMs` real; sessão criada);
- host observou `changedFiles` (git) e o coder (`deepseek-harness:qwen3-coder:latest`, `succeeded`);
- **gate `npm test` do host passou** (exit 0);
- checkpoint + `result` com handoff durável (`status: succeeded`);
- **Verifier = `verified`** (`correlation_verified`, `branch_ownership_verified`, `scope_respected`, `status_coherent`, `gates_independently_observed`, `criterion_covered`);
- **nada aplicado/integrado** (worktree/branch descartáveis; original intacto).

Antes de o fix estar no default, uma rodada mostrou o **fail-closed** correto ("nenhuma alteração para revisão") e o **retry interno** disparando (2 observações de coder) — host permanece autoridade. Também confirmado que o **turno real dura 7–55 s** (nunca 102 ms): o crash instantâneo do handoff **não** é o modo de falha atual.

## Provas / gates

- Suítes Harness/executor do `apps/web`: **106/106** (após o recorte de observabilidade; 98 antes) — `harness-invocation`, `node-harness-runtime`, `deepseek-harness-*`, `coder-backend`, `executor-selection`, `host-evidence`, `worktree-executor`.
- `typecheck` do `apps/web`: **limpo**.
- Provas vivas (scratch, removidas, não commitadas): micro-prova de causa raiz (libuv/CSPRNG); diag `stderr` do turno real; diag wrapper×cru; diag contexto (docs) com A/B do fix; prova viva completa até `Verifier=verified`.

## Limitações / resíduos honestos (não escondidos)

- A falha viva original (`durationMs≈102`, sem sessão) **não reproduz**; causa exata não confirmada (possivelmente transitória).
- **Observabilidade é o próximo recorte elegível:** `stdio:'ignore'` + `child.on('error', …)` descartam stderr/erro de spawn — a opacidade tornou a falha viva opaca e induziu a diagnose errada inicial. Capturar stderr **sanitizado e limitado** (sem despejar transcript/segredo em `work_events`; evidência ≠ classificação ≠ decisão) é o próximo passo.
- Retry **vivo** FAIL→PASS do LLM segue não exercido ponta a ponta (coberto por regressões de integração).
- Turno único do modelo local ainda variável quando a tarefa é multi-arquivo complexa (o fluxo trata isso com fail-closed + retry do host).

## Invariantes de segurança preservadas

Env mínimo do coder mantido (sem herdar credenciais do processo web); isolamento provado por regressão. `shell:false` no spawner do Harness. Host segue autoridade de worktree, git observado, escopo, gates, commit/handoff, evidência e Verifier. Harness **não** é default. Gates **não** afrouxados. `agent-instructions` desabilitado REDUZ o contexto do coder (mais confinado, não menos).

## Efeitos externos / preservação

**Nenhum** push/PR/merge/deploy/`integrated`/alteração de `origin/main`. Nenhuma credencial de nuvem usada. Provas em worktrees descartáveis do repo + `DSH_HOME` temporários. Branches de prova (`liveproof-*`, `anima-diag/*`, `anima-wrapdiag/*`) limpas pelos próprios testes. Preservados: `.worktrees/mobile-completed-result`, `.worktrees/roadmap-003-006`, `G:\anima-local-test`, `.claude/settings.local.json`, `apps/web/.env.local`, e as branches `anima-work/<uuid>` pré-existentes de sessões anteriores. Arquivos de prova temporários removidos (não commitados).

## Fronteiras humanas restantes

Decisão de integração continua humana (INT-05). Nenhuma nova fronteira cruzada.

## Próximo ponto exato de retomada

1. **Observabilidade do subprocesso do Harness** (recorte elegível): capturar stderr/erro de spawn de forma **sanitizada e limitada** (redigir caminhos absolutos/segredos, limitar tamanho), classificar `error` do turno com uma razão útil em vez de `kind=error, reason=error`; preservar evidência ≠ classificação ≠ decisão; **não** despejar transcript bruto em `work_events`.
2. Substituir/plugar **planner local** para reduzir custo (hoje o Dev usa GPT/OpenAI como planner; coder já roda Harness+Ollama local) — só depois da observabilidade, salvo bloqueio.
3. Harness segue **candidato**, **não** default; sem afrouxar gates.

## Atualização (mesma sessão) — observabilidade sanitizada do subprocesso ENTREGUE

Commit `ee63387`. O recorte de observabilidade listado como "próximo ponto" foi implementado nesta mesma sessão (o `stdio:'ignore'` foi o que tornou a falha viva opaca e induziu a diagnose errada do SystemRoot):

- Spawner captura SÓ stderr (stdout do modelo segue ignorado), LIMITADO a 8KB e drenado; e a mensagem de erro de spawn (ENOENT). stderr bruto = evidência de host efêmera, NUNCA persistida crua.
- `summarizeHarnessFailure`/`redactHarnessPaths` (puros): resumem a falha redigindo caminhos absolutos e limitando o tamanho; preferem a última linha "de erro" ao ruído final do stack do Node. Só um turno de ERRO carrega `diagnostic` (completed/aborted não vazam). Backend inclui o diagnóstico antes da descrição do turno (sobrevive ao `clip` do executor): "exit 134: …" > "kind=error".
- Fronteira respeitada: evidência ≠ classificação ≠ decisão; sem transcript/segredo em `work_events`.
- Provas: `apps/web` harness/executor **106/106**; typecheck limpo. Verificado ao vivo (falha real do DSH: patch inexistente → exit 1 + stack `MODULE_NOT_FOUND` capturado e redigido). **Prova viva final** do fluxo real com TODAS as mudanças = `Verifier verified` (coder 29772ms, gate exit 0, nada aplicado).

**Próximo ponto revisado:** planner local (reduzir custo do planner GPT/OpenAI; coder já roda Harness+Ollama local). Harness segue candidato, não default; gates não afrouxados. HEAD final da sessão: `ee63387`.
