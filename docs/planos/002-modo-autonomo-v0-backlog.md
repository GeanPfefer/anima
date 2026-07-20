# Backlog — Modo Autônomo V0

> Backlog documental do [Plano 002](002-modo-autonomo-v0.md), derivado do [Marco 003](../marcos/003-trabalho-autonomo-seguro.md). Nenhum item está implementado. Itens descrevem a **capacidade necessária** do braço executor, nunca um fornecedor fixo (Claude, Codex e outros são executores substituíveis).

Legenda dos campos compactos: **Tamanho** P/M/G · **Raciocínio** leve/médio/alto · **Checkpoint humano** = exige decisão do usuário dentro do item · **Braço isolado** = executável de ponta a ponta por um único braço com este documento como contexto.

## Priorização

### Agora — fechar a fundação e permitir a primeira execução manual segura

`ORQ-01, ORQ-02, ORQ-03, ORQ-04, AUTO-01, AUTO-03 (mínimo), AUTO-06, INT-01, INT-02, INT-03, INT-04`

### Depois — fila persistente, retomada e supervisor

`AUTO-02, AUTO-03 (completo), AUTO-04, AUTO-05, SUP-01, SUP-02, SUP-03, SUP-04, UX-01, UX-02, UX-03, UX-04`

### Futuro — roteamento sustentável completo, paralelismo e otimizações

`INTEL-01, INTEL-02, INTEL-03, INTEL-04` (e qualquer paralelismo, que não tem item por decisão do Marco 003)

### Sequência recomendada (dependências explícitas)

1. ORQ-01 → ORQ-02 → ORQ-03 → ORQ-04 (Fase A, ordem interna flexível, ORQ-01 primeiro)
2. AUTO-01 → AUTO-06 → AUTO-03 (mínimo: tentativa registrada) (Fase B essencial)
3. INT-01 → INT-02 → INT-03 (Fase C)
4. INT-04 (Fase D — primeira integração estreita)
5. AUTO-02 → AUTO-04 → AUTO-05 (Fase B/E de resiliência)
6. SUP-01 → SUP-02 → SUP-03 → SUP-04 (Fase E)
7. UX-01 → UX-02 → UX-03 → UX-04 (Fase G, UX-01 pode começar após INT-04)
8. INTEL-01 → INTEL-02 → INTEL-03 → INTEL-04 (Fase F)

A primeira integração deve ser estreita, nesta forma exata: um `work_item` aprovado; início explicitamente comandado pelo usuário; um executor; uma tentativa; resultado e evidências; revisão humana; nenhuma fila automática ainda.

---

## ORQ — Fechar a orquestração atual

### ORQ-01 — Resultado e evidências visíveis

- **Problema:** o resultado com evidências tipadas existe no domínio e nos testes, mas o ciclo nunca foi comprovado ao vivo; o usuário ainda não vê, na conversa real, validações e limitações antes de aceitar.
- **Resultado esperado:** em uma sessão real, o resultado de um trabalho aparece no chat com resumo, referências, validações (`passed/failed/declared`) e limitações, e o aceite só é possível sobre a versão apresentada.
- **Dependências:** F5 do Plano 001 (implementada). **Escopo:** comprovação ao vivo web; correções pontuais do fluxo existente. **Fora do escopo:** novos tipos de evidência; UI nova.
- **Aceite:** ciclo real com resultado exibido e aceite registrado em `work_events` apontando a versão exata; resultado antigo não habilita aceite.
- **Evidências:** registro da sessão ao vivo; suítes existentes verdes.
- **Riscos:** ambiente local (Docker/Supabase) mascarar problemas de produto como problemas de infra.
- **Tamanho:** P · **Capacidade:** programação + verificação ao vivo · **Raciocínio:** médio · **Checkpoint humano:** sim (aceite do resultado) · **Braço isolado:** sim

### ORQ-02 — Foco operacional real

- **Problema:** foco compartilhado e resposta à ambiguidade estão implementados e testados, mas não comprovados em uso real com vários trabalhos ativos.
- **Resultado esperado:** com dois ou mais itens ativos, a conversa mantém um item em foco, troca de foco sem duplicar trabalho e pede confirmação curta quando a referência é ambígua — em web e mobile.
- **Dependências:** ORQ-01; F7 do Plano 001. **Escopo:** comprovação ao vivo; correções do fluxo existente. **Fora do escopo:** heurísticas novas de inferência de foco.
- **Aceite:** cenário real com ≥2 itens ativos, troca de foco e uma ambiguidade resolvida por confirmação, com eventos consistentes.
- **Evidências:** registro da sessão; testes existentes verdes.
- **Riscos:** paridade mobile não validada em dispositivo.
- **Tamanho:** P · **Capacidade:** programação + verificação ao vivo · **Raciocínio:** leve · **Checkpoint humano:** não · **Braço isolado:** sim

### ORQ-03 — Revisão transacional de propostas

- **Problema:** correções de proposta são atômicas no domínio, mas o comportamento sob decisões concorrentes/tardias precisa de comprovação ao vivo (conflitos de versão retornam erro tipado, sem retry-loop do PostgREST).
- **Resultado esperado:** revisar/corrigir uma proposta gera nova versão; decisões sobre versões antigas são recusadas com resposta clara na conversa.
- **Dependências:** ORQ-01. **Escopo:** comprovação ao vivo do fluxo de correção e conflito. **Fora do escopo:** merge de propostas; edição colaborativa.
- **Aceite:** cenário real de correção + tentativa de decisão sobre versão obsoleta recusada com mensagem compreensível.
- **Evidências:** eventos de `proposal_revised` e recusa registrados; pgTAP verde.
- **Riscos:** UX de conflito confusa levando o usuário a reenviar decisões.
- **Tamanho:** P · **Capacidade:** programação + verificação ao vivo · **Raciocínio:** leve · **Checkpoint humano:** não · **Braço isolado:** sim

### ORQ-04 — Continuidade conversacional

**Estado (2026-07-20):** aceito. Comprovado ao vivo em sessão web autenticada (arquivar → retomar → cartões reconstruídos → decisão pós-retomada única) e em dispositivo físico (iPhone 14 Pro via Expo Go: retomada entre plataformas, conflito com reconcile e mensagem preservada, ciclo completo e persistência após reabrir o app). Fase A formalmente aceita — ver §Aceite formal no Plano 002.

- **Problema:** a ligação entre mensagem de origem, cartão, resposta do Anima e eventos existe por contrato, mas a continuidade percebida (retomar a conversa e reencontrar o trabalho com contexto) não foi comprovada.
- **Resultado esperado:** encerrar e reabrir a conversa (inclusive arquivando) preserva proveniência: é possível reconstruir pedido → proposta → decisão → resultado a partir do item.
- **Dependências:** ORQ-01–03; F6 do Plano 001. **Escopo:** comprovação ao vivo de arquivamento e reconstrução. **Fora do escopo:** busca; linha do tempo nova.
- **Aceite:** após arquivar a conversa, o item continua íntegro e a proveniência é reconstruível pelas referências.
- **Evidências:** demonstração real; testes existentes verdes.
- **Riscos:** referências órfãs se arquivamento e snapshots divergirem.
- **Tamanho:** P · **Capacidade:** programação + verificação ao vivo · **Raciocínio:** leve · **Checkpoint humano:** não · **Braço isolado:** sim

## AUTO — Contrato do trabalho autônomo

### AUTO-01 — Critérios de elegibilidade

**Estado (2026-07-20):** concluído. Predicado puro fail-closed `evaluateAutonomousEligibility` em `packages/core` (com `AutonomousExecutionSpecV1` lida de `intent.execution_spec`, sem migration), payload tipado proposto para `work_blocked` e seção correspondente na arquitetura; 34 testes de domínio cobrem cada requisito do Marco 003 e combinações. **Checkpoint humano cumprido (2026-07-20):** o Gean ratificou a régua documentada na arquitetura, incluindo (1) permissões explicitamente vazias contam como declaradas; (2) pelo menos um limite positivo é suficiente; (3) `work_blocked_unresolved` permanece separado de decisão pendente genérica.

- **Problema:** não existe definição executável de "trabalho pronto para execução autônoma"; sem ela, qualquer fila herdaria propostas vagas.
- **Resultado esperado:** predicado de domínio puro que responde se um `work_item` é elegível, com a lista de lacunas quando não é (escopo vago, sem critérios de validação, sem limites, decisão pendente etc.).
- **Dependências:** Fase A aceita. **Escopo:** conceito documentado + tipos e função em `packages/core` + eventos propostos (`work_blocked` com razão tipada). **Fora do escopo:** persistência nova; UI; fila.
- **Aceite:** para cada requisito do Marco 003 (§Elegibilidade) existe verificação correspondente; item não elegível explica exatamente o que falta.
- **Evidências:** testes de domínio cobrindo cada critério e combinações.
- **Riscos:** critérios frouxos "para destravar" — elegibilidade é fail-closed por definição.
- **Tamanho:** M · **Capacidade:** modelagem de domínio · **Raciocínio:** alto · **Checkpoint humano:** sim (aprovar a régua de elegibilidade) · **Braço isolado:** sim

### AUTO-02 — Claim exclusivo e expiração

- **Problema:** nada impede dois braços de executarem o mesmo item; a exclusividade precisa ser garantida pela fonte de verdade, não por convenção.
- **Resultado esperado:** conceito de claim (dono, escopo, expiração, renovação, liberação) com invariantes: no máximo um claim ativo por item; claim expirado é recuperável; tomada de claim ativo é impossível.
- **Dependências:** AUTO-01. **Escopo:** conceito + contrato de domínio; desenho da persistência (RPC transacional) descrito antes de qualquer migration. **Fora do escopo:** distribuição multi-máquina otimizada; locks de granularidade fina.
- **Aceite:** invariantes provados por testes (incluindo corrida simulada); expiração recuperável sem duplicar execução.
- **Evidências:** testes de domínio; quando persistido, pgTAP das RPCs.
- **Riscos:** relógio local como única fonte de expiração; deadlock entre claim e revisão humana.
- **Tamanho:** M · **Capacidade:** modelagem de domínio + persistência transacional · **Raciocínio:** alto · **Checkpoint humano:** não · **Braço isolado:** sim

### AUTO-03 — Tentativas persistentes

**Estado do mínimo (2026-07-20):** concluído como contrato de domínio, antes de schema. `ExecutionAttempt` correlaciona tentativa, item e versão aprovada; registra executor, início/fim, resultado, razão de parada e handoff; transições puras recusam término tardio/duplicado e dados sensíveis; payloads V1 de início e término ficam propostos para INT-01/INT-02. Ambiente, consumo e demais campos completos permanecem pendentes no AUTO-03 completo.

- **Problema:** o ciclo atual registra início/desfecho de execução, mas não o conceito completo de tentativa (executor, modelo, esforço, ambiente, ações, validações, consumo, razão de parada, handoff).
- **Resultado esperado:** tentativa como entidade do domínio com todos os campos do Marco 003 (§Tentativas persistentes), correlacionada a item + versão aprovada; mínimo viável primeiro (executor, início/fim, resultado, razão, referência de handoff), campos de consumo/ambiente na versão completa.
- **Dependências:** AUTO-01; contrato existente de `start/finish_execution` como base. **Escopo:** conceito + tipos + evolução dos eventos persistidos. **Fora do escopo:** telemetria contínua; métricas agregadas.
- **Aceite:** toda execução gera exatamente uma tentativa consultável com os campos mínimos; tentativa tardia/duplicada é rejeitada (invariante já provado hoje é preservado).
- **Evidências:** testes de domínio + pgTAP quando persistido.
- **Riscos:** registrar segredo ou caminho sensível em payload — sanitização é requisito, não melhoria.
- **Tamanho:** M · **Capacidade:** modelagem de domínio + persistência · **Raciocínio:** médio · **Checkpoint humano:** não · **Braço isolado:** sim

### AUTO-04 — Checkpoint e handoff obrigatório

- **Problema:** trabalho relevante hoje pode existir só na memória de uma sessão de executor; interrupção significa perda e retrabalho.
- **Resultado esperado:** definição tipada de checkpoint/handoff (commit, branch, patch, artefato, checkpoint estruturado, relatório, evidência) e a regra: nenhuma tentativa termina — por qualquer razão — sem produzir um estado transferível referenciável.
- **Dependências:** AUTO-03. **Escopo:** conceito + tipos + validação de que toda razão de parada exige handoff correspondente. **Fora do escopo:** armazenamento binário de artefatos; sincronização entre máquinas.
- **Aceite:** tentativa sem handoff é inválida por contrato; cada tipo de handoff tem referência verificável (ex.: hash, caminho, id de evidência).
- **Evidências:** testes de domínio; exemplo real na Fase D.
- **Riscos:** handoff "de papel" que não permite retomada real — o teste de aceitação é retomar a partir dele.
- **Tamanho:** M · **Capacidade:** modelagem de domínio · **Raciocínio:** alto · **Checkpoint humano:** não · **Braço isolado:** sim

### AUTO-05 — Pausa e retomada

- **Problema:** o sistema não sobrevive a limite de provedor, reinício de máquina, Docker/Ollama fora ou troca de executor sem intervenção manual de reconstrução.
- **Resultado esperado:** retomar = eleger o último checkpoint válido + evidências persistidas e continuar dali, com novo claim e nova tentativa; nunca depender do contexto conversacional anterior do executor.
- **Dependências:** AUTO-02, AUTO-03, AUTO-04. **Escopo:** regras de retomada + cenários de interrupção nomeados no Marco 003. **Fora do escopo:** retomada automática sem supervisor (vira SUP-04).
- **Aceite:** para cada cenário de interrupção listado no marco existe um caminho de retomada documentado e testado (com executor falso).
- **Evidências:** testes por cenário; demonstração real de um cenário na Fase E.
- **Riscos:** checkpoint corrompido/parcial; retomada duplicando efeitos (idempotência de INT-01 é pré-condição).
- **Tamanho:** G · **Capacidade:** modelagem de domínio + orquestração · **Raciocínio:** alto · **Checkpoint humano:** não · **Braço isolado:** parcialmente (cenários reais exigem ambiente supervisionado)

### AUTO-06 — Política de interrupção humana

**Estado (2026-07-20):** concluído. Enum fechado com as oito razões do Marco 003, política pura fail-closed, snapshot tipado do estado causador e payload proposto `InputRequestedPayloadV1`; testes de domínio cobrem cada razão, valores externos à lista e a exigência de limite atingido para incapacidade persistente. **Checkpoint humano cumprido (2026-07-20):** o Gean ratificou a lista sem categoria `other`, estado e versão obrigatórios, incapacidade persistente somente após `attempts`, `duration` ou `resources` e rejeição fail-closed de entradas inválidas sem inferência ou correção silenciosa.

- **Problema:** sem uma lista fechada de razões válidas para interromper, a autonomia oscila entre incomodar demais e decidir demais.
- **Resultado esperado:** a lista do Marco 003 (§Interrupções humanas) como enum de domínio + regra: interrupção fora da lista é defeito; incapacidade persistente após limites vira interrupção, nunca loop.
- **Dependências:** AUTO-01. **Escopo:** conceito + tipos + evento `input_requested`/decisão necessária com razão tipada. **Fora do escopo:** UI dos cartões (UX-02); canais de notificação.
- **Aceite:** toda interrupção referencia uma razão da lista e o estado que a gerou; testes cobrem cada razão.
- **Evidências:** testes de domínio.
- **Riscos:** razões genéricas ("outro") esvaziando a política — não existe "outro".
- **Tamanho:** P · **Capacidade:** modelagem de domínio · **Raciocínio:** médio · **Checkpoint humano:** sim (aprovar a lista como política) · **Braço isolado:** sim

## INT — Contrato e primeira integração

### INT-01 — Contrato WorkExecutorAdapter

**Estado (2026-07-20):** concluído. `WorkExecutorAdapter` recebe entrada delimitada e correlacionada e emite fluxo fechado de `progress`, `decision_required`, `result`, `error` ou `cancelled`; validador fail-closed exige sequência, correlação e terminal únicos; `FakeWorkExecutor` comprova todos os sinais, cancelamento e idempotência sequencial/concorrente por tentativa. O contrato limitado anterior foi preservado explicitamente como `BoundedWorkExecutorAdapter`. **Checkpoint humano cumprido (2026-07-20):** o Gean ratificou os cinco sinais, correlação obrigatória por item/tentativa/versão, cancelamento cooperativo, idempotência sequencial e concorrente, falha fechada para entrada divergente, preservação do contrato anterior e ausência de fornecedores nos tipos.

- **Problema:** o contrato atual cobre execução limitada com desfecho único; o ciclo autônomo exige progresso, decisão necessária, cancelamento cooperativo, idempotência e correlação por tentativa.
- **Resultado esperado:** contrato evoluído (entrada delimitada; eventos de progresso; resultado; erro tipado; decisão necessária; cancelamento; idempotência por tentativa; correlação item/tentativa/versão), compatível com o `WorkExecutorAdapter` atual ou substituindo-o por decisão explícita.
- **Dependências:** AUTO-03, AUTO-06. **Escopo:** contrato em `packages/core` + executor falso completo. **Fora do escopo:** transporte; runner real.
- **Aceite:** executor falso exercita todos os sinais em teste; reentrega da mesma tentativa não duplica efeitos; nenhum tipo do contrato menciona fornecedor.
- **Evidências:** testes de contrato.
- **Riscos:** contrato especulativo além do que a Fase D consome.
- **Tamanho:** M · **Capacidade:** design de contratos + programação · **Raciocínio:** alto · **Checkpoint humano:** sim (aprovar o contrato) · **Braço isolado:** sim

### INT-02 — Correlação de eventos

**Estado (2026-07-20):** concluído no recorte “conceito antes de migration”. O core define correlação obrigatória por item, tentativa, versão aprovada e origem fechada, estende os sinais do executor com origem e reconstrói linhas do tempo determinísticas exclusivamente pela correlação e sequência explícitas. Entradas ausentes, inválidas, divergentes, duplicadas ou tardias falham fechadas. A auditoria confirmou que o banco legado ainda não materializa o vocabulário completo; por isso não houve migration nem pgTAP nesta etapa, e a aplicação do contrato na futura fronteira persistente ficou documentada sem atribuí-la aos RPCs atuais. **Ratificação humana cumprida (2026-07-20):** o Gean aprovou a correlação obrigatória, as origens fechadas `anima`/`executor`/`user`/`system`, a reconstrução pura por correlação e sequência, o comportamento fail-closed, o isolamento de tentativas concorrentes e a ausência de migration/pgTAP sem persistência real.

- **Problema:** eventos de execução precisam ser auditáveis por item, tentativa e versão aprovada; hoje a correlação cobre execução única (executionId + versão), não o vocabulário completo.
- **Resultado esperado:** todo evento do ciclo autônomo carrega correlação obrigatória (item, tentativa, versão, origem), validada no servidor; projeção do estado continua derivada do log.
- **Dependências:** INT-01; AUTO-03. **Escopo:** extensão do vocabulário de `work_events` (conceito antes de migration). **Fora do escopo:** telemetria externa; tracing distribuído.
- **Aceite:** dado um item, é possível reconstruir a linha do tempo completa de tentativas e sinais sem heurística; evento sem correlação é rejeitado.
- **Evidências:** pgTAP das validações; teste de reconstrução.
- **Riscos:** payloads crescerem sem tipagem — vocabulário fechado permanece regra.
- **Tamanho:** M · **Capacidade:** persistência + modelagem · **Raciocínio:** médio · **Checkpoint humano:** não · **Braço isolado:** sim

### INT-03 — Execução separada de integração

**Estado (2026-07-20):** concluído como contrato puro antes de persistência. `IntegrationBoundary` separa resultado produzido, aceite, autorização/recusa e registro de integração; exige handoff tipado, decisão humana explícita e correlação intacta do INT-02. Repetições idênticas são idempotentes, entradas divergentes e transições ambíguas falham fechadas. `completed` continua significando resultado aceito, nunca merge/deploy/aplicação. Nenhuma migration ou integração real foi criada; por isso pgTAP não se aplica a este recorte.

- **Problema:** o risco permanente é "executou, logo aplicou"; produzir alteração não pode equivaler a integrá-la.
- **Resultado esperado:** fronteira formal entre produzir resultado (tentativa) e integrar (aplicar/mergear/publicar), com estados/eventos distintos e gate humano ou explícito entre eles.
- **Dependências:** INT-01. **Escopo:** regras de domínio + validação de transições. **Fora do escopo:** mecânica de merge/PR; publicação.
- **Aceite:** não existe transição válida de "resultado produzido" para "integrado" sem decisão registrada; testes provam a recusa.
- **Evidências:** testes de domínio + pgTAP.
- **Riscos:** atalhos de conveniência na Fase D violarem a fronteira.
- **Tamanho:** P · **Capacidade:** modelagem de domínio · **Raciocínio:** médio · **Checkpoint humano:** não · **Braço isolado:** sim

### INT-04 — Primeira execução sob comando

- **Problema:** as duas metades comprovadas (orquestração no Anima; execução isolada no runner) nunca se tocaram; sem uma integração estreita, tudo acima é teoria.
- **Resultado esperado:** um `work_item` aprovado; usuário comanda "executar"; um adaptador concreto (fora do core) entrega o pacote a um executor real em workspace isolada; uma tentativa; evidências e resultado retornam tipados; revisão humana decide; nenhuma aplicação automática.
- **Dependências:** INT-01–03; ORQ-01–04; autorização explícita para integração externa. **Escopo:** um executor, um projeto, início manual. **Fora do escopo:** fila, supervisor, seleção de executor, segunda tentativa automática, aplicação/merge.
- **Aceite:** ciclo real completo dentro do produto (exceto a execução em si) com evidências persistidas; falha de integração deixa o item íntegro com histórico; sequência estreita do Marco 003 respeitada à risca.
- **Evidências:** registro da execução real; eventos correlacionados; testes do adaptador com executor simulado.
- **Riscos:** acoplamento aos internos do runner; vazamento de segredos/caminhos; escopo crescer para "já que estamos aqui".
- **Tamanho:** G · **Capacidade:** integração + programação + verificação ao vivo · **Raciocínio:** alto · **Checkpoint humano:** sim (comando de início e revisão do resultado) · **Braço isolado:** não (exige ambiente local e decisões do usuário)

## SUP — Supervisor V0

### SUP-01 — Fila persistente

- **Problema:** não existe representação persistente de "trabalhos aguardando execução autônoma"; sem fila, autonomia é um botão, não uma capacidade.
- **Resultado esperado:** fila derivada da fonte de verdade (itens elegíveis + ordem), persistente entre reinícios, sem estado paralelo que possa divergir dos `work_items`.
- **Dependências:** INT-04 comprovado; AUTO-01. **Escopo:** conceito + projeção consultável. **Fora do escopo:** prioridades configuráveis avançadas; multiusuário.
- **Aceite:** reiniciar o sistema preserva a fila; item que deixa de ser elegível sai da fila sem intervenção.
- **Evidências:** testes de projeção; pgTAP se houver persistência própria.
- **Riscos:** fila como tabela independente divergindo do estado dos itens — preferir projeção.
- **Tamanho:** M · **Capacidade:** persistência + modelagem · **Raciocínio:** médio · **Checkpoint humano:** não · **Braço isolado:** sim

### SUP-02 — Seleção do próximo item

- **Problema:** com mais de um elegível, alguém precisa escolher o próximo de forma explicável e segura.
- **Resultado esperado:** política de seleção determinística e documentada (ex.: aprovação mais antiga primeiro, respeitando SUP-03), com a razão da escolha registrada.
- **Dependências:** SUP-01. **Escopo:** política V0 simples + registro da decisão. **Fora do escopo:** priorização por urgência/valor; reordenação pelo usuário (futuro).
- **Aceite:** dada uma fila conhecida, a seleção é reproduzível em teste; a escolha fica auditável.
- **Evidências:** testes determinísticos da política.
- **Riscos:** esconder juízo de valor numa heurística — na dúvida, FIFO explicável.
- **Tamanho:** P · **Capacidade:** programação · **Raciocínio:** leve · **Checkpoint humano:** não · **Braço isolado:** sim

### SUP-03 — Um trabalho ativo por projeto

- **Problema:** paralelismo dentro do mesmo projeto/workspace gera conflito de arquivos, claims e revisão — a V0 proíbe isso por decisão do marco.
- **Resultado esperado:** invariante: no máximo uma execução autônoma ativa por projeto/workspace; segundo elegível espera; a noção de "projeto/alvo" fica registrada no item (vinda de AUTO-01).
- **Dependências:** SUP-01, AUTO-02. **Escopo:** invariante + testes. **Fora do escopo:** paralelismo entre projetos distintos (permitido só quando explicitamente habilitado; não é meta da V0).
- **Aceite:** corrida simulada entre dois itens do mesmo alvo resulta em um executando e um aguardando, sem deadlock.
- **Evidências:** testes de concorrência simulada.
- **Riscos:** definição frouxa de "mesmo projeto" furando o invariante.
- **Tamanho:** P · **Capacidade:** modelagem + programação · **Raciocínio:** médio · **Checkpoint humano:** não · **Braço isolado:** sim

### SUP-04 — Recuperação após interrupção

- **Problema:** o supervisor precisa sobreviver ao mundo real: processo morto, máquina reiniciada, Docker/Ollama fora, limite de provedor.
- **Resultado esperado:** ao religar, o supervisor reconcilia claims expirados, tentativas órfãs e checkpoints, e retoma (ou re-enfileira) sem duplicar execução nem perder evidência.
- **Dependências:** SUP-01–03; AUTO-05. **Escopo:** rotina de reconciliação + cenários nomeados do marco. **Fora do escopo:** alta disponibilidade; failover multi-máquina.
- **Aceite:** cada cenário de interrupção do Marco 003 tem teste (executor falso) e pelo menos um foi demonstrado ao vivo com evidências.
- **Evidências:** testes por cenário; demonstração real documentada.
- **Riscos:** reconciliação agressiva matando claims válidos; duplo processamento.
- **Tamanho:** G · **Capacidade:** orquestração + programação · **Raciocínio:** alto · **Checkpoint humano:** não · **Braço isolado:** parcialmente (demonstração ao vivo exige ambiente)

## INTEL — Uso sustentável de inteligência

### INTEL-01 — Classificação de trabalho

- **Problema:** sem classificar complexidade, risco e reversibilidade, toda decisão de roteamento é chute.
- **Resultado esperado:** classificação tipada por item/tentativa (complexidade, risco, reversibilidade, clareza do plano, urgência), atribuída na proposta e revisável, persistida com proveniência.
- **Dependências:** Fase E operando. **Escopo:** conceito + tipos + registro. **Fora do escopo:** inferência automática sofisticada (começa com classificação assistida/manual).
- **Aceite:** todo item elegível carrega classificação; mudanças são eventos auditáveis.
- **Evidências:** testes de domínio.
- **Riscos:** classificação virar burocracia — poucos níveis, definições concretas.
- **Tamanho:** M · **Capacidade:** modelagem · **Raciocínio:** médio · **Checkpoint humano:** não · **Braço isolado:** sim

### INTEL-02 — Seleção de provedor e esforço

- **Problema:** hoje a escolha de executor/modelo/esforço é humana e implícita; a visão exige que seja automática, explicável e alinhada ao princípio "leve para operar, médio para construir, forte para decidir, destravar e revisar".
- **Resultado esperado:** política que mapeia classificação (INTEL-01) → executor/provedor/modelo/nível de esforço, registrando os fatores considerados (incl. recursos da máquina e limites conhecidos dos provedores).
- **Dependências:** INTEL-01; histórico de AUTO-03. **Escopo:** política V0 por regras explícitas. **Fora do escopo:** otimização por custo de token como objetivo primário; aprendizado de política.
- **Aceite:** para cada tentativa, a decisão de roteamento é consultável com fatores; a política é reproduzível em teste.
- **Evidências:** testes da política; decisões persistidas.
- **Riscos:** acoplar a política a nomes de fornecedores em vez de capacidades.
- **Tamanho:** M · **Capacidade:** design de política + programação · **Raciocínio:** alto · **Checkpoint humano:** sim (aprovar a política inicial) · **Braço isolado:** sim

### INTEL-03 — Escalonamento e redução

- **Problema:** falhas repetidas com executor leve desperdiçam tentativas; manter executor forte após o plano consolidar desperdiça capacidade.
- **Resultado esperado:** regras explícitas de escalonamento (após N falhas ou bloqueio persistente → executor/esforço mais forte) e de redução (plano consolidado/etapa mecânica → mais leve), sempre registradas como eventos.
- **Dependências:** INTEL-02; AUTO-05. **Escopo:** regras + integração com limites de tentativa existentes. **Fora do escopo:** ajuste dinâmico intra-tentativa.
- **Aceite:** cenários de escalonamento e redução reproduzíveis em teste; nenhum escalonamento ultrapassa limites/orçamento do item.
- **Evidências:** testes de cenário; eventos de roteamento.
- **Riscos:** ping-pong entre níveis; escalonamento mascarando problema de escopo (deve virar interrupção AUTO-06).
- **Tamanho:** M · **Capacidade:** programação + política · **Raciocínio:** alto · **Checkpoint humano:** não · **Braço isolado:** sim

### INTEL-04 — Orçamento e reserva de capacidade

- **Problema:** o modo autônomo não pode esgotar os limites de provedor do usuário nem monopolizar a máquina; "maximizar progresso confiável por unidade de recurso" exige orçamento.
- **Resultado esperado:** noção de orçamento por item/período (tentativas, tempo, janelas de provedor) e reserva de capacidade para uso interativo do usuário; execução autônoma para com razão tipada ao atingir orçamento.
- **Dependências:** INTEL-02; AUTO-03 (consumo registrado). **Escopo:** conceito + enforcement nos limites existentes. **Fora do escopo:** billing real; medição fina de custo por token.
- **Aceite:** orçamento atingido interrompe com checkpoint e razão; reserva impede o autônomo de consumir a capacidade interativa configurada.
- **Evidências:** testes de orçamento; cenário demonstrado.
- **Riscos:** contabilidade de consumo imprecisa — começar por unidades simples (tentativas, tempo) antes de tokens.
- **Tamanho:** M · **Capacidade:** programação + política · **Raciocínio:** médio · **Checkpoint humano:** sim (definir orçamentos padrão) · **Braço isolado:** sim

## UX — Experiência no chat

### UX-01 — Cartão de execução

- **Problema:** execução autônoma sem projeção conversacional é caixa-preta; o chat é a entrada e a lente únicas.
- **Resultado esperado:** cartão de execução na conversa mostrando estado da tentativa, progresso conhecido, limites, checkpoint mais recente e ações de pausar/cancelar — sempre como projeção do estado persistido.
- **Dependências:** INT-04 (dados reais); padrão de cartões existente (F4/F5). **Escopo:** web primeiro; mobile em paridade em seguida. **Fora do escopo:** streaming de log bruto; telas dedicadas.
- **Aceite:** durante uma execução real, o cartão reflete eventos persistidos (nunca estado próprio); pausar/cancelar geram eventos e efeito real.
- **Evidências:** testes de componente; demonstração ao vivo.
- **Riscos:** poll/refresh criando estado fantasma; cartão virar console.
- **Tamanho:** M · **Capacidade:** programação de UI + integração · **Raciocínio:** médio · **Checkpoint humano:** não · **Braço isolado:** sim

### UX-02 — Cartão de decisão necessária

- **Problema:** interrupções humanas (AUTO-06) precisam chegar como decisão estruturada, não como texto solto perdido na conversa.
- **Resultado esperado:** cartão com razão tipada, contexto mínimo, alternativas reais e ações explícitas; a decisão persiste apontando a versão exata apresentada; o trabalho permanece pausado com checkpoint até a resposta.
- **Dependências:** AUTO-06; UX-01. **Escopo:** web + mobile. **Fora do escopo:** notificações externas; decisão por outra pessoa.
- **Aceite:** cada razão da política tem apresentação; responder retoma ou encerra conforme a decisão; decisão tardia sobre versão obsoleta é recusada.
- **Evidências:** testes de componente; cenário real com uma interrupção.
- **Riscos:** excesso de interrupção degradando confiança — a política é o freio, o cartão só projeta.
- **Tamanho:** M · **Capacidade:** programação de UI · **Raciocínio:** médio · **Checkpoint humano:** sim (é o próprio cartão) · **Braço isolado:** sim

### UX-03 — Cartão de resultado para revisão

- **Problema:** o resultado autônomo precisa da mesma revisão rigorosa do fluxo manual — com evidências, diff/handoff e decisão versionada.
- **Resultado esperado:** cartão de resultado com resumo, evidências tipadas, referência de handoff e ações de aprovar, pedir alterações (mantendo o item aberto) ou rejeitar; integração continua etapa separada (INT-03).
- **Dependências:** UX-01; ORQ-01 (base manual comprovada). **Escopo:** reutilizar o fluxo de revisão existente, estendido para tentativa autônoma. **Fora do escopo:** botões de merge/publicação.
- **Aceite:** decisão referencia tentativa e versão exatas; pedir alterações gera novo ciclo elegível sem perder histórico.
- **Evidências:** testes de componente; cenário real de aprovação e de pedido de alteração.
- **Riscos:** duplicar fluxo de revisão em vez de estender o existente.
- **Tamanho:** M · **Capacidade:** programação de UI · **Raciocínio:** médio · **Checkpoint humano:** sim (é a revisão) · **Braço isolado:** sim

### UX-04 — Histórico e retomada pelo chat

- **Problema:** trabalhos pausados/bloqueados precisam ser reencontráveis e retomáveis pela conversa dias depois, sem depender da memória do usuário.
- **Resultado esperado:** pela conversa, listar trabalhos ativos/pausados/aguardando decisão, trazer um deles ao foco e retomar do último checkpoint — coerente com o modelo de foco existente (ORQ-02).
- **Dependências:** UX-01–03; AUTO-05. **Escopo:** consulta + retomada conversacional. **Fora do escopo:** dashboard; busca avançada; timeline visual.
- **Aceite:** cenário real: retomar um trabalho pausado por limite de provedor, dias depois, apenas pelo chat, partindo do checkpoint.
- **Evidências:** demonstração ao vivo; testes do fluxo de retomada.
- **Riscos:** virar gerenciador de tarefas — a entrada continua sendo conversa, não lista.
- **Tamanho:** M · **Capacidade:** programação de UI + integração · **Raciocínio:** médio · **Checkpoint humano:** não · **Braço isolado:** sim
