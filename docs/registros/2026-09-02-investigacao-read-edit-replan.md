# Investigação READ → EDIT do replan PIN-02

Sessão de investigação, após publicação explicitamente autorizada de `154089f`.
HEAD inicial/final: `154089f38b63f62718aa28fba9679f47fb437320`, branch dev.
Push FF `9f214f8 → 154089f` concluído; dev=origin/dev; origin/main confirmado
remotamente em `99bec54e3ab42bfe882a8686cd1385d8058b916e`. Working tree rastreada
limpa após o push, antes destas notas locais. Nenhum novo commit/push nesta investigação.

## Diagnóstico corrigido contra o checkpoint

`1ee1921:packages/core/src/project-intake.ts` exporta serializeProjectIdeaV0 e
deserializeProjectIdeaV0. O teste não os importa. A afirmação de inexistência desses
exports no diagnóstico persistido é falsa, como registrado na
[reconciliação](2026-09-02-reconciliacao-final-replan.md). O diagnóstico correto é:
imports ausentes, chamadas fora do contrato tipado e provas inadequadas/duplicadas.
Round-trip deve atravessar serialize → deserialize; negativos da desserialização
recebem texto JSON. draftProjectIdea + validateProjectIdea não prova esse round-trip.
Nenhuma correção foi escrita no banco, no event log ou nos arquivos da attempt.

## Reconstrução demonstrável

Attempt `ab7e7b6f-258e-4637-b2e1-a9be60c810de`, successor `7b132de5`.
Eventos UTC (2026-09-03; noite local de 2026-09-02):

1. `00:58:16.067`: execution_started (`bf6a085d`), retomada de `1ee1921`.
2. Primeira chamada ao coder aplica uma edição; `00:58:51.423` registra checkpoint
   (`369b54a0`). Commit `967008e54fe890a3920af805384e1915aef7d524`: +21 linhas,
   exclusivamente project-intake.test.ts; implementação inalterada.
3. A edição adiciona testes e um `});` extra antes do antigo segundo teste.
   Os imports ausentes permanecem; provas antigas duplicadas também permanecem.
   Análise sintática offline com TypeScript createSourceFile sobre os blobs Git:
   `1ee1921` sem erro sintático; `967008e` com dois TS1128 na linha 88.
   Isso demonstra defeito novo, não apenas repetição do problema de imports.
4. Gate Project Intake focado: exit 1, 3768 ms, sem timeout/cancelamento
   (evento `06bf8b1b`, persistido após o terminal). Não há gate typecheck observado.
5. Pelo fluxo de worktree-executor, gate falho habilita reparo interno, que chama
   backend.edit novamente e relê o arquivo atual. O erro terminal é desta fase:
   `00:59:09.534`, evento `07664942`, replace_exact com before encontrado zero vezes.
6. O executor restaura o checkpoint durável ao capturar a exceção; Git observado
   `b29b866f` confirma `967008e`. Claim liberado. Failed, 1/1, sem resultado/Verifier.

A sequência de chamadas READ solicitadas pelo modelo não foi preservada nos eventos.
Não confundir leitura inicial do host (sempre acontece) com action:read do modelo:
não há prova de quantas rodadas ele pediu, nem de quais trechos recebeu.

## Por que zero ocorrências: conclusão e limites

Código de execução examinado em ae6d6d9; ollama-coder.ts e ollama-protocol.ts não
têm diferença até 154089f. applyEditOperations verifica o hash **antes** de contar
ocorrências. Portanto, o hash informado na operação recusada bateu com o snapshot
em memória, mas o before não casou com ele sob a tolerância de fim de linha.

| Hipótese | Evidência/conclusão |
|---|---|
| Hash stale | Não foi o erro: produziria ollama_stale_file_hash antes da contagem. |
| READ do host stale entre rodadas | Leitura, manifesto, trechos e aplicação usam o mesmo cache imutável por chamada. O repair cria cache novo. Não há evidência de troca de snapshot interna. Texto antigo combinado com hash atual pelo modelo ainda é possível. |
| CRLF versus LF apenas | Comparador já aceita CRLF/LF. Essa diferença isolada não explica zero. |
| Espaços, aspas, números de linha copiados, outros caracteres | Continuam exatos; poderiam explicar zero, mas before não está disponível para comparação. |
| Âncora inventada ou de outra versão | Possível, não demonstrada. Não há payload literal da operação. |
| Truncamento | Existe guarda heurística de prompt e limites de trechos. Não houve erro de truncamento, mas isso não prova ausência de perda parcial de contexto: faltam metadados e trechos servidos. |
| Operações sequenciais dependentes no mesmo lote | Todas são validadas contra o snapshot original; before que depende de outra operação poderia falhar. Sem o lote, permanece hipótese. |

O corpo before não é incluído na exceção. callProtocol e callOllamaChat mantêm
prompts/respostas em memória, sem persistência de transcript na implementação
examinada. Eventos user-scoped, artefatos de .worktrees, logs residentes temporários
e logs locais do Ollama examinados não forneceram transcript correlacionado.
Logo **não é possível fechar a causa textual exata retrospectivamente com a evidência
disponível**. A causa imediata está demonstrada; escolher uma hipótese acima seria inventar.

## Verificação, invariantes e próxima barreira

Suíte offline ollama-protocol: 50/50, incluindo hash stale, ocorrência ausente,
CRLF/LF e guarda de truncamento. A análise dos blobs não executou a tarefa nem
modificou as branches. Branch histórica continua `1ee1921ec1c4dddfdfb74dfeb953d59e4a7e6083`.
Nenhuma nova attempt/successor/aprovação, nenhum Resident Host ou modelo acionado,
nenhuma mutation no banco/event log, nenhuma publicação adicional.

Diagnóstico factual do codec fechado; causa literal da âncora bloqueada por evidência
ausente. Para fechar esta última, é necessário recuperar um transcript original
READ/EDIT com before, hashes e snapshot. Instrumentar uma futura observação seria
trabalho novo e não recuperaria automaticamente a causa desta attempt; não foi feito.
Não iniciar outra execução, ampliar budget nem atribuir causa exclusiva ao 14b.
