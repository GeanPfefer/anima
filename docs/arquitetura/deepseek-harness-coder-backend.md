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
