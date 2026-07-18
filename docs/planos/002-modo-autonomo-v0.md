# Plano 002 — Modo Autônomo V0

> Plano incremental derivado do [Marco 003 — Trabalho Autônomo Seguro](../marcos/003-trabalho-autonomo-seguro.md). Documento de planejamento: nenhuma fase está implementada. O backlog detalhado por item vive em [`002-modo-autonomo-v0-backlog.md`](002-modo-autonomo-v0-backlog.md).

Documentos base: [arquitetura da Orquestração de Trabalho](../arquitetura/orquestracao-de-trabalho.md), [Plano 001 — Modo Construção MVP](001-modo-construcao-mvp.md).

## Estado de partida (2026-07-16)

- Comprovado no código: `work_items`/`work_events` transacionais (F2); domínio compartilhado com proposta versionada, evidências tipadas e revisão (F3/F5); ciclo no chat web e mobile com foco (F4/F7); contexto por referências (F6); contrato `WorkExecutorAdapter` + execução limitada e persistida, validada com executor falso, sem UI (F8).
- Comprovado fora do repositório: runner local (projeto separado) com execução isolada, testes como gate de conclusão, feedback iterativo e aplicação somente após gate independente.
- Apenas visão: fila, claim, tentativas persistentes, checkpoint/handoff, supervisor, roteamento de inteligência, cartões de execução.

## Estado das fases

| Fase | Estado | Resultado |
|---|---|---|
| A | Implementada; aceitação ao vivo pendente | ORQ-01–04 implementados e cobertos por core/web/pgTAP; falta repetir o ciclo autenticado no web e em dispositivo mobile |
| B | Não iniciada | — |
| C | Não iniciada | — |
| D | Não iniciada | — |
| E | Não iniciada | — |
| F | Não iniciada | — |
| G | Não iniciada | — |

## Fase A — Fechar a orquestração atual

**Objetivo:** comprovar ao vivo e fechar o ciclo manual existente antes de qualquer autonomia: resultado e evidências visíveis, foco operacional real, revisão transacional de propostas e continuidade entre conversa, cartão, resposta e eventos.

**Pré-requisitos:** F5/F7/F8 do Plano 001 (implementadas; aguardam comprovação funcional ao vivo).

**Entregáveis:** itens ORQ-01 a ORQ-04 do backlog; registro honesto no Plano 001 do que foi comprovado.

**Critérios de aceite:** um ciclo completo (pedido → proposta → aprovação → execução manual → resultado com evidências → revisão → encerramento) comprovado ao vivo em web e mobile, com eventos consistentes e foco estável entre plataformas.

**Evidências obrigatórias:** capturas ou registro da sessão ao vivo; suítes pgTAP/core/web verdes; eventos do ciclo consultáveis por `work_events`.

**Riscos:** tratar "implementado com testes" como "comprovado"; deriva de escopo consertando UX além do necessário.

**Fora do escopo:** qualquer conceito novo do Modo Autônomo; mudanças de schema além de correções do ciclo atual.

### Registro de verificação da Fase A (2026-07-18)

- ORQ-01–03 foram fechados nos commits `c3ec9d8`, `372ab38` e `a01855b`.
- ORQ-04 passou a reabrir a conversa arquivada mais recente sem excluir mensagens, reconstruir cartões a partir de item + eventos + contextos persistidos e bloquear ações quando algum elo obrigatório de proveniência estiver ausente ou inconsistente.
- A corrida entre envio e hidratação foi fechada: o chat não aceita novo turno até concluir a reconstrução; falha de hidratação permanece fail-closed e visível.
- Evidência local: suites core/web verdes, 177 asserções pgTAP verdes, migration aplicada no Supabase local, typecheck e build verdes. O pgTAP percorre arquivar → reabrir → reidratar a sessão preservando mensagens e isolamento por usuário.
- A verificação visual abriu o app web local, mas encontrou apenas a tela de login, sem sessão autenticada disponível. A validação em dispositivo mobile também não foi executada nesta sessão. Portanto, o critério de aceite ao vivo da Fase A ainda não foi declarado cumprido e a Fase B não está formalmente desbloqueada.

## Fase B — Contrato de execução

**Objetivo:** definir, como contrato de domínio (conceito antes de schema), o vocabulário do trabalho autônomo: elegibilidade, tentativa de execução, claim com expiração, checkpoint, handoff, interrupção humana e resultado para revisão.

**Pré-requisitos:** Fase A aceita.

**Entregáveis:** AUTO-01 a AUTO-06; documento de arquitetura estendendo `orquestracao-de-trabalho.md` (ou anexo) com os conceitos e invariantes; tipos de domínio em `packages/core` quando o conceito estabilizar.

**Critérios de aceite:** todo conceito tem definição, invariantes, eventos tipados propostos e regras de transição; nenhum conceito depende de fornecedor; elegibilidade é função pura verificável sobre o estado do item.

**Evidências obrigatórias:** documento revisado; testes de domínio para elegibilidade e invariantes de claim/tentativa quando os tipos existirem.

**Riscos:** desenhar schema prematuro; acoplar o contrato ao runner atual; vocabulário aberto demais para validação no servidor.

**Fora do escopo:** persistência definitiva em banco; supervisor; UI.

## Fase C — WorkExecutorAdapter

**Objetivo:** evoluir o contrato do adaptador para o ciclo autônomo: contrato de entrada delimitado, eventos de progresso, resultado, erro, decisão necessária, cancelamento, idempotência e correlação entre `work_item` e tentativa.

**Pré-requisitos:** Fase B (vocabulário de tentativa e checkpoint definido).

**Entregáveis:** INT-01 a INT-03; contrato revisado em `packages/core` compatível com o `WorkExecutorAdapter` existente ou o substituindo por migração explícita.

**Critérios de aceite:** um executor falso exercita todo o contrato (progresso, decisão necessária, erro, cancelamento, resultado) em testes; reexecução da mesma tentativa é idempotente; todo evento carrega correlação item/tentativa/versão aprovada.

**Evidências obrigatórias:** testes de contrato no core; documentação do contrato.

**Riscos:** contrato inchado antes do primeiro uso real; vazamento de detalhes de Ollama/Docker/Python para o domínio.

**Fora do escopo:** transporte real (API/CLI/fila); integração com o runner.

## Fase D — Integração mínima

**Objetivo:** primeira execução real sob comando: um `work_item` aprovado, início manual pelo usuário, uma tentativa, execução em workspace isolada, retorno de evidências e revisão humana antes de qualquer aplicação.

**Pré-requisitos:** Fases B e C; autorização explícita do usuário para a integração externa (regra do AGENTS.md).

**Entregáveis:** INT-04; um adaptador concreto (fora do core) que entrega o pacote aprovado a um executor real e traduz o retorno para o contrato.

**Critérios de aceite:** o ciclo inteiro acontece dentro do produto exceto a execução em si; evidências e resultado chegam tipados ao item; falha da integração não corrompe o item nem apaga histórico; nenhuma aplicação sem revisão.

**Evidências obrigatórias:** registro de uma execução real de ponta a ponta; eventos correlacionados persistidos; testes do adaptador com executor simulado.

**Riscos:** depender de detalhes do runner; segredos ou caminhos locais vazando para eventos; “só mais um atalho” virando fila informal.

**Fora do escopo:** fila, supervisor, seleção automática de executor, paralelismo, aplicação automática.

## Fase E — Supervisor V0

**Objetivo:** o primeiro laço autônomo: fila persistente de itens elegíveis, escolha do próximo item, claim exclusivo, um trabalho por vez, pausa, retomada e recuperação de claims expirados.

**Pré-requisitos:** Fase D comprovada ao vivo.

**Entregáveis:** SUP-01 a SUP-04; AUTO-05 comprovado (retomada real após interrupção).

**Critérios de aceite:** com N itens elegíveis, o supervisor executa um por vez na ordem definida; interrupções (processo morto, Docker fora, limite de provedor) deixam checkpoint e a retomada continua do último estado válido; claim expirado é recuperado sem duplicar execução.

**Evidências obrigatórias:** cenário de interrupção forçada documentado com evidências; testes de recuperação de claim.

**Riscos:** duplo processamento por claim mal desenhado; supervisor virando scheduler genérico antes da hora.

**Fora do escopo:** paralelismo geral; múltiplos projetos simultâneos; priorização sofisticada.

## Fase F — Uso sustentável de inteligência

**Objetivo:** transformar em mecanismo a visão "leve para operar, médio para construir, forte para decidir": classificação de complexidade e risco, escolha inicial de executor, escalonamento após falhas, redução depois de plano consolidado, reserva de capacidade e rastreabilidade da decisão.

**Pré-requisitos:** Fase E operando; histórico de tentativas persistidas suficiente para calibrar.

**Entregáveis:** INTEL-01 a INTEL-04.

**Critérios de aceite:** toda seleção de executor/modelo/esforço é registrada com os fatores considerados; escalonamento acontece por regra explícita após falhas; existe reserva de capacidade que impede o modo autônomo de esgotar o provedor do usuário.

**Evidências obrigatórias:** decisões de roteamento consultáveis por tentativa; cenários de escalonamento e redução testados.

**Riscos:** otimização prematura; regras opacas que o usuário não consegue auditar.

**Fora do escopo:** aprendizado automático de política; leilão entre provedores; otimização de custo por token como objetivo primário.

## Fase G — Experiência no chat

**Objetivo:** projetar o Modo Autônomo na conversa: cartões de execução com progresso, checkpoint, decisão necessária e resultado para revisão, com ações de aprovar, pedir alterações, pausar e cancelar — mantendo o chat como entrada única.

**Pré-requisitos:** Fases D–E (há o que exibir); pode começar em paralelo com E para o subconjunto da Fase D.

**Entregáveis:** UX-01 a UX-04.

**Critérios de aceite:** o usuário acompanha e decide tudo pela conversa; cada cartão é projeção do estado persistido (nunca estado próprio); decisões apontam para a versão exata apresentada; histórico permite retomar um trabalho antigo pelo chat.

**Evidências obrigatórias:** testes de componente; ciclo ao vivo conduzido inteiramente pelo chat.

**Riscos:** cartão virar formulário; UI inventar estado; excesso de notificação quebrando o princípio de interrupção mínima.

**Fora do escopo:** telas dedicadas de gerenciamento; dashboards; notificações push.

## Dependências entre fases

```text
A (fechar fundação)
└→ B (contrato de execução)
   └→ C (adaptador)
      └→ D (integração mínima, sob comando)
         ├→ E (supervisor V0)
         │  └→ F (inteligência sustentável)
         └→ G (experiência no chat — subconjunto de D; completa com E)
```
