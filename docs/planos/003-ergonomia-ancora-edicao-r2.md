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
