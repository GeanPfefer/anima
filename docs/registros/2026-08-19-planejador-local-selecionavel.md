# 2026-08-19 (2ª) — Planejador de trabalho selecionável (openai default | local Ollama)

**Tipo:** desenvolvimento + prova.

**Objetivo:** dar ao Anima um PLANEJADOR de trabalho LOCAL selecionável e seguro (menor recorte), reduzindo a dependência de GPT/OpenAI na etapa "mensagem Dev → proposta executável", preservando TODA a autoridade host-side. Continua a sessão [2026-08-19 (1ª)](2026-08-19-harness-agent-instructions-causa-raiz.md).

**Branch:** `claude/integration-application-layer`. **HEAD inicial:** `aa3bdb1`. **HEAD final:** `1d4a03e`. **`main`:** `99bec54` = `origin/main`, **intacta, sem push**.

## Commits (locais, sem push)

- `de3934d` — Planejador selecionável: porta `ProjectWorkPlanner`, OpenAI extraído, Local Ollama, config, fiação da rota.
- `1d4a03e` — Robustez do planejador local (forçar-submit com tools=só submit; coerção escalar→lista; prompt), sem afrouxar o host.

## Arquitetura

Porta provider-agnóstica `ProjectWorkPlanner.proposeArguments(message) → { ok, rawArguments } | { ok:false, message }` isola SÓ a parte que depende do provedor: investigação READ-ONLY + inferência dos ARGUMENTOS brutos. Toda a autoridade permanece no HOST, no orquestrador `planExecutableProjectWork`, idêntica para qualquer provedor: `parseProposal` (`safePath`/`safeValidationCommand`), captura de `base_sha` autorizado, e montagem do `execution_spec` (target/executor/coder_backend/model/permissions/limits). O planejador NUNCA escolhe nem amplia essas autoridades.

- `OpenAIProjectWorkPlanner` (`openai_project_tools_v1`): extraído sem mudança de comportamento (Responses API + tools de investigação).
- `LocalOllamaProjectWorkPlanner` (`local_ollama_project_tools_v1`): Ollama `/v1/chat/completions` com as MESMAS ferramentas read-only; NÃO edita, NÃO usa subprocesso/worktree, e **não envia Authorization nem qualquer segredo de env** (endpoint = Ollama local). Escolhido em vez do Harness porque planejar é read-only: contrato mais simples e seguro (sem risco de edição). Exige investigação antes do submit.
- Config de DEPLOY `ANIMA_PROJECT_PLANNER_PROVIDER=openai|local` (default `openai`; local NÃO é default), espelhando `resolveConfiguredCoderBackend`. `ANIMA_PROJECT_PLANNER_MODEL` (default `qwen3-coder:latest`), `OLLAMA_URL` reaproveitado.
- `shouldRunProjectPlanner` preserva o gatilho de produção: planejador openai continua exigindo o provedor de chat `openai`; planejador local roda na superfície dev independentemente do provedor de chat.

## Separação de responsabilidades (mandato)

A investigação (read-only) e a inferência vivem no PLANEJADOR; a validação e a persistência da proposta vivem no HOST. O planejador local não recebe autoridade que hoje pertence ao host, não edita arquivos e não vê segredos de nuvem.

## Robustez do modelo local (sem afrouxar contrato)

Provas vivas expuseram quirks do `qwen3-coder`; o host rejeitou todos fail-closed. Robustez ficou no ADAPTADOR, nunca na validação:
- Ao forçar submit (após `forceAfterEvidence`, default 4), RETIRA as ferramentas de investigação (tools = só submit) — mais confiável que `tool_choice` no Ollama; mata o loop de investigação infinita.
- `coercePlannerArrayFields`: normaliza o quirk escalar→lista (o modelo emite string única onde o schema pede array); envolve o escalar em `[escalar]`, PRESERVANDO o conteúdo — nunca inventa itens; vazio segue vazio e o host rejeita.
- Prompt reforça que os campos de lista são arrays não vazios. `parseProposal` continua ESTRITO.

## Provas / gates

- `apps/web` planner **19/19** determinísticos (config/factory/gatilho; autoridade do host; fail-closed de path/comando; isolamento de segredos por canários; loop local; coerção; forçar-submit). `apps/web lib/ai` amplo **44/44**. `typecheck` limpo.
- **Prova viva (scratch, removida)** com `qwen3-coder` local: mensagem Dev → planejador local → investigação read-only → **proposta executável VÁLIDA** (`executor: worktree`, `coder_backend: ollama`, `base_sha` real, validação npm), plannerId `local_ollama_project_tools_v1`, **0 chamadas OpenAI**. Host fixou todas as autoridades. Variância observada ~1/4 (3 tentativas rejeitadas fail-closed: 2 fora dos limites, 1 JSON malformado) antes de 1 sucesso.

## Benefício / custo evitável (dados reais desta prova)

- Etapas do planejamento que rodaram 100% LOCAIS na prova: investigação read-only + inferência + submit — **0 chamadas à OpenAI** (todas ao Ollama local).
- Etapas que permanecem host-side (locais, sem nuvem): validação, captura de `base_sha`, montagem do `execution_spec`, persistência.
- Quando ainda vale nuvem: qualidade/consistência. O `qwen3-coder` como PLANEJADOR é variável (só ~1/4 produziu proposta válida nesta prova) e de baixa qualidade (inventou um caminho inexistente — `safePath` aceita porque só checa segurança, não existência). Não afirmar economia monetária sem métricas de produção; o dado sólido é: quando o planejador local conclui, **zero** chamadas de nuvem no planejamento.

## Limitações (não escondidas)

- Variância e qualidade do `qwen3-coder` como planejador (tool-calling instável; propostas às vezes fora dos limites ou de baixa qualidade). O host absorve com fail-closed; NÃO afrouxar o contrato para o modelo passar.
- Sem retomada/erro tipado novo: uma falha do planejador local vira `projectPlanningError` (mesmo caminho do OpenAI).
- Não há teste da rota `/api/ai/chat` (não existe suíte de rota); a mudança é substituição por helper puro testado.

## Invariantes de segurança preservadas

Supervisor → Executor → Reviewer/Verifier intactos. Integração final humana. Planejador local read-only (sem edição/subprocesso/worktree). Nenhum segredo de nuvem enviado ao modelo local (regressão com canários). `safePath`/`safeValidationCommand`/gates NÃO afrouxados. Planejador local NÃO é default. Harness NÃO é default.

## Efeitos externos / preservação

**Nenhum** push/PR/merge/deploy/`integrated`/alteração de `origin/main`. Prova viva contra Ollama local; nenhuma chamada de nuvem. `.worktrees/`, `.claude/settings.local.json`, `apps/web/.env.local` preservados. Scratch de prova removido (não commitado).

## Próximo ponto exato de retomada

1. **Roteamento por capacidade/custo** entre planejador local e nuvem (ex.: tentar local, cair para nuvem quando o local falhar N vezes ou a tarefa exigir mais qualidade) — evidência-guiado, sem tornar o local default.
2. Avaliar um **modelo local melhor para planejamento** (o `qwen3-coder` é de codificação; um modelo de instrução pode planejar melhor) — só com evidência comparativa.
3. Métrica real de custo/latência do planejador (contagem de chamadas nuvem×local por proposta) se/quando houver consumidor.
