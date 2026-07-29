# Planos de implementação — Anima

> Índice dos planos incrementais. A presença de um tema neste índice não torna
> toda a visão backlog imediato: cada plano declara seu próprio nível de
> maturidade, dependências e checkpoints humanos.

## Planos existentes

| Plano | Estado | Objetivo |
|---|---|---|
| [001 — Modo Construção MVP](001-modo-construcao-mvp.md) | Concluído | Comprovar a Orquestração de Trabalho dentro da conversa |
| [002 — Modo Autônomo V0](002-modo-autonomo-v0.md) | Concluído até a Fase F; Fase G sucede no Plano 003 | Executar intenção aprovada com limites, evidências, retomada e uso sustentável de inteligência |
| [003 — Experiência Operacional](003-experiencia-operacional.md) | Próximo plano | Projetar execução, decisões, resultados e retomada no chat |
| [004 — Nós Locais e Portabilidade](004-nos-locais-e-portabilidade.md) | Direção aprovada; requer refinamento arquitetural | Separar contexto pessoal portável de capacidades autorizadas em cada máquina |
| [005 — Anima Conversacional e Semântico](005-anima-conversacional-e-semantico.md) | Direção aprovada; requer refinamento | Evoluir continuidade, memória relevante e qualidade da conversa |
| [006 — Consolidação Multiplataforma Chat-First](006-consolidacao-multiplataforma-chat-first.md) | Direção aprovada; depende do Plano 005 | Projetar as mesmas capacidades no web e no mobile com regras compartilhadas |

## Sequência aprovada

```text
Plano 003 — Experiência Operacional
        ↓
Plano 004 — Nós Locais e Portabilidade
        ↓
Plano 005 — Anima Conversacional e Semântico
        ↓
Plano 006 — Consolidação Multiplataforma Chat-First
        ↓
Checkpoint estratégico antes de definir qualquer Plano 008
```

O antigo candidato de um plano dedicado ao Prisma não faz parte desta
sequência. Reflexão crítica pode existir como comportamento do próprio Anima,
mas não é foco atual, capacidade independente prioritária nem persona
concorrente.

## Régua para liberar trabalho a um executor

Um item só está pronto para implementação quando possuir:

- problema e resultado esperado;
- dependências satisfeitas;
- escopo incluído e excluído;
- contratos e invariantes preservados;
- critérios de aceite verificáveis;
- testes e evidências obrigatórias;
- riscos e condições de interrupção;
- checkpoint humano quando houver decisão material;
- handoff persistente esperado.

Itens sem essa régua permanecem em refinamento, ainda que sua direção de
produto já esteja aprovada.
