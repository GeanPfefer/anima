# Orquestração de Trabalho

> Fundação arquitetural aprovada. Este documento descreve o domínio futuro; não significa que suas estruturas de banco ou integrações estejam implementadas.

## Motivação

O fluxo usado hoje para construir o próprio Anima já antecipa a experiência desejada: o usuário formula uma intenção, organiza contexto, solicita trabalho a ferramentas especializadas, revisa o resultado e decide o próximo passo. A Orquestração de Trabalho traz gradualmente esse ciclo para dentro do Anima, preservando memória, proveniência e controle humano.

O objetivo não é transformar o produto atual em um gerenciador de tarefas nem fazer desenvolvimento de software engolir as jornadas de vida. A fundação deve ser genérica o suficiente para pesquisa, música, carreira, casa, finanças, aprendizado e outros domínios. O Modo Construção é apenas o primeiro caso de uso porque permite validar o ciclo usando o próprio projeto.

## Uma única interface

O usuário conversa somente com o Anima. Capacidades, modelos e ferramentas operam atrás dessa experiência, sem chats, avatares ou identidades concorrentes.

- Prisma é a capacidade interna de Reflexão Crítica.
- Programação, pesquisa, arquitetura e planejamento são capacidades especializadas.
- Claude e Codex são possíveis executores dessas capacidades.
- Nenhum fornecedor define a linguagem do domínio ou a identidade do produto.

O Anima interpreta, explica, pede aprovação, acompanha o trabalho e apresenta o resultado. Um executor recebe um objetivo delimitado e devolve um resultado; ele não assume a conversa principal.

## Modelo conceitual mínimo

A fonte de verdade futura será baseada em dois conceitos:

### `work_items`

Representa a unidade de trabalho compreendida pelo Anima. Deve preservar o pedido original, a intenção estruturada, o estado atual, o nível de impacto, a capacidade solicitada, o item em foco e referências de contexto/resultados quando aplicável.

Um work item não precisa corresponder a uma única execução. Ele pode atravessar aprovação, execução manual, revisão e correções mantendo a mesma identidade.

### `work_events`

Log append-only de tudo que altera ou explica o ciclo do trabalho. Eventos guardam proveniência, autor, instante e payload tipado. O estado atual de um work item é uma projeção consistente desse histórico, não uma sequência de atualizações arbitrárias feitas por clientes.

Essa dupla evita criar, antes da validação, tabelas independentes para solicitação, tarefa, aprovação, execução, resultado e decisão. Conceitos que demonstrarem ciclo de vida próprio poderão ser normalizados depois.

## Estados propostos

Estados iniciais do item:

```text
proposed → approved → in_progress → review → completed
    │          │             │          └→ changes_requested → in_progress
    │          │             ├→ blocked
    │          └→ cancelled  └→ failed
    ├→ rejected
    └→ cancelled
```

- `proposed`: interpretação estruturada ainda não aprovada.
- `approved`: usuário autorizou o escopo apresentado.
- `in_progress`: há trabalho manual ou execução delimitada em andamento.
- `blocked`: falta informação, autoridade ou dependência externa.
- `review`: resultado disponível para revisão.
- `changes_requested`: usuário pediu ajuste mantendo o item aberto.
- `completed`: resultado aceito e trabalho encerrado.
- `failed`: tentativa terminou sem resultado utilizável; não equivale a rejeição do pedido.
- `rejected`: proposta não foi aceita.
- `cancelled`: trabalho aprovado ou proposto foi encerrado sem conclusão.

Transições serão validadas no servidor. Estados podem ser reduzidos quando F2 detalhar os invariantes, mas não ampliados por conveniência de interface.

## Eventos tipados propostos

O vocabulário inicial deve ser fechado e evoluir por migration/contrato:

- `work_proposed`
- `proposal_revised`
- `work_approved`
- `work_rejected`
- `work_started`
- `context_attached`
- `input_requested`
- `input_provided`
- `work_blocked`
- `execution_started`
- `execution_failed`
- `result_submitted`
- `changes_requested`
- `result_accepted`
- `work_cancelled`

Uma aprovação não é texto livre interpretado como autorização. Ela referencia a proposta e o impacto que o usuário viu. Eventos derivados de uma aprovação são escolhidos e validados pelo servidor.

## Autonomia proporcional ao impacto

O Anima pode estruturar silenciosamente uma intenção e preparar uma proposta reversível. Antes de qualquer ação estrutural, estratégica, financeira, irreversível ou com efeito externo, apresenta o que será feito e aguarda confirmação.

A aprovação deve ser específica ao escopo. Mudança material de objetivo, arquivos, custo, risco ou efeito exige nova decisão. A autorização de uma solicitação não concede autonomia indefinida.

Execuções futuras terão objetivo fechado, limite de tentativas, condição terminal e retorno ao Anima. Executores não conversam indefinidamente entre si.

## Cartões estruturados de decisão

Decisões importantes aparecem dentro da conversa como cartões estruturados, não como formulários de organização manual. Um cartão deve mostrar, conforme o caso:

- ação ou interpretação proposta;
- motivo e evidências;
- impacto e efeitos esperados;
- escopo incluído e excluído;
- capacidade/executor quando relevante;
- alternativas reais;
- ações explícitas de aprovar, rejeitar, corrigir ou adiar.

O cartão é uma projeção conversacional do estado do trabalho. A decisão persistida precisa apontar para a versão exata que foi apresentada.

## Trabalhos ativos e foco do chat

O usuário pode ter vários trabalhos ativos. Isso não cria vários chats de agentes. A conversa mantém um item em foco, inferido pelo contexto e sempre explicitável pelo Anima quando houver ambiguidade.

Mensagens podem continuar o item em foco, mencionar outro item ativo, criar uma nova proposta ou ser apenas conversa/registro de vida sem virar trabalho. Trocar o foco não encerra nem duplica trabalho. Se a referência for ambígua e a decisão alterar estado, o Anima pede confirmação curta antes de associar a mensagem.

## Bootstrap em dois estágios

### Estágio 1 — privado e manual

O Anima entende o pedido, cria uma proposta, recebe aprovação, acompanha estado e registra contexto, resultado e decisões. A execução acontece manualmente fora do app; o pacote é copiado para Codex/Claude e o resultado retorna ao Anima. Isso valida o domínio sem APIs, CLIs, filas ou credenciais.

### Estágio 2 — executores integrados

Somente após o fluxo manual provar utilidade e limites, adaptadores poderão entregar pacotes aprovados a executores. O núcleo continuará conhecendo capacidades e contratos, não fornecedores. Falha de integração não pode corromper o item nem apagar seu histórico.

## Fluxo inicial

```text
mensagem do usuário
→ intenção estruturada
→ proposta de work item
→ aprovação humana
→ pacote de contexto
→ execução manual externa
→ resultado registrado
→ revisão pelo Anima
→ decisão do usuário
→ encerramento
```

Antes das integrações, “execução externa” significa operação manual e explícita. Nenhum processo, API, CLI ou serviço externo será acionado pelo produto.

## Work item não é quest

Quest representa uma jornada, meta ou desafio de evolução pessoal e participa da camada de gamificação. Work item representa trabalho operacional com aprovação, proveniência, execução e resultado.

- Um não é subtipo do outro.
- `quest_id` não entra no schema inicial de orquestração.
- Uma relação futura só será adicionada quando casos reais justificarem seu significado.
- Concluir work item não concede XP automaticamente.
- Qualquer reconhecimento de evolução deve vir das regras existentes de entrada/quest, não da atividade interna de um executor.

## Conversas são arquivadas

A memória bruta é parte da fonte de verdade. A ação visual equivalente a “limpar conversa” deve arquivar ou iniciar um novo contexto visível, sem apagar silenciosamente mensagens, decisões ou proveniência. Exclusão real, se existir, será uma operação distinta, explícita e proporcional ao impacto.

## Emendas técnicas obrigatórias para F2

1. RPCs de escrita serão `SECURITY DEFINER`, com `search_path` fixo e validação explícita de `auth.uid()`.
2. Clientes não terão `UPDATE` direto em `work_items` nem `INSERT`, `UPDATE` ou `DELETE` direto em `work_events`.
3. Criação de proposta, registro de resultado e resolução de aprovação serão transacionais.
4. `resolve_approval` não aceitará tipos arbitrários de eventos derivados enviados pelo cliente.
5. A feature flag inicial será uma allowlist no servidor, não uma coluna editável em `profiles`.
6. `quest_id` não entrará no schema inicial.
7. A RPC validará que `source_message_id` pertence ao usuário autenticado.
8. Nenhuma estrutura de banco é implementada nesta fase de documentação.

## Fora de escopo desta fundação

- migrations, tabelas, enums, views, RPCs ou policies;
- tipos de domínio e serviços de aplicação;
- componentes, rotas, endpoints ou mudanças de navegação;
- APIs, CLIs, filas ou serviços externos;
- execução automática por Claude, Codex ou qualquer outro fornecedor;
- agentes autônomos ou conversas livres entre agentes;
- XP, recompensas ou vínculo inicial com quests;
- catálogo configurável de capacidades;
- migração retroativa de conversas e quests existentes.
