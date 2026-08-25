# ADR-004 — Âncora de edição host-mediada para o coder local

**Status:** Aceito para experimento controlado — ratificado por Gean em 2026-08-25.
**Produção:** NÃO promovida. O protocolo vigente continua sendo a autoridade até prova A/B, testes e nova decisão de promoção.
**Data:** 2026-08-25
**Decisor:** Gean

## Contexto

O backend local `OllamaCoderBackend` usa um protocolo limitado e fail-closed:

1. o modelo recebe manifesto sem conteúdo integral;
2. pede trechos limitados;
3. o host serve esses trechos;
4. o modelo propõe operações estruturadas;
5. o host valida escopo, SHA, unicidade, staleness e mudança real;
6. somente então escreve na worktree isolada.

Esse desenho resolveu o problema original de contexto integral e continua sendo a base correta.

O problema aberto é mais estreito: a operação `replace_exact` exige que o modelo reconstrua em `before` uma sequência de bytes que ele acabou de enxergar em um trecho decorado com números de linha.

As campanhas de 2026-08-12 e 2026-08-13 já registraram:

- `before` inexistente (`occ=0`);
- `before` não único;
- erros de indentação;
- `read-stalling`;
- recomendação explícita R2 para estudar uma âncora alternativa;
- exigência explícita de ADR/plano e prova A/B antes de mudar o contrato.

Em 2026-08-25, uma execução canônica real do Successor A falhou antes dos gates com:

`ollama_read_round_limit`

O trace diagnóstico seguinte, sem consumir nova attempt, reproduziu a sequência:

- rodada 1: lê `selectWorkRoute`;
- rodada 2: pede outro intervalo;
- rodada 3: relê a mesma região;
- rodada final, apesar de "DEVE responder agora com edit", pede a mesma leitura outra vez.

O modelo local encontrou a região correta. O gargalo observado está entre inspecionar o alvo e materializar uma edição verificável.

Isso não prova que uma nova âncora resolve o problema. Prova que R2 agora possui uma fixture realista e um modo de falha vivo sobre o qual executar a comparação.

## Decisão

Investigar uma operação de edição host-mediada por âncora de leitura, sem remover nem afrouxar `replace_exact`.

A unidade proposta para o experimento é um `anchorId` opaco emitido pelo host quando um trecho é servido.

Conceitualmente:

    read request
        |
        v
    host resolve path + snapshot
        |
        v
    host serve trecho limitado
        |
        v
    host registra:
      anchorId
      path
      fileSha256
      startLine/endLine
      rawSliceSha256
        |
        v
    modelo referencia anchorId + novo conteúdo
        |
        v
    host revalida tudo
        |
        v
    mudança somente na worktree

O modelo NÃO ganha autoridade sobre os metadados da âncora. Ele apenas referencia uma âncora criada pelo host na mesma execução.

Forma experimental conceitual:

    {
      "action": "edit",
      "operations": [
        {
          "kind": "replace_anchor",
          "anchor_id": "<id opaco fornecido pelo host>",
          "after": "<novo conteúdo>"
        }
      ]
    }

O nome e o schema finais não estão promovidos por este ADR; são parte da prova.

## Invariantes obrigatórios

A alternativa R2 somente é elegível se preservar TODOS os invariantes atuais:

- paths continuam confinados ao `includedScope`;
- nenhum caminho absoluto ou traversal;
- a âncora só pode apontar para trecho efetivamente servido ao modelo;
- a âncora só é válida na execução em que foi criada;
- ela é ligada ao SHA do arquivo lido;
- o host revalida o SHA antes de aplicar;
- o host revalida o intervalo e o conteúdo ancorado;
- âncora inexistente, expirada ou divergente falha fechada;
- operações sobrepostas continuam recusadas;
- zero mudança real continua recusado;
- limite de quantidade e tamanho continua existindo;
- nenhuma exclusão de arquivo é introduzida;
- nenhuma escrita fora da worktree;
- nenhuma alteração direta no workspace principal;
- gates permanecem obrigatórios;
- Verifier permanece independente;
- nenhum PR, merge ou deploy é autorizado por esta decisão;
- nenhum aumento de `maxReadRounds` é consequência automática;
- nenhum modelo é promovido a piso;
- nenhuma permissão financeira ou de egress é criada.

`replace_exact`, `create_file` e `append` permanecem válidos durante o experimento.

R2 adiciona um candidato. Não rebaixa as guardas existentes.

## Por que `anchorId`, e não somente linha + SHA

Uma operação `path + linha inicial/final + SHA` já seria melhor que exigir ao modelo a cópia byte-exata do `before`, mas ainda deixa o modelo reconstruir metadados que o host já conhece.

O `anchorId` reduz essa responsabilidade:

- o host é a autoridade sobre path;
- o host é a autoridade sobre SHA;
- o host é a autoridade sobre o intervalo;
- o host é a autoridade sobre o conteúdo original;
- o modelo escolhe apenas qual trecho já observado deseja transformar e qual conteúdo novo propõe.

É capability-by-reference estreita, não aumento de autoridade.

## O que este ADR NÃO conclui

Este ADR não afirma que:

- R2 resolverá `ollama_read_round_limit`;
- qwen3-coder é suficientemente confiável para toda tarefa;
- números de linha são a causa única;
- `replace_exact` deve ser removido;
- o prompt deve ser alterado em produção;
- o número de rodadas deve aumentar;
- o novo contrato deve virar default.

Tudo isso depende da prova.

## Critério para promoção futura

Uma promoção do R2 para o caminho de produção exige, no mínimo:

1. implementação experimental isolada;
2. regressões unitárias fail-closed;
3. A/B com mesma fixture, modelo e orçamento;
4. comparação de sucesso host-aceito, correção semântica, códigos de falha, número de leituras, rodada da edição, tokens e duração;
5. prova contra o alvo realista do Successor A;
6. nenhum enfraquecimento dos invariantes;
7. decisão humana explícita de promoção.

Até esse ponto, o protocolo atual continua sendo produção.

## Consequências

### Positivas

- desloca trabalho mecânico de exatidão para código determinístico;
- mantém o modelo fora da autoridade de filesystem;
- usa apenas conteúdo que o host já decidiu revelar;
- cria uma hipótese A/B mensurável;
- pode reduzir releituras causadas pela necessidade de reconstruir `before`;
- preserva compatibilidade porque `replace_exact` não é removido.

### Custos e riscos

- novo estado efêmero de âncoras durante uma execução;
- novo ramo de validação no protocolo;
- possibilidade de o modelo escolher uma âncora semanticamente errada;
- possibilidade de não melhorar read-stalling;
- necessidade de provar sobre fixtures pequenas e alvo realista.

O gate semântico e os testes continuam responsáveis por detectar uma edição semanticamente errada.

## Referências

- `adr-001-execucao-local-de-codigo.md`
- `../registros/2026-08-12-campanha-coder-e-hierarquia-interacao.md`
- `../registros/2026-08-12-marcos-006-007-e-evidencia-coder.md`
- `../registros/2026-08-13-harness-versionavel-coder-r3.md`
- `../registros/2026-08-24-governed-retry-resident-host.md`
- `../registros/2026-08-25-item1-successor-slice-v0.md`
- `../planos/003-ergonomia-ancora-edicao-r2.md`