# 2026-08-18 — DeepSeek Harness: causa raiz e correção do "tool-protocol"

**Tipo:** prova + desenvolvimento (investigação focal).

**Objetivo:** fechar o bloqueio registrado em [2026-08-18 (ligação viva)](2026-08-18-deepseek-harness-ligacao-viva.md) — "modelos emitem tool call como texto" — por comparação controlada DSH vs chamada direta, sem chutar. Ver o [design note](../arquitetura/deepseek-harness-coder-backend.md).

**Branch:** `claude/integration-application-layer`. **HEAD inicial:** `8177232`. **HEAD final:** `0b312f6` (1 commit de código; este registro é doc). **`main`:** `99bec54` = `origin/main`, **intacta, sem push**.

## Método (proporcional, reversível, sem efeito externo)

Proxy **localhost** read-only (`127.0.0.1:11500 → :11434`, script descartável em scratch) capturando o payload HTTP real `DSH → pi-ai → Ollama` e a resposta bruta (streaming) do Ollama. `Authorization` redigido; nenhuma credencial gravada; nenhuma rede externa; `node_modules` **não** editado. `baseURL` do pi-ai apontado ao proxy por `--patch` (config pública).

## Diferenças ELIMINADAS (não eram a causa)

- **Transporte/protocolo:** o request do DSH é OpenAI-compat correto — `/v1/chat/completions`, `stream:true`, `stream_options.include_usage`, **24 tools estruturadas** (`{type:function, function:{name,description,parameters,strict}}`), `max_completion_tokens:32768`, sem `tool_choice`.
- **temperature:** `temperature:0` **está** aplicado no request (o plugin `agent/request` funciona).
- **Mensagens:** `system` (coding agent) + `user` (a tarefa EXATA) + `user` (runtime context). O modelo recebe a tarefa corretamente.
- **Resposta do Ollama:** o Ollama **JÁ devolve `tool_calls` ESTRUTURADAS** (`finish_reason: tool_calls`) para o request do DSH — não é texto por limitação de transporte.

## Causa raiz (comprovada, uma variável)

O modelo local **se derrapa com o catálogo de 24 ferramentas**: chamou `web_search`/`update_goal` **alucinando tarefas alheias** e ignorou a tarefa. Experimento de **uma variável** — o MESMO request com `tools` filtradas para `edit/glob/grep/pwsh/read/write` → o modelo chamou `write {"file_path":"note.txt","content":"DONE"}` e concluiu. A diferença causal mínima é o **tamanho/conteúdo do catálogo de ferramentas** (a config vencedora do POC era pequena, não só "sem str_replace_editor").

## Correção (mínima, versionável, configurável)

`harness-invocation.ts`: `HARNESS_FOCUSED_DISABLED_PLUGINS` desabilita por default, via `--patch`, os plugins distratores (`tool-web`, `tool-goal`, `tool-ralph`, `tool-subagent*`, `tool-workflow`, `tool-todo`, `tool-skill`, `plan-mode`, `tool-jobs`) → catálogo **24 → 7**. Configurável; não é regra universal. Regressão focada (planejador + driver). `0b312f6`.

## Prova viva (scratch isolado, sem efeito externo)

Com o patch **gerado pelo planejador versionado** (Node type-stripping do `.ts`), o modelo criou arquivos de ponta a ponta chamando `write`: `ok.txt`=`READY`, `note.txt`=`DONE`.

## Caveat honesto (não ratificado)

Sucesso de **turno único** é **VARIÁVEL** — o mesmo caminho às vezes narra sem agir / emite tool call em texto (uma execução falhou em criar `result.txt`). Consistente com o POC (`FIRST_PASS 0/5`): a confiabilidade vem do **laço de retry após gate FAIL do host**, não do turno único.

## Provas automatizadas / efeitos externos

`apps/web` Jest **576/576** (+2 regressão focada); `typecheck` **5/5**. **Nenhum** efeito externo (sem push/PR/merge/deploy/`origin/main`; sem credencial; provas em scratch descartável). Proxy e artefatos de captura ficam fora do repo.

## Próximo ponto exato de retomada

1. **Laço de retry no host** (agora o passo de MAIOR alavanca, pois o turno único é variável): coder turn → gates do host → se FAIL e há orçamento, **nova sessão** com a evidência observada do host na tarefa → verifica de novo. Limitado, fail-closed, dirigido por evidência (sem confiar em texto do modelo). Extensão do `CoderBackend` + `WorktreeExecutorAdapter`.
2. Só então **registrar em `backendFor`** (`coder_backend: "deepseek-harness"`, injetando as opções do driver — caminho do `dsh`/plugin, URL do Ollama, modelo, spawner, fs), **não** default.
3. Prova viva num git worktree descartável com gates reais do host, reproduzindo as propriedades do POC.
