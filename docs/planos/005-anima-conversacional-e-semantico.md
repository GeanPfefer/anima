# Plano 005 — Anima Conversacional e Semântico

> **Estado:** direção aprovada. O contrato conversacional, as avaliações e as
> políticas de memória devem ser refinados antes da implementação ampla.

## Objetivo

Permitir uma conversa natural, contínua e contextual com o Anima, apoiada por
memória semântica relevante e corrigível, sem exigir que o usuário organize
manualmente sua vida ou reconstrua contexto a cada sessão.

O foco não é criar uma persona Prisma. Reflexão crítica pode aparecer como um
comportamento do próprio Anima quando útil, mas não é capacidade independente
prioritária neste plano.

## Resultado de produto desejado

O usuário deve poder:

- conversar sem transformar cada mensagem em registro ou comando;
- mudar e retomar assuntos naturalmente;
- perceber continuidade entre sessões;
- corrigir o que o Anima entendeu ou lembrou;
- perguntar por que uma lembrança foi considerada;
- confiar que fatos, hipóteses e interpretações não são confundidos;
- receber respostas úteis sem repetição ou excesso de contexto.

## Backlog inicial

### CONV — Qualidade da conversa

- CONV-01 — Contrato da conversa do Anima
- CONV-02 — Respostas naturais além do registro operacional
- CONV-03 — Continuidade entre mensagens e sessões
- CONV-04 — Referência a assuntos anteriores
- CONV-05 — Mudança natural de assunto
- CONV-06 — Retomada de assunto antigo
- CONV-07 — Distinguir conversa, registro e solicitação de ação
- CONV-08 — Pedir esclarecimento somente quando necessário
- CONV-09 — Explicar compreensão sem virar formulário
- CONV-10 — Coerência de linguagem e identidade do Anima

### SEM — Memória semântica

- SEM-01 — Avaliar o retrieval atual com casos reais
- SEM-02 — Combinar relevância, recência e contexto
- SEM-03 — Distinguir episódio, fato, preferência e hipótese
- SEM-04 — Consolidar registros semanticamente relacionados
- SEM-05 — Detectar contradições e mudanças temporais
- SEM-06 — Corrigir memória pela conversa
- SEM-07 — Evitar repetição de memórias conhecidas
- SEM-08 — Evitar contaminação entre jornadas
- SEM-09 — Preservar proveniência do contexto recuperado
- SEM-10 — Explicar a origem de uma lembrança quando solicitado

### CTX — Montagem de contexto

- CTX-01 — Orçamento explícito de contexto
- CTX-02 — Priorizar conversa atual, foco, memória e identidade
- CTX-03 — Resumir sessões longas sem perder decisões
- CTX-04 — Portar contexto entre dispositivos
- CTX-05 — Isolar contexto de trabalho da vida pessoal
- CTX-06 — Separar fatos persistidos de inferências
- CTX-07 — Admitir ausência de memória suficiente

### ID — Identidade emergente

- ID-01 — Confirmar hipóteses naturalmente pelo chat
- ID-02 — Registrar evidências favoráveis e contrárias
- ID-03 — Reduzir confiança diante de mudança
- ID-04 — Separar estado passageiro de padrão persistente
- ID-05 — Substituir hipóteses sem apagar histórico
- ID-06 — Usar identidade somente quando relevante

### REF — Reflexão integrada, não prioritária

- REF-01 — Linguagem de hipótese e incerteza
- REF-02 — Perguntar de forma reflexiva quando o contexto justificar
- REF-03 — Evitar diretividade e falsas certezas
- REF-04 — Evitar reflexão excessiva ou repetitiva

Esses itens não formam uma persona, tela ou plano separado e podem permanecer
em refinamento até que o uso real demonstre prioridade.

### EVAL — Avaliação cognitiva

- EVAL-01 — Conjunto seguro de conversas para avaliação
- EVAL-02 — Casos de continuidade entre sessões
- EVAL-03 — Casos de memória relevante e irrelevante
- EVAL-04 — Casos de correção e contradição
- EVAL-05 — Casos de mudança e retomada de assunto
- EVAL-06 — Métricas de repetição, utilidade e fidelidade
- EVAL-07 — Comparação controlada entre modelos substituíveis

## Ordem de refinamento

```text
EVAL-01 + CONV-01
        ↓
SEM-01 + CTX-01
        ↓
SEM-02/03/09 + CTX-02/06/07
        ↓
CONV-03/04/05/06/07
        ↓
correção de memória e identidade emergente
```

Avaliações devem nascer antes das mudanças amplas para que “conversar melhor”
não dependa apenas de impressão subjetiva.

## Fronteira multiplataforma

As regras cognitivas e semânticas devem viver em `packages/core`; tipos e
contratos compartilhados, em `packages/types`; garantias persistentes, no
Supabase. Web e mobile devem ser projeções finas da mesma capacidade. Uma prova
inicial no web não autoriza acoplamento permanente ao Next.js.

## Fora do escopo

- nova persona ou chat do Prisma;
- modelo específico como requisito do produto;
- reflexão constante em toda mensagem;
- verdade absoluta inferida da identidade;
- ação externa baseada apenas em memória recuperada;
- integração externa automática.

## Critério de conclusão do plano

Conversas reais demonstram continuidade, recuperação relevante, correção e
proveniência sem repetição excessiva; o comportamento é avaliado de forma
reproduzível e utiliza contratos portáveis para web e mobile.
