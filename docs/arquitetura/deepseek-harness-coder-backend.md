# DeepSeek Harness como CoderBackend candidato

**Status:** Candidato — **NÃO ratificado** como backend padrão nem ligado ao fluxo vivo.
**Data:** 2026-08-18
**Relação:** estende o seam do [ADR-001](adr-001-execucao-local-de-codigo.md) (execução em git worktree, inteligência selecionável por `CoderBackend`). Não altera o ADR-001.
**Base empírica:** POC do DeepSeek Harness (`@deepseek-ai/dsh` 0.1.0-rc.7) com Ollama local + `qwen3-coder:latest` via `@deepseek-ai/dsh-llm-pi-ai`, concluído com evidência local (fora deste repo).

## Contexto

O ADR-001 ratificou executar autodesenvolvimento numa **git worktree isolada** com **inteligência selecionável** por trás da interface `CoderBackend`. Hoje há dois backends que só **propõem** edições e o host as aplica pela superfície confinada (`Ollama` por protocolo limitado; `OpenAI` single-shot). O POC avaliou um terceiro candidato de natureza diferente: o **DeepSeek Harness** (`AgentLoop` do `@deepseek-ai/dsh`), que roda o **próprio laço agêntico** com as próprias ferramentas de arquivo/shell.

O POC não é ratificação: é evidência. As conclusões empíricas relevantes (resumidas; a prova detalhada vive fora deste repo):

1. O Harness é candidato forte a **CoderBackend**, **não** a substituto do `WorkExecutor`. O Anima continua dono de: worktree, Git observado pelo host, gates, escopo, cancelamento, Resource Governor, commit/handoff, evidência observada, Verifier e a **decisão de sucesso**.
2. `dsh` exit 0 / `turn/end kind=completed` **não** significam tarefa concluída: houve turno `completed` sem alteração alguma, com o modelo afirmando que os testes passavam, enquanto o `npm test` do host encontrou **FAIL**. Sucesso deve ser classificado **exclusivamente** por evidência/gates do host.
3. `temperature=0` estabilizou fortemente o protocolo de tool calls (baseline sem temperature: 8/10 PASS com 2 pseudo-tool failures; `temperature=0`: 10/10, 0 pseudo-tools).
4. `str_replace_editor` teve ergonomia ruim neste ambiente Windows/modelo (paths Unix como `/repo`, loops, aumento de duração). A config vencedora do POC **desabilita** essa tool e mantém `edit/write/read/glob/grep/pwsh`. É evidência de compatibilidade do provider Windows, **não** regra universal.
5. O `AgentLoop` **não** tem turn budget nativo; a própria doc do Harness recomenda cancelar de um ponto de extensão de ciclo de vida. O POC provou o seam oficial `agent/pre-step` → `agent.cancel({ kind: "hook", reason: "step-budget-exhausted:N" })`, gravado durável no `turn/end` (`kind=aborted`, `reason.kind=hook`). O valor 12 **prova o mecanismo**, não é política final.
6. Retry na **mesma sessão** funciona e importa: `ctx.agents.resume({ resumeSessionId, agentOptions, setup })` reinstala o mesmo setup. Campanha final (fixture workflow/projector, 5 execuções, ≤1 retry na mesma sessão): FIRST_PASS 0/5, RECOVERED_AFTER_RETRY 5/5, FINAL_PASS 5/5. Padrão determinístico: turno 1 encerra `completed` cedo demais → host roda gate → **FAIL** → resume mesma sessão + evidência observada do host → turno 2 corrige → host verifica → **PASS**.
7. `git diff` sozinho não basta como evidência de escopo: um arquivo `untracked` criado pelo agente não aparece em `git diff --name-only`. Escopo observado precisa considerar **tracked + untracked**.

Os hacks locais que sustentaram o POC (patch de `temperature=0` em `node_modules`, hook de step budget no mesmo arquivo, `DSH_RESUME_SESSION_ID` no headless, instrumentação `PIAI_PAYLOAD_JSON`) serviram só para **provar as APIs/seams** e **não devem ser promovidos**.

## Decisão de desenho (o que ESTE ciclo fixa)

Introduzir o Harness como **candidato versionável** a `CoderBackend`, pelas **APIs públicas** do Harness, **sem editar `node_modules`** e **sem substituir o `WorkExecutor`**. Concretamente:

### Fronteira de responsabilidade (inalterada)

O host permanece autoridade única de tudo que decide desfecho. O Harness só **escreve código** dentro da worktree isolada:

| Responsabilidade | Dono |
|---|---|
| Worktree isolada, branch descartável, restauração ao base | Host (`GitWorktree`) |
| Git observado (tracked **+ untracked**) | Host (`changedFiles`, via `git add -A` + `diff --cached`) |
| Escopo (fora do escopo aprovado ⇒ `contract_violation`) | Host (`WorktreeExecutorAdapter`) |
| Gates (allowlist `npm test/typecheck/build/lint`, sem shell arbitrário) | Host (`runGate`) |
| Cancelamento (`AbortSignal`) | Host |
| Resource Governor / custo host-observed | Host |
| Commit/handoff durável | Host |
| Verifier / parecer | Host |
| **Decisão de sucesso** | Host (gates), **nunca** o `turn/end` do Harness |
| **Escrever o código** | Harness (candidato) |

Nota sobre a observação de escopo: o host já é **tracked + untracked-safe** — `changedFiles` faz `git add -A` (que estagia arquivos novos) **antes** de `git diff --cached`. A lacuna do ponto 7 do POC é uma propriedade do `git diff` cru, que o host **não** usa. `git clean -fdx` na restauração remove também não-rastreados e ignorados.

### Seam mínimo

- `CoderWorkspace` ganha `rootPath?` opcional — o cwd **absoluto** da worktree, preenchido pelo host (`worktree.root`) só na execução local in-process. Backends que só propõem (Ollama/OpenAI) o ignoram; um backend **enraizado** (Harness) o exige e **falha fechado** sem ele. Nunca vaza para `summary`/`notes`/evidência (é caminho absoluto local — dado sensível).
- Porta `HarnessRuntime` (injeção): a superfície pública mínima que o adaptador dirige (`runTurn`), com `create`/`resume` de sessão, `temperature`, ferramentas, `stepBudget`, o hook `onPreStep` e o `AbortSignal`. O runtime real (que importa o `@deepseek-ai/dsh`) a implementa **na borda de composição**; os testes a implementam com um falso — **sem `node_modules`, sem rede, sem modelo**. Espelha como Ollama/OpenAI injetam `fetchImpl`.
- Política **pura** do host, versionada em `packages/core` (`harness-turn-lifecycle`), sem importar o Harness:
  - `decideHarnessPreStep` — a decisão do hook `agent/pre-step` (cancela ao ultrapassar o orçamento, com o motivo durável exato do POC);
  - `classifyHarnessTurnEnd` — normaliza o `turn/end` num desfecho **observado** que **nunca** é sucesso (`completed` ⇒ `completed-unverified`).

### Config do POC como DEFAULT configurável — **não ratificada**

`temperature=0`, orçamento de passos `=12` e `str_replace_editor` desabilitada entram como **defaults configuráveis** marcados como **dado do POC**, não decisão canônica.

## Invariantes de segurança preservadas

Todas as invariantes do ADR-001 seguem valendo: worktree isolada, nenhuma alteração no workspace original, nenhum merge/push/apply automático, gates obrigatórios, restauração ao base, resultado sempre para revisão humana. O adaptador **não decide sucesso** e **não atesta arquivos tocados** (o escopo é observado pelo host via git).

## Fronteira de segurança NÃO cruzada (requer evidência + ratificação humana)

O `pwsh` (e qualquer shell) das ferramentas do Harness executa comandos **arbitrários** no worktree, **fora** da allowlist de gates (`GATE_PATTERN`). Os backends atuais (Ollama/OpenAI) nunca executam comandos — só produzem edições que o host aplica. Habilitar um laço agêntico com shell arbitrário no worktree **real** do Anima é uma **expansão de autoridade de segurança** além do que o ADR-001 ratificou, com superfície nova (rede, leitura de arquivos, arquivos ignorados que um gate poderia ler). Pela distinção de [Marco 005/006](../marcos/README.md), cruzar uma fronteira de segurança exige **trabalho de evidência + ratificação humana**, nunca ação autônoma. Por isso a ligação viva do runtime **não** é feita neste ciclo.

## O que NÃO está ratificado / deferido (blocks explícitos)

- **Harness como backend padrão** — não. O default do `backendFor` continua `ollama`; o Harness **não** está registrado no fluxo real nem no advisory pré-execução (`declaredCoderBackendId` segue restrito a `ollama`/`openai`).
- **Orçamento de passos = 12**, **retry = 1**, **remoção universal de `str_replace_editor`** — são dados do POC, não decisões canônicas. Ficam configuráveis, com o valor do POC só como default.
- **Ligação viva do `HarnessRuntime` com o `@deepseek-ai/dsh`** — bloqueada por: (a) o pacote **não** está instalado neste repo; (b) sua API pública precisa ser verificada contra o pacote real (não adivinhada); (c) a revisão de segurança do `pwsh` acima. Adicionar a dependência e cruzar essa fronteira é decisão humana.
- **Retry na mesma sessão após falha de gate observada pelo host** (POC ponto 6) — a **semântica** está provada, mas o **mecanismo** muda o contrato compartilhado `CoderBackend` (threading de sessão + realimentação de evidência de gate) e o laço central do `WorktreeExecutorAdapter` (de single-shot para laço limitado). É alto raio de impacto e a forma exata depende da API `resume` real do Harness. Fica para a fatia da ligação viva, onde há consumidor real.

## Próximo ponto de continuação (pré-ratificação)

Quando houver decisão humana de instalar/vendorar o `@deepseek-ai/dsh` e ratificar a fronteira do `pwsh`: implementar o `HarnessRuntime` real, `temperature`, ferramentas, hook `agent/pre-step`, depois o laço de retry no host, depois o registro no `backendFor` sob contrato explícito e a previsão no advisory. Cada passo com testes focados e gates existentes.

---

## Atualização 2026-08-18 — ligação viva ratificada (recorte experimental controlado)

Gean ratificou, **para este recorte experimental controlado**, as duas decisões que bloqueavam a ligação viva: (1) adicionar/versionar a dependência do Harness fixada em `@deepseek-ai/dsh 0.1.0-rc.7` (+ só as diretamente necessárias); (2) uma capacidade **experimental estreita** do Harness executar ferramentas locais dentro do worktree isolado, sob envelope: sandbox `workspace-write`; filesystem confinado ao worktree (+ temporárias inevitáveis do runtime); **rede desabilitada** para o coder; sem `danger-full-access`; sem acesso a credenciais; nenhum efeito externo; sem alterar `origin/main`; host mantém worktree/Git observado/escopo/gates/cancelamento/Resource Governor/commit-handoff/Verifier/classificação final; `completed`/exit 0 nunca é sucesso; gates do host obrigatórios; execução cancelável; runaway limitado por lifecycle hook; **qualquer saída do envelope falha fechada**. **NÃO** é autorização para ampliar o envelope depois, nem ratificar Harness como default, budget=12, retry=1 ou remoção universal de `str_replace_editor`.

### Dependências adicionadas (pinadas, exatas)

Em `apps/web`: `@deepseek-ai/dsh@0.1.0-rc.7` (CLI + profiles + runtime cordis), `@deepseek-ai/dsh-headless@0.1.0-rc.7` (profile one-shot dirigido), `@deepseek-ai/dsh-llm-pi-ai@0.1.0-rc.7` (provider compatível com Ollama). **Nada mais atualizado**; `npm audit fix` **não** executado (evita upgrades oportunistas — a árvore reporta 6 advisories high, contidos ao subprocesso experimental, fora do caminho do servidor Anima).

### Arquitetura decidida: SUBPROCESSO confinado (não embedding in-process)

O `@deepseek-ai/dsh` é um app agêntico grande sobre o framework cordis, com binário `dsh` (`bin: lib/bin.js`). A ligação viva roda o Harness como **processo filho confinado** no worktree, **não** embutido no processo do servidor Next.js do Anima. Razões: o envelope ratificado É um sandbox de processo (`workspace-write`, rede off, sem `danger-full-access`) — exatamente o sandbox nativo do CLI; a fronteira de processo é a contenção mais forte e mantém o Harness fora da memória/credenciais do servidor Anima; casa com o `runProcess` que o host já usa para gates; o host cancela matando o filho (autoridade de cancelamento preservada); o host lê `turn/end` do log durável de sessão (nunca confia no texto do modelo). **Consequência de desenho:** o binding **spawna** o `dsh` (não importa módulo TS do dsh), então tipa e testa **sem** o dsh presente (fake do spawner, como o Anima fake-a `fetchImpl`); o dsh é dependência de **runtime**.

### Contrato público VERIFICADO do CLI (na versão instalada)

- Invocação one-shot: `dsh --profile headless "<task>"` (responde uma tarefa, imprime, sai).
- Configuração pública **sem editar `node_modules`**: overlays de patch cordis via `--patch <arquivo.yml>` (repetível) + variáveis de ambiente. `--dump-default-config` imprime a composição.
- Envelope mapeado a controles reais (do `--dump-default-config` do profile `headless`):
  - **workspace-write** e **cwd-confinado**: `sandbox-policy` = `mode: DSH_PERMISSION_MODE ?? 'workspace-write'`, `workspaceRoot: process.cwd()` → o host roda o filho com `cwd = worktree.root`.
  - **rede off para o coder**: `approval: ask` (headless sem humano → escalonamentos como rede/fora-do-workspace **auto-negados**, falha fechada), `tool-web.fetch: false`, telemetria OTEL `DSH_TELEMETRY_MODE ?? 'DISABLED'` (o exportador `harness-telemetry.deepseeksvc.com` é o único URL externo — mantido DESABILITADO explicitamente); web tools adicionalmente desabilitados por patch (defesa em profundidade).
  - **provider/model**: patch sobre `agent-default-model` → `{ provider: <rota pi-ai>, model: 'qwen3-coder:latest' }` (Ollama), pois o default é o cloud `deepseek-official`.
  - **temperature=0**: `LlmCallConfig` tem `temperature?: number`; um plugin de patch intercepta o waterfall `agent/request` e devolve `{ ...config, temperature: 0 }` (evento público verificado). Não há chave de temperature no profile composto.
  - **step budget**: um plugin de patch escuta o waterfall `agent/pre-step` (`{ agent, turn, step, signal }`) e, ao ultrapassar o orçamento, chama `agent.cancel(cause)` com causa observável — a política pura já vive em `harness-turn-lifecycle`. Runaway limitado estruturalmente.
  - **desabilitar `str_replace_editor`**: é o plugin `tool-str-replace-editor` — patch `disabled: true` (configurável, não regra universal).
  - **sessão**: `session-persistence-jsonl` grava JSONL em `$DSH_HOME/sessions` — a fonte durável que o host lê para `turn/end`. O host usa um `DSH_HOME` isolado por execução.

### Limitação pública verificada: resume de sessão no headless

O profile `headless` **não** expõe flag pública de `--resume`; o resume do POC (`DSH_RESUME_SESSION_ID`) era patch em `node_modules` (proibido). O resume in-process existe (`ctx.agents.resume`), mas exigiria embedding (troca de contenção por conveniência — recusado). Portanto, no modelo de subprocesso confinado, o **retry após falha de gate observada pelo host** é feito com **sessão NOVA que recebe a evidência observada do host na tarefa** (dirigido por evidência, limitado, fail-closed, sem confiar em texto do modelo) — não literalmente a mesma sessão. Preserva a propriedade essencial do POC (retry só após gate FAIL do host) sem cruzar `node_modules` nem enfraquecer a contenção.

### Resultado da ligação viva — o que foi PROVADO ao vivo (evidência)

Provas empíricas locais contra o `dsh` instalado (todas em `$DSH_HOME`/cwd de scratch isolados, `workspace-write`, telemetria off — **nenhum efeito externo**):

- O CLI `dsh` **boota** o profile headless neste ambiente (koffi nativo + worker threads carregam) e **falha fechado** sem credencial/rede (`MISSING_CREDENTIAL: … deepseek-official`).
- Ollama local disponível com `qwen3-coder:latest` (e `llama3.1:8b`); a rota pi-ai `openai-completions` → `http://127.0.0.1:11434/v1` (com `apiKeyEnv` dummy — o endpoint exige o campo, ignora o valor) **conecta e o modelo responde**.
- Configuração por `--patch` **funciona** (merge verificado por `--dump-config`): override de `agent-default-model` → Ollama, `tool-str-replace-editor` `disabled: true`.
- O **plugin cordis local versionado** (`anima-harness-plugin.mjs`) **carrega** via `--patch` com um bare-`insert` (sem id-âncora) e `name: 'file:///…'`; seu `apply()` roda no boot (marcador durável escrito) e registra os hooks `agent/request` (temperature) e `agent/pre-step` (step budget). É a forma **pública** do temperature + step budget, sem editar `node_modules`.
- Sessões persistem em `$DSH_HOME/sessions/<cwd-sanitizado>/session-<uuid>/session.jsonl.zstd` (JSONL **comprimido em zstd**; o Node 24 descompacta nativamente). Envelope de evento **plano** `{type, ...}`; `turn/end` = `{type:'turn/end', turn, reason: TurnEndReason}` — mapeia 1:1 para `classifyHarnessTurnEnd` do core. O flush do log **não** ocorre em saída suja (kill/erro precoce), então o host trata o log como enriquecimento e usa os **sinais de processo** como autoridade de fallback.

### Bloqueio técnico honesto — protocolo de tool calls modelo↔Harness

Ainda **não** foi conseguida uma execução viva end-to-end em que o modelo **complete uma tarefa de código usando as ferramentas estruturadas**. Ambos os modelos testados (`qwen3-coder:latest` e `llama3.1:8b`) — mesmo com `temperature=0` aplicado pelo plugin — **emitem a chamada de ferramenta como TEXTO** (`<function=web_search>…`, `{"type":"function","name":"runtime_context"}`) em vez de `tool_calls` estruturados, e não executam a tarefa. Como se reproduz em **dois** modelos, é um problema de **integração/config do protocolo de tool calls** (adaptador pi-ai `openai-completions` ↔ endpoint OpenAI-compat do Ollama nesta versão/ambiente), **não** específico de um modelo. É EVIDÊNCIA, não causa raiz ratificada: a causa (o adaptador envia `tools`? o Ollama devolve `tool_calls`? falta um `compat`/tools-mode?) precisa ser comprovada inspecionando o payload HTTP real. É o próximo passo técnico exato; **nada aqui é fingido como vivo**.

### Ligação viva — código versionado e testado (candidato completo)

A cadeia do candidato existe versionada e verde, sem importar módulo TS do dsh (spawn do subprocesso), então tipa/testa sem dsh nem Ollama no teste:

- `harness/anima-harness-plugin.mjs` — plugin cordis (temperature + step budget), **provado carregando ao vivo**.
- `harness/harness-invocation.ts` — planejador PURO do comando/`--patch`/env verificado; envelope fail-closed.
- `harness/deepseek-harness-runtime.ts` — driver `HarnessRuntime` real por subprocesso: compõe a tarefa (com evidência do host no retry), spawna `node dsh`, cancela matando o filho, lê `turn/end` do log (zstd) com fallback nos sinais de processo. Pluga no `DeepSeekHarnessCoderBackend`.

**NÃO** ratificado / **NÃO** feito neste ciclo (bloqueado pela lacuna de tool-protocol acima, que impede um consumidor vivo verde):

- **Registro em `backendFor`** como backend selecionável explícito (`coder_backend: "deepseek-harness"`). O driver ainda exige opções de construção (caminho do `dsh`/plugin, URL do Ollama, modelo, spawner, fs) que a fábrica atual não injeta — fiar isso é parte desta fatia. **NÃO** vira default de forma alguma.
- **Laço de retry no host** (coder turn → gates do host → se FAIL e há orçamento, nova sessão com a evidência observada do host → verifica de novo): muda o contrato `CoderBackend` + o laço central do `WorktreeExecutorAdapter` (alto raio) e precisa de um consumidor vivo verde para ser provado. Deferido de propósito.
- **Prova viva end-to-end** (modelo completa tarefa via ferramentas + gates do host): bloqueada pela lacuna de tool-protocol.

Continuam **não ratificados**: Harness como default, orçamento `12`, retry `1`, remoção universal de `str_replace_editor`.

### Investigação do tool-protocol — causa raiz e correção (prova viva)

O bloqueio registrado como "modelos emitem tool call como texto" foi investigado por **comparação controlada** com um **proxy localhost read-only** (127.0.0.1:11500 → :11434) capturando o payload real `DSH → pi-ai → Ollama` e a resposta bruta do Ollama (artefato descartável em scratch; nenhuma credencial gravada; nenhuma rede externa).

**A causa NÃO é transporte/protocolo.** O request do DSH está correto: `POST /v1/chat/completions`, `stream:true`, `temperature:0` (aplicado pelo plugin), **24 ferramentas estruturadas** (`{type:function, function:{name,description,parameters,strict}}`), `max_completion_tokens`, sem `tool_choice`; a mensagem do usuário é a tarefa exata. E o **Ollama JÁ devolve `tool_calls` ESTRUTURADAS** (`finish_reason: tool_calls`) para esse request.

**A causa é a SELEÇÃO de ferramenta pelo modelo local.** Com o catálogo inteiro (24), `qwen3-coder` chamou `web_search`/`update_goal` **alucinando tarefas alheias** (segurança em JS, educação e IA) e nunca tocou nas ferramentas de arquivo. Experimento de **UMA variável** (o MESMO request, `tools` filtradas para o conjunto de arquivo/shell) → o modelo chamou `write {"file_path":"note.txt","content":"DONE"}` e **concluiu a tarefa**. Isto espelha exatamente a config vencedora do POC (só ferramentas de arquivo/shell) — o ganho não vinha só de desabilitar `str_replace_editor`, mas do **catálogo pequeno**.

**Correção mínima e configurável:** o planejador (`harness-invocation.ts`) desabilita por default os plugins de ferramenta distratores (`HARNESS_FOCUSED_DISABLED_PLUGINS`: `tool-web`, `tool-goal`, `tool-ralph`, `tool-subagent*`, `tool-workflow`, `tool-todo`, `tool-skill`, `plan-mode`, `tool-jobs`) via `--patch` — reduz o catálogo de **24 → 7** (`edit/glob/grep/pwsh/read/read_image/write`). Configurável; **não é regra universal** (um modelo forte pode preferir o catálogo cheio). Regressão focada nos testes.

**Prova viva** (scratch isolado, sem efeito externo): com o patch **gerado pelo planejador versionado**, o modelo criou arquivos de ponta a ponta chamando `write` — `ok.txt`=`READY`, `note.txt`=`DONE`.

**Caveat honesto (não ratificado):** o sucesso de **turno único** é **variável** — o mesmo caminho às vezes narra sem agir ou emite tool call em texto (uma execução falhou em criar `result.txt`). Bate com o POC (`FIRST_PASS 0/5`): a **confiabilidade** vem do **laço de retry após gate FAIL do host** (deferido), não do turno único. Por isso o registro em `backendFor` continua deferido — um backend selecionável precisa da confiabilidade do retry.

---

## Atualização 2026-08-18 (3ª) — retry interno host-observed, borda Node real, roteamento e Verifier terminal

Fatia entregue: o Harness passa a ser **selecionável no fluxo real** (`coder_backend: "deepseek-harness"`), com **retry INTERNO** dirigido por falha de gate observada pelo host — o gap de confiabilidade de turno único que estava deferido. **`backendFor` NÃO tem novo default** (segue `ollama`).

### Retry interno do executor (host é autoridade)

`WorktreeExecutorAdapter` ganha `gateRetryLimit` (default **0** — comportamento histórico intacto; Ollama/OpenAI não retriam). Quando `>0`, um gate que o **host** observou falhar (`exitCode≠0`, `!timedOut`, `!cancelled`) realimenta o coder com `hostValidationFeedback` (novo campo opcional em `CoderEditRequest`) e o coder corrige **dentro do mesmo `attemptId`/worktree**. Invariantes:

- `hostValidationFeedback` **não** é `carriedContext` persistido, **não** cria novo attempt, **não** amplia escopo/permissão;
- scope violation e `backend.edit()` throw **nunca** retriam (fail-closed); timeout/cancelamento **nunca** retriam;
- o junction de `node_modules` é desligado (`GitWorktree.unlinkNodeModules`) **antes** de reentrar no coder;
- **nenhum commit intermediário** de turno falho (commit uma vez após o laço); checkpoint só no primeiro turno.
- roteamento: `gateRetryLimitForCoderBackend(kind)` = **1 só para `deepseek-harness`**, 0 para os demais.

### Evidência multi-turn (EVIDÊNCIA ≠ CLASSIFICAÇÃO ≠ CUSTO)

- **Gate:** o host coleta TODAS as observações de gate do attempt (`onGateObserved` por turno) e persiste **UMA** `HostObservedGateEvidenceV1` append-only. Um FAIL→PASS legítimo fica gravado como os dois — evidência auditável, nunca colapsada.
- **Coder:** `persistHostObservedCoderEvidence` agrega por attempt — `durationMs` = **soma** dos turns, `outcome` = **último** turn.
- **Verifier (correção do bug):** `terminalObservedGates` (helper puro) projeta a ÚLTIMA observação por identidade `label+command` e o Verifier classifica pelo **estado terminal** (`gate_failed`, `gates_independently_observed`, cobertura de critério). A comparação `attested_gate_contradicts_observed` casa por **rótulo** (o handoff e a evidência podem gravar formas diferentes do mesmo comando). Assim FAIL→PASS ⇒ `verified`; PASS→FAIL ⇒ `rejected`; A FAIL→PASS + B FAIL ⇒ `rejected` por B. **Não** cria schema V2, **não** apaga história.
- **Resource Governor:** consome os gates **brutos** (não a projeção terminal) — um gate que rodou duas vezes gastou recursos duas vezes; o custo preserva isso.

### Borda Node real

`node-harness-runtime.ts`: `HarnessFileSystem`/`HarnessSpawner` reais (`child_process.spawn`, **`shell:false`**, cwd/env explícitos, `AbortSignal→child.kill()`, exitCode como evidência). `createNodeDeepSeekHarnessBackend` resolve o pacote `dsh` por `require.resolve('@deepseek-ai/dsh/package.json')` (**sem hardcode**), o `lib/bin.js` real, o plugin versionado e um `DSH_HOME` temporário **único por run** (as sessões são enumeradas só nesse root isolado, sem copiar o `projectKey` privado).

### Prova viva do caminho REAL (scratch isolado, sem efeito externo)

Contrato real (`coder_backend: deepseek-harness`, `executor: worktree`, `model: qwen3-coder:latest`) → factory Node → DSH rc.7 → Ollama local → worktree isolado (repo alvo descartável com teste falhando) → coder REAL editou `src/sum.js` → gate `npm test` do host → **exitCode 0** → handoff → **Verifier = `verified`** (`gates_independently_observed`, `criterion_covered`, …). Reproduzido **2/2**. `dsh` exit 0 **não** foi tratado como sucesso — o desfecho é do host (gate). Nenhum efeito externo; artefatos descartáveis limpos; worktrees do Anima intactos.

### Limitações restantes (não escondidas)

- **Retry vivo não disparado:** o `qwen3-coder` corrigiu o bug simples em **um** turno (2/2), então o FAIL→PASS **vivo** não foi exercido. O retry+classificação terminal é provado pelas **regressões de integração** do `worktree-executor` (worktree e gates reais, backend determinístico) e do Verifier. Turno único do LLM permanece variável (POC `FIRST_PASS 0/5`).
- **Accounting do coder:** `durationMs` soma turns e `outcome` = último turn; um cancelamento final pode fazer o Resource Governor subcontar trabalho anterior. **Não** afirmar accounting exato enquanto isso existir.
- **Env do subprocesso — `pwsh` PROVADO sob o env mínimo (2026-08-18 4ª):** investigação determinística refutou a suspeita anterior. O `dsh-pwsh-local` resolve o executável por **caminho absoluto** (`SystemRoot ?? "C:\\Windows"` → `...\System32\WindowsPowerShell\v1.0\powershell.exe`), então o PowerShell é encontrado mesmo sem `PATH`/`SystemRoot` no env. Prova viva: `dsh` headless spawnado EXATAMENTE como o spawner do Anima (env = só os 4 vars do planejador, `shell:false`) com tarefa que força a ferramenta `pwsh` → o modelo chamou `pwsh`, o PowerShell 5.1 rodou `Get-Location` e devolveu o cwd real, **exit 0**. Conclusão: o `pwsh` funciona para operações NATIVAS do PowerShell sob o env atual; **nenhuma mudança de env é necessária**. Resíduo honesto: um comando `pwsh` que invoque EXECUTÁVEIS EXTERNOS (git/npm/node) via `PATH` falharia (PATH vazio) — mas o coder não deve rodar gates (o host roda). Não mexer no env sem evidência de necessidade real.
- **`child.kill()`** pode não matar toda a árvore de descendentes no Windows; investigar só se uma prova real mostrar processo órfão.
