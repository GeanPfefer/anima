# Plano 003 — Ergonomia de Âncora de Edição R2

**Status:** Ativo — investigação ratificada em 2026-08-25.
**Autoridade:** Gean autorizou a investigação R2. Promoção para produção exige prova e nova decisão explícita.
**ADR:** `docs/arquitetura/adr-004-ancora-de-edicao-host-mediada.md`

## Objetivo

Determinar experimentalmente se uma âncora host-mediada reduz a fragilidade do coder local ao passar de leitura para edição, sem perder nenhuma propriedade fail-closed do protocolo atual.

Pergunta experimental:

Dado o mesmo modelo, mesma tarefa, mesmos limites e mesmo conteúdo servido, trocar a reconstrução byte-exata de `before` por uma referência opaca a um trecho que o host já serviu aumenta a taxa de edições válidas sem reduzir segurança?

## Evidência que abriu o plano

### Successor A real

Work item:

`27c8d1ba-e37f-4587-8838-0aa7e6f7e618`

Attempt 1:

`311ec98b-9746-4868-bc12-c48bd486dd58`

Desfecho:

`ollama_read_round_limit`

O coder rodou por aproximadamente 34,8 s e falhou antes de qualquer gate.

### Trace diagnóstico sem consumir attempt

Com o objetivo persistido e o mesmo backend:

1. pediu `selectWorkRoute`;
2. pediu linhas 120–140;
3. pediu novamente a região 126–180;
4. na rodada com zero leituras restantes pediu novamente a mesma leitura.

Nenhum evento canônico foi escrito por esse diagnóstico e a attempt 2 não foi consumida.

## Hipótese

H-R2:

Uma referência host-mediada a um trecho previamente servido reduz o custo cognitivo e mecânico de produzir uma edição verificável e, portanto, pode reduzir `read-stalling` e falhas de âncora sem afrouxar o contrato.

É uma hipótese, não uma conclusão.

## Variável experimental

### Controle A

Protocolo atual:

`replace_exact(path, expected_file_sha256, before, after)`

### Tratamento B

Mesmo protocolo de leitura e mesmos limites, acrescentando uma operação experimental que referencia uma âncora emitida pelo host:

`replace_anchor(anchor_id, after)`

O host mantém internamente:

- path;
- SHA do arquivo;
- intervalo servido;
- hash do conteúdo bruto do intervalo;
- ciclo ou execução ao qual a âncora pertence.

Nesta primeira comparação, NÃO alterar simultaneamente:

- `maxReadRounds`;
- `operationalContextCap`;
- `numPredict`;
- modelo;
- temperatura;
- gate;
- escopo;
- roteamento;
- Resource Governor;
- executor;
- política de retry.

Uma variável por vez.

## Fase A — contrato puro experimental

Implementar somente em seam isolado e testável:

- representação efêmera de `ServedAnchor`;
- emissão determinística de `anchorId`;
- parser da operação experimental;
- resolução da âncora;
- verificação de:
  - existência;
  - pertencimento ao ciclo;
  - path;
  - SHA;
  - intervalo;
  - conteúdo original;
  - limites;
  - sobreposição;
  - mudança real.

Nenhuma ligação ao backend de produção nesta fase.

### Gates da Fase A

Testes devem provar pelo menos:

- âncora válida aplica exatamente o intervalo esperado;
- ID inexistente falha fechado;
- ID de outra sessão falha fechado;
- SHA divergente falha fechado;
- conteúdo do intervalo divergente falha fechado;
- path fora do escopo nunca pode ser obtido por âncora;
- range inválido falha fechado;
- operações sobrepostas falham fechado;
- `after` fora do limite falha fechado;
- no-op falha fechado;
- conteúdo não tocado permanece byte a byte;
- `replace_exact` permanece inalterado.

## Fase B — backend experimental

Criar configuração de teste que permita ao `OllamaCoderBackend` anunciar a operação experimental sem torná-la default.

Proibições:

- não substituir o caminho de produção;
- não alterar a semântica de `replace_exact`;
- não consumir retry canônico do Successor A;
- não persistir resultado experimental como execução real;
- não modificar item, claim ou attempt no banco.

## Fase C — A/B sintético

Reusar fixtures versionadas do coder evidence quando possível.

Para A e B manter iguais:

- modelo;
- ordem;
- seed, se disponível;
- temperatura;
- contexto;
- orçamento;
- objetivo;
- escopo;
- arquivos;
- hardware sempre que possível.

Registrar por execução:

- accepted ou failed;
- achieved;
- código de falha;
- reads;
- rodada da edição;
- `prompt_eval_count`;
- `eval_count`;
- duração;
- operação escolhida.

A execução bruta precisa ser preservada de forma auditável.

## Fase D — A/B na fixture realista do Successor A

Usar cópia, scratch ou worktree descartável no SHA apropriado.

Não consumir a attempt 2.

Executar primeiro o controle atual e depois o tratamento experimental sob condições equivalentes, com repetições suficientes para não concluir a partir de uma única amostra.

Critério mínimo de interesse:

- tratamento B consegue produzir edição host-aceita onde A reproduz read-stalling;

ou

- reduz significativamente releituras ou falhas de âncora sem introduzir nova classe de violação.

Um único sucesso não promove produção.

## Fase E — decisão

Após as provas, produzir registro contendo:

- dados brutos;
- matriz A/B;
- falhas por classe;
- invariantes exercitados;
- limitações;
- recomendação.

Possíveis decisões:

1. rejeitar R2;
2. iterar R2;
3. promover de forma estreita, exigindo nova ratificação humana;
4. manter ambos e rotear por classe ou capacidade, se a evidência justificar.

## Fronteira da attempt 2

A attempt 2 do Successor A é recurso de prova canônica e deve permanecer intacta durante as Fases A a D.

Somente depois de eventual promoção devidamente testada, ou de outra decisão humana, avaliar se há base legítima para nova tentativa canônica.

Nunca alterar o estado do item diretamente para fazer a prova passar.

## Não objetivos

Este plano não autoriza:

- aumentar rodadas para mascarar a falha;
- trocar modelo ou default;
- usar OpenAI;
- provisionar nó remoto;
- gastar crédito;
- PR, merge ou deploy;
- auto-integração;
- afrouxar Resource Governor;
- excluir arquivos;
- editar workspace principal;
- limpar `.worktrees/`;
- reescrever histórico Git.

## Próximo passo exato

Implementar a Fase A exclusivamente como contrato puro experimental e testes, sem ligar a operação ao `OllamaCoderBackend` de produção.

Depois executar os testes focados antes de qualquer Fase B.

## Continuação — 2026-08-28: proveniência e transição read → edit

O estado real posterior às Fases A–D mostrou que R2 sozinho não resolvia o
`read-stalling`. Foi fechado um recorte anterior à âncora, sem promover R2:

- `ServedRead` preserva a proveniência normalizada da solicitação e seu modo
  efetivo, sem alterar o slice;
- o protocolo apresenta `search` e `lineRange` como modos exclusivos. O prompt
  anterior ensinava ambos no mesmo objeto, embora `extractSlice` desse
  precedência silenciosa a `search`;
- o host deduplica trechos byte-identicamente repetidos no contexto e informa
  contagens de requests, trechos novos e repetições;
- o budget permanece em três rodadas e nenhuma guarda fail-closed foi reduzida.

Na fixture `successor_a_realistic`, o controle anterior terminou com quatro
leituras e zero edits. Após o recorte, uma campanha N=3 produziu três edições
host-aceitas, mas nenhuma atingiu o objetivo: o modelo anexou um helper inválido,
não adicionou testes e o predicado semântico recusou 3/3. A regressão focada
ficou verde em `multi_locate`, `structural_add` e `multiline_before` (2/2 cada).

Isso prova a transição read → edit nesse alvo, não prova capacidade de concluir o
trabalho. O próximo ponto exato é investigar qualidade pós-edit e recuperação por
falha de gate observada, sem promover R2 nem consumir a attempt 2 canônica até
existir uma estratégia governada e comprovada.

## Continuação — 2026-08-28: gate → reparo → revalidação

O executor de worktree existente passou a permitir ao Ollama, como já permitia
ao DeepSeek Harness, no máximo um reparo interno no mesmo attempt e worktree.
O contexto deriva exclusivamente do host: gate falho, diagnóstico sanitizado,
arquivos alterados e SHA-256 do diff. Timeout, cancelamento, falha de ambiente ou
preparação, escopo e segurança continuam terminais; diff idêntico após o reparo
encerra por no-progress sem nova rodada de gates. OpenAI permanece no limite zero.

A prova viva isolou a variável com patch inicial quebrado determinístico e
reparo real pelo `qwen3-coder:latest`: typecheck passou, teste focado falhou, o
coder reparou uma linha e typecheck + teste passaram na revalidação. Tudo ocorreu
no mesmo attempt/worktree, sem banco e sem consumir a attempt 2 canônica.

Próximo ponto exato: confirmar gates amplos e decidir humanamente se a evidência
é suficiente para usar a attempt 2; esta continuação não promove R2.

## Continuação — 2026-08-28: attempt 2 canônica

A decisão humana autorizou consumir a attempt 2 do Successor A. O estado vivo
confirmou 1/2 e distinguiu corretamente esse successor da attempt 2 histórica do
item original. O retry RPC persistiu `retry_authorization` e o Resident Host
in-process abriu a attempt `de724bcb-2a55-4d1e-b432-989e62d064c6`.

A prova, porém, falhou antes do coder: o invocador ad hoc chamou o porto via
`node -e` na raiz, enquanto `projectRoot()` pressupõe o cwd `apps/web` usado pelo
script npm, resolvendo `G:\` em vez de `G:\anima`. A criação da worktree falhou
com `not a git repository`; não houve reads, edit, gates, repair ou Verifier.
O evento terminal foi preservado e o item ficou 2/2. Não foi criado retry extra,
successor automático ou correção de estado.

Próximo ponto exato: decisão humana sobre uma nova unidade governada de prova;
a attempt 2 não pode ser repetida sem reescrever história.

## Continuação — 2026-08-28: successor após correção ambiental

O root deixou de depender de `cwd=apps/web`: a descoberta sobe somente pelos
ancestrais até encontrar marcadores do Anima; override explícito inválido e cwd
fora da árvore falham fechados. Regressões 41/41 e typecheck web passaram.

O successor `f7d50d04-b41d-4da8-bae9-6fedfea12335` foi criado com lineage
`9ea51dcf-f7e0-470f-8411-be080abee5ee`. A attempt
`3850dc97-5651-49cd-9777-926a7e6caeef` criou worktree, produziu edit e falhou no
gate focado. O único repair ocorreu na mesma attempt/worktree, mas não produziu
mudança efetiva (`ollama_no_effective_edits`); não houve re-gate nem Verifier.

A recovery policy retornou `human_required/failure_not_classified` com 1/2
attempts usadas. A segunda attempt foi preservada. Próximo ponto exato: decisão
humana sobre retry ou classificação desse terminal; não promover R2.

## Continuação — 2026-08-29: no-progress repetido e checkpoint Git durável

O estado real posterior já continha a classificação
`ollama_no_effective_edits → no_progress` e a segunda attempt canônica
`fb79667c-dc13-4122-b094-1c3be10ce2fc`. Ela repetiu a cadeia observada:
edit inicial, gate focado falho e repair sem mudança efetiva. O successor
`f7d50d04…` permanece `failed`, agora 2/2; repetição classifica como
decomposição, nunca como uma attempt extra.

A reconciliação encontrou uma violação independente de handoff: ambos os
checkpoints diziam referenciar a branch da attempt, mas a branch continuava no
SHA-base e a worktree descartável já não existia. O executor agora cria um
commit local de checkpoint antes dos gates. Diffs, arquivos alterados e numstat
continuam calculados contra o SHA-base autorizado; um repair bem-sucedido cria
o estado final, enquanto um repair que lança erro volta ao commit do checkpoint,
descarta somente sua mutação parcial e preserva o edit anterior. Nenhum gate foi
afrouxado e falha não vira resultado.

Próximo ponto exato: formular uma decomposição governada que use a evidência
repetida e, numa nova prova autorizada, verificar que um terminal após checkpoint
mantém branch/diff retomáveis antes de perseguir re-gate e Verifier.

## Continuação — 2026-08-29: correção de review por retomada

O item real `71445254…` materializou uma correção governada a partir de
`c89765a`, reduzida exclusivamente a `chat-surface.test.ts`. A prova encontrou e
corrigiu três lacunas gerais antes de atravessar a execução: classificação de
successor pela lineage sem copiar proveniência ao intent, enforcement de escopo
contra o delta da attempt (não contra o diff herdado) e nova sequência idempotente
após successor terminal. O retry também passou a preferir o checkpoint Git mais
recente da própria unidade, mantendo a base autorizada original.

A prova canônica não concluiu: o coder adicionou duas vezes o mesmo teste fora do
`describe`; gate falhou e repair não produziu mudança. A terceira attempt retomou
corretamente `755cf95`, mas terminou sem edit. O successor `fafd7af1…` ficou
`failed`, 3/3, sem Verifier. `chat-surface.ts` permaneceu byte a byte igual a
`c89765a` em todas as attempts.

Próximo ponto exato: investigar, em seam isolado e sem nova attempt canônica, por
que o repair do Ollama não moveu o teste para o escopo léxico existente apesar do
diagnóstico de gate; só depois criar nova unidade governada.
