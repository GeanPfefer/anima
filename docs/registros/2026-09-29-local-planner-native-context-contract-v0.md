# Local Planner — contrato nativo de contexto V0

**Data:** 2026-09-29

**Tipo:** desenvolvimento e prova isolada

**Branch:** `dev`
**HEAD inicial:** `89daeea` (`origin/dev` igual; `origin/main=99bec54`)

## Objetivo e decisão

O `LocalOllamaProjectWorkPlanner` usava `/v1/chat/completions`, caminho que não expõe de forma
confiável o controle request-scoped do contexto no Ollama. Somente esse planner foi migrado para
`POST /api/chat`, cujo contrato aceita `options.num_ctx`. Coder, embeddings, outros consumidores,
modelo default e servidor global não foram alterados.

`ANIMA_PROJECT_PLANNER_CONTEXT_LENGTH` controla o valor por request. Ausente significa `16384`;
quando presente, precisa ser um inteiro decimal positivo estrito e seguro em JavaScript. Valor
vazio, zero, sinal, decimal, whitespace, sufixo ou overflow produz erro de configuração antes de
qualquer tentativa de rede. Não foi imposto teto arbitrário sem evidência do harness/modelo.

## Transporte e compatibilidade

- request nativo: `model`, `messages`, `tools`, `stream:false` e
  `options:{temperature:0,num_ctx}`;
- a rodada forçada continua oferecendo apenas a tool de submit; `/api/chat` não requer nem
  documenta `tool_choice` para esse mecanismo;
- mensagens de retorno de tool usam `tool_name`, e argumentos de tool calls ecoados permanecem
  objetos nativos;
- a resposta nativa é normalizada na fronteira do adapter antes da lógica de planejamento;
- tool calls nativas, chamada textual legada e Hermes/JSON continuam aceitas;
- JSON inválido, `done` não terminal, message ausente/vazia, tool call/arguments malformados,
  ferramenta desconhecida, HTTP não-2xx e timeout falham fechados.

## Provas e invariantes

Os testes usam fetch simulado e verificam endpoint, default 16k, override, configuração inválida
antes da rede, payload acima de 4096 caracteres, opções existentes, histórico nativo,
compatibilidade Hermes/legada e respostas negativas. Nenhuma chamada Ollama/OpenAI foi feita.

- 8 suítes relacionadas ao project planner/config: 162/162 PASS;
- `npm.cmd run typecheck --workspace=apps/web`: PASS;
- `git diff --check`: PASS.

TPC-01 permanece `not_started`: nenhum work item, attempt, paid authority ou provider call foi
criado. Projeção preservada em 33 elegíveis / 0 positivos (8 negativos, 23 inconclusivos, 2 não
atribuíveis). `origin/main` não foi tocada.

## Próximo ponto exato

Após integrar esta unidade em `origin/dev`, uma única materialização governada separada com
`qwen2.5-coder:14b` pode testar o contrato vivo, respeitando a parada humana antes da execução.
