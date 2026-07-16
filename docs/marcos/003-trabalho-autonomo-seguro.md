# Marco 003 — Trabalho Autônomo Seguro

> Registro histórico. **Append-only** — mudanças futuras devem criar um novo marco, sem apagar a decisão registrada aqui. Este documento registra uma decisão humana de direção; a especificação técnica vive no [Plano 002](../planos/002-modo-autonomo-v0.md) e no backlog associado.

**Data:** 2026-07-16

---

## Contexto

A fundação da Orquestração de Trabalho (Marco 002, fases F2–F8 do Plano 001) já permite representar propostas versionadas, aprovações específicas ao escopo, acompanhamento de estado, evidências tipadas de resultado e revisão humana — tudo sobre `work_items` e `work_events`, com um contrato de executor limitado (`WorkExecutorAdapter`) provado por testes, ainda sem executor real conectado.

Em paralelo, um POC separado do repositório — o runner local — comprovou na prática o outro lado do ciclo: execução isolada em workspace temporária, testes como condição de conclusão, feedback estruturado de falhas ao modelo, correção iterativa, validação fail-closed e aplicação de mudanças somente após um gate final independente, com a workspace original intacta em qualquer falha.

As duas metades existem, mas não se tocam. Todo trabalho ainda depende de operação manual contínua: o usuário conduz cada execução, transporta contexto e resultado, e nada sobrevive à interrupção de uma sessão sem esforço humano de reconstrução.

**O próximo passo não é autonomia irrestrita.** O próximo passo é permitir que trabalhos explicitamente aprovados possam ser executados e retomados com segurança, sem supervisão constante — mantendo o usuário como fonte de intenção e decisão.

## Definição do Modo Autônomo

O Modo Autônomo é uma capacidade permanente do Anima que:

- mantém uma fila de trabalhos elegíveis;
- escolhe o próximo item seguro;
- reivindica o trabalho com exclusividade;
- executa dentro dos limites aprovados;
- valida o que produziu;
- registra evidências verificáveis;
- produz um checkpoint transferível;
- continua enquanto houver trabalho elegível;
- interrompe o usuário somente diante de uma decisão realmente humana.

Autonomia não significa independência da intenção do usuário. O Modo Autônomo executa intenção já aprovada; ele nunca a origina, amplia ou reinterpreta por conta própria.

## Princípio central

> **O Anima pode continuar trabalhando sem supervisão constante, mas nunca sem intenção aprovada, limites explícitos e evidências verificáveis.**

## Elegibilidade

Um trabalho só pode entrar na execução autônoma quando possuir:

- versão aprovada da proposta;
- escopo concreto (o que entra e o que não entra);
- resultado esperado descrito;
- capacidade executora identificada;
- alvo conhecido (projeto, workspace ou recurso);
- permissões explícitas para o que a execução exige;
- critérios de validação verificáveis;
- limites de tentativa, tempo ou recurso;
- nenhuma decisão humana pendente.

Propostas vagas não são "melhoradas" silenciosamente pela execução: voltam para refinamento na conversa ou permanecem bloqueadas.

## Claim exclusivo

Cada trabalho em execução exige uma reivindicação exclusiva e temporária (claim com expiração). Dois braços — humanos ou automáticos, locais ou remotos — nunca executam o mesmo item simultaneamente. Um claim expirado pode ser recuperado; um claim ativo não pode ser tomado.

## Tentativas persistentes

Execução não é um estado amorfo: é uma sequência de tentativas registradas. Cada tentativa deve registrar:

- executor;
- provedor e modelo, quando aplicável;
- nível de esforço;
- início e término;
- workspace ou ambiente utilizado;
- comandos e ações relevantes;
- arquivos ou recursos afetados;
- testes e validações executados, com resultado;
- consumo ou disponibilidade conhecida de recursos;
- resultado da tentativa;
- razão de pausa, bloqueio ou falha;
- checkpoint ou artefato de handoff produzido.

## Handoff obrigatório

Nenhum trabalho relevante pode existir apenas na memória privada de um executor. Toda tentativa deve produzir um estado transferível — commit, branch, patch, artefato, checkpoint estruturado, relatório de diagnóstico ou evidência persistida — suficiente para que outro braço (ou o mesmo, depois de reiniciar) continue de onde parou.

## Pausa e retomada

O sistema deve sobreviver a:

- limite de uso de Claude, Codex ou outro provedor;
- encerramento da aplicação;
- reinicialização da máquina;
- indisponibilidade de Docker ou Ollama;
- falha de rede;
- falha do modelo;
- troca de executor.

Retomar significa partir do último checkpoint válido e das evidências persistidas — nunca confiar apenas no contexto conversacional anterior de um executor.

## Interrupções humanas

O Anima deve interromper o usuário apenas diante de:

- mudança de escopo;
- decisão arquitetural com alternativas reais;
- ação destrutiva;
- uso de segredo ou credencial sensível;
- conflito de requisitos;
- permissão ausente;
- aprovação final para integrar, publicar ou mergear;
- incapacidade persistente depois dos limites estabelecidos.

Tudo o que não está nessa lista é trabalho do sistema, não do usuário. O usuário aprova intenção e limites; não aprova cada comando seguro.

## Execução separada de integração

Produzir uma alteração não equivale a integrá-la. Execução, revisão, aplicação, merge e publicação continuam sendo decisões ou etapas separadas. O Modo Autônomo pode produzir resultados prontos para revisão; a integração relevante permanece atrás de decisão humana ou gate explícito.

## Orquestração sustentável de inteligência

Fica registrado como visão formal — não como compromisso da primeira versão — que o Anima deverá selecionar automaticamente:

- executor;
- provedor;
- modelo;
- nível de esforço;
- momento de escalonamento;
- momento de redução;
- uso de capacidade local ou externa.

A decisão deve considerar: complexidade, risco, reversibilidade, clareza do plano, urgência, falhas anteriores, recursos da máquina e disponibilidade e limites dos provedores.

> **Leve para operar, médio para construir, forte para decidir, destravar e revisar.**

O objetivo não é minimizar tokens isoladamente, mas maximizar progresso confiável por unidade de recurso.

## Limites da primeira versão

A V0 do Modo Autônomo começa deliberadamente estreita:

- apenas trabalhos explicitamente aprovados;
- um trabalho ativo por projeto ou workspace;
- execução local;
- sem paralelismo geral;
- sem publicação automática;
- sem merge automático;
- sem uso autônomo de segredos;
- sem autonomia para redefinir o próprio escopo;
- revisão humana ou gate explícito antes de qualquer integração relevante.

## Relação com o runner

O runner permanece como projeto separado. O Anima representa intenção, aprovação, estado, decisões e experiência do usuário; o runner executa uma tentativa dentro de limites fornecidos. A comunicação futura ocorrerá por contrato/adaptador (`WorkExecutorAdapter` e evoluções), sem o Anima depender dos detalhes internos de Python, Ollama ou Docker — coerente com o princípio de que executores são substituíveis e nunca personagens do produto.

## Consequência da decisão

A partir deste marco, o backlog deve priorizar contratos, persistência, handoff, integração mínima e supervisão segura **antes** de paralelismo ou otimização avançada. A ordem é: fechar a fundação atual, definir o contrato de execução, integrar um executor de forma mínima e comandada pelo usuário, e só então introduzir fila e supervisor.

## Referências

- [`../../anima-manifesto.md`](../../anima-manifesto.md)
- [`../arquitetura/orquestracao-de-trabalho.md`](../arquitetura/orquestracao-de-trabalho.md)
- [Plano 002 — Modo Autônomo V0](../planos/002-modo-autonomo-v0.md) e [backlog associado](../planos/002-modo-autonomo-v0-backlog.md)
- [Marco 002 — Anima constrói Anima](002-anima-constroi-anima.md)
- [Marco 001 — Nascimento da Identidade do Anima](001-nascimento-da-identidade.md)
