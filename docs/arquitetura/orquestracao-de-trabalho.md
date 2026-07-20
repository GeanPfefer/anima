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

## Elegibilidade para execução autônoma (AUTO-01, Fase B)

Definição executável de "trabalho pronto para execução autônoma", derivada requisito a requisito do [Marco 003 §Elegibilidade](../marcos/003-trabalho-autonomo-seguro.md). Vive como predicado **puro e fail-closed** em `packages/core` (`evaluateAutonomousEligibility`): na dúvida, o item não é elegível, e cada lacuna (`AutonomousEligibilityGap`) nomeia o requisito violado e explica exatamente o que falta — não existe lacuna "outro".

Mapeamento requisito → verificação:

| Requisito do Marco 003 | Verificação | Lacunas possíveis |
|---|---|---|
| versão aprovada da proposta | `state === 'approved'` (estados encerrados nunca são elegíveis) | `proposal_not_approved`, `work_already_closed` |
| nenhuma decisão humana pendente | estado fora de `proposed`/`review`/`changes_requested`; execução não ativa; item não bloqueado | `human_decision_pending`, `execution_already_active`, `work_blocked_unresolved` |
| escopo concreto | `includedScope` e `excludedScope` não vazios, sem entradas em branco | `scope_not_concrete` |
| resultado esperado descrito | `objective` e `expectedEffects` concretos | `expected_result_missing` |
| capacidade executora identificada | `capability` pertence ao enum `work_capability` | `capability_unknown` |
| alvo conhecido | `execution_spec.target` com `kind` (`project`/`workspace`/`resource`) e `reference` | `target_missing` |
| permissões explícitas | `execution_spec.permissions` é lista explícita (vazia = "nenhuma adicional", declarada) | `permissions_not_declared` |
| critérios de validação verificáveis | `execution_spec.validation_criteria` com ≥1 entrada rotulada | `validation_criteria_missing` |
| limites de tentativa, tempo ou recurso | `execution_spec.limits` com ≥1 inteiro positivo | `limits_missing` |

A especificação de execução (`AutonomousExecutionSpecV1`) ainda não tem persistência própria: quando declarada, vive em `intent.execution_spec` (jsonb já existente), com parse estrito — especificação malformada gera `execution_spec_invalid` e nada é "melhorado" silenciosamente. O evento `work_blocked` (já no vocabulário proposto) ganha o payload tipado proposto `WorkBlockedNotEligiblePayloadV1` (`reason: 'not_eligible'` + códigos das lacunas); a persistência desse payload e qualquer fila/UI ficam para itens posteriores da Fase B/E.

## Política de interrupção humana (AUTO-06, Fase B)

Uma execução autônoma só pode solicitar decisão humana por uma das razões fechadas do [Marco 003 §Interrupções humanas](../marcos/003-trabalho-autonomo-seguro.md). A política pura `evaluateHumanInterruption`, em `packages/core`, trata qualquer razão fora da lista como defeito de domínio; não existe `other` nem texto livre capaz de criar uma nova categoria.

| Razão de domínio | Situação do Marco 003 |
|---|---|
| `scope_change` | mudança de escopo |
| `architectural_decision` | decisão arquitetural com alternativas reais |
| `destructive_action` | ação destrutiva |
| `sensitive_credential_required` | uso de segredo ou credencial sensível |
| `requirements_conflict` | conflito de requisitos |
| `permission_missing` | permissão ausente |
| `final_integration_approval` | aprovação final para integrar, publicar ou mergear |
| `persistent_inability_after_limits` | incapacidade persistente depois dos limites estabelecidos |

Toda interrupção carrega um snapshot mínimo e tipado do estado que a gerou: estado do trabalho, versão exata da proposta e, quando existentes, número da tentativa e referência do checkpoint. Também exige uma explicação concreta. O payload proposto `InputRequestedPayloadV1` projeta esses dados para o evento `input_requested`, já presente no vocabulário arquitetural; sua persistência fica para itens posteriores.

`persistent_inability_after_limits` tem uma proteção adicional: só é válida quando identifica qual limite declarado foi atingido (`attempts`, `duration` ou `resources`). Antes disso, pedir intervenção humana é defeito — incapacidade transitória deve ser tratada pelo sistema dentro dos limites, e incapacidade persistente após o limite deve interromper em vez de iniciar um loop.

Ficam fora do AUTO-06: cartões ou outra UI, notificações, migrations, fila, executor e máquina de estados de tentativas.

## Tentativa de execução mínima (AUTO-03 mínimo, Fase B)

Uma execução comandada corresponde a uma entidade `ExecutionAttempt`, identificada por `attemptId` e correlacionada obrigatoriamente ao `workItemId` e à versão aprovada da proposta. O `executionId` do contrato existente é o precursor desse identificador; a convergência dos nomes ocorrerá junto da evolução do adaptador e dos eventos em INT-01/INT-02, sem manter duas identidades paralelas.

A tentativa nasce uma única vez em `running`, com executor genérico e horário de início. Pode terminar uma única vez em `succeeded`, `failed`, `timed_out`, `cancelled`, `paused` ou `blocked`, sempre com:

- horário de término;
- resumo do resultado conhecido, inclusive diagnóstico em falha;
- razão de parada tipada;
- referência opaca de handoff;
- a correlação original intacta.

Término tardio ou duplicado é defeito e não substitui o primeiro desfecho. Sucesso exige `result_produced`; a mesma razão não pode certificar outro estado. Identificadores, resumos e referências são validados fail-closed contra credenciais evidentes e caminhos absolutos locais antes de formar payload persistível.

`ExecutionAttemptStartedPayloadV1` e `ExecutionAttemptFinishedPayloadV1` são os payloads propostos para tornar a tentativa reconstruível pelos eventos. Nesta etapa de conceito antes de schema, eles não alteram migrations nem RPCs. A persistência definitiva, idempotência de transporte e correlação no servidor pertencem a INT-01/INT-02.

O AUTO-03 mínimo não modela provedor/modelo, esforço, ambiente, ações, arquivos, validações detalhadas ou consumo. Esses campos permanecem no AUTO-03 completo, depois da primeira integração estreita, evitando antecipar telemetria sem uso real.

## Contrato WorkExecutorAdapter (INT-01, Fase C)

`WorkExecutorAdapter` é a fronteira substituível entre o domínio e qualquer executor de uma tentativa. A entrada `WorkExecutorRequest` é delimitada e correlacionada por `attemptId`, `workItemId` e versão aprovada; carrega objetivo, escopo incluído/excluído, capacidade, alvo, permissões, critérios de validação, limites e referências de contexto. Nenhum tipo menciona fornecedor, transporte, processo ou runner concreto.

O adaptador devolve um fluxo assíncrono de sinais, todos com a mesma correlação e sequência contínua:

| Sinal | Papel | Terminal |
|---|---|---|
| `progress` | progresso conhecido, sem log bruto | não |
| `decision_required` | interrupção admitida pelo AUTO-06, com razão tipada | sim |
| `result` | resultado, evidências e handoff para revisão | sim |
| `error` | falha tipada, retryable explícito e handoff | sim |
| `cancelled` | reconhecimento cooperativo do cancelamento e handoff | sim |

Um transcript válido possui exatamente uma condição terminal; nada pode sucedê-la. Sequência quebrada, correlação divergente, entrada vaga ou término ausente falham fechados. Reentregar o mesmo `attemptId` com a mesma entrada deve devolver o mesmo transcript sem repetir efeitos, inclusive sob concorrência; reentrega com entrada diferente produz `attempt_payload_conflict` terminal e não retryable.

A substituição do contrato anterior é explícita: a fronteira limitada de F8 permanece como `BoundedWorkExecutorAdapter`, com seu executor e persistência atuais intactos; `WorkExecutorAdapter` passa a nomear apenas o contrato autônomo. `FakeWorkExecutor` exercita todos os sinais, cancelamento e idempotência. Transporte, executor real, persistência dos sinais, fila, UI e integração com provedores ficam fora do INT-01.

## Correlação dos eventos de execução (INT-02, Fase C)

Todo evento conceitual do ciclo autônomo carrega `ExecutionEventCorrelation`: `workItemId`, `attemptId`, `approvedProposalVersion` e uma origem fechada (`anima`, `executor`, `user` ou `system`). Não existe origem livre nem `other`. Os sinais emitidos por `WorkExecutorAdapter` têm origem `executor`; outras origens existem para decisões e efeitos do restante do domínio, sem introduzir fornecedor no contrato.

`reconstructExecutionTimelines` é a projeção pura e fail-closed desse log. Ela recebe o contexto persistido das tentativas e os eventos correlacionados, valida a correlação declarada também contra a correlação repetida no sinal e então:

- associa cada evento exclusivamente pela chave explícita item + versão aprovada + tentativa;
- recusa um `attemptId` reutilizado em outro item ou versão;
- ordena cada tentativa somente pela sequência inteira positiva, nunca por timestamp, posição de entrada ou conteúdo;
- recusa evento com correlação ausente ou duplicado, sequência com lacuna/empate e qualquer evento após uma condição terminal;
- mantém tentativas concorrentes do mesmo item e versão em linhas do tempo distintas.

O banco anterior ao INT-02 não basta para materializar esse contrato completo: `work_item_id` e `proposal_version` são colunas, `execution_id` existe apenas nos payloads dos eventos de início/desfecho, `author` não substitui a origem semântica e não há persistência para todo o fluxo de sinais. Nenhuma migration foi criada nesta etapa porque fazê-lo exigiria ampliar enum, RPCs e projeções, contrariando o recorte “conceito antes de migration”. A futura integração persistente deverá aplicar este mesmo validador na fronteira de escrita e rejeitar divergência entre colunas, payload e contexto da tentativa; até lá, os RPCs legados de execução limitada permanecem intactos e não são apresentados como implementação do novo contrato.

## Execução separada de integração (INT-03, Fase C)

O estado `completed` do work item continua significando “resultado aceito e trabalho encerrado”; não afirma que um artefato foi aplicado, publicado, implantado ou mesclado. A integração possui uma fronteira de domínio independente, pura e fail-closed, com a sequência fechada:

```text
result_produced → result_accepted → integration_authorized → integrated
                                      └→ integration_refused
```

`produceResultForIntegration` só abre a fronteira a partir de uma tentativa `succeeded` por `result_produced`, enquanto o item está em `review`, e exige um `IntegrationHandoff` tipado que referencia o resultado e o handoff exato da tentativa. O aceite exige o item em `completed`, origem humana e o ID exato do resultado. Autorizar ou recusar integração é uma segunda decisão humana, distinta do aceite. `recordIntegrated` apenas registra o fato depois da autorização exata, com origem de sistema; ele não executa efeito externo.

Todas as etapas preservam item, tentativa e versão aprovada do INT-02. Repetir a mesma decisão ou registro devolve o mesmo estado; reutilizar o mesmo ID com entrada divergente falha fechado. Estado, versão, origem, correlação, resultado ou autorização ausentes/incompatíveis também são recusados. Assim, conclusão da tentativa, conclusão do work item e integração permanecem fatos diferentes.

Não houve migration nem pgTAP no INT-03: o recorte implementa somente o contrato puro. Eventos persistentes, RPCs e mecanismo real de Git, merge, aplicação, publicação ou deploy pertencem a itens posteriores e não podem ser inferidos desta máquina de estados.

## Portabilidade e nós locais (Marco 004)

O Anima deve distinguir contexto pessoal portátil de recursos locais. Memória, decisões, trabalhos e checkpoints podem acompanhar o usuário entre dispositivos; arquivos, pastas, ferramentas e recursos de uma máquina permanecem sob um nó local e suas permissões explícitas. Portabilidade não implica copiar todo conteúdo para um banco ou expô-lo na rede.

Um nó local é executor de capacidades, não fonte de intenção nem interface concorrente. Contratos portáteis descrevem capacidade, alvo e referências opacas; não dependem de nome de máquina, caminho absoluto, sistema operacional, fornecedor ou transporte. A resolução de uma referência local acontece somente no nó autorizado, e dados sensíveis não podem vazar para eventos ou checkpoints portáteis.

Permissões para leitura, indexação, escrita, execução, transferência e administração são independentes e fail-closed. Nenhuma existe por padrão. Ações destrutivas, privilegiadas, estruturais ou com efeito externo continuam atrás de decisão humana conforme a política de interrupção. O INT-04 é a primeira prova estreita dessa direção, sem incluir sincronização, catálogo de dispositivos, administração geral ou acesso amplo ao filesystem.

## Primeira execução comandada em nó local (INT-04, Fase D)

O transporte concreto permanece fora do core. A rota autenticada `execute-commanded` recebe item, versão aprovada e tentativa explícita; reconcilia reentregas pelo histórico persistido; verifica elegibilidade; inicia a tentativa atomicamente; chama o adaptador local; valida o transcript e persiste exatamente um terminal correlacionado. Os RPCs de início e terminal bloqueiam o item, conferem usuário, allowlist, estado, versão, item e tentativa e recusam divergências. Uma tentativa terminal idêntica é idempotente; conflito falha fechado.

O adaptador resolve uma referência opaca por configuração exclusiva do nó e exige `workspace_read` e `workspace_write_isolated`. Caminhos absolutos não entram no contrato persistido. O runner é invocado sem shell e somente em `produce-only`; o envelope exige versão, estado, referências opacas, caminhos relativos dentro do escopo aprovado e SHA-256 do bundle. Saída inválida, arquivo fora do escopo, processo cancelado ou falha do runner viram terminais tipados e nunca autorizam aplicação.

O runner local admite somente os formatos estruturados declarados. Respostas inválidas não são interpretadas heuristicamente: a resposta bruta, seu hash, fase, tentativa, normalização e rejeição são auditados; no máximo duas regenerações integrais são solicitadas; persistindo a invalidade, a execução falha. A única normalização legada aceita é o resumo de conclusão em um único campo textual de `arguments`, que não influencia gates. Testes, allowlist de arquivos, manifesto, isolamento, revisão e separação entre produção e aplicação continuam obrigatórios.

A prova de 2026-07-20 produziu um resultado real com `qwen2.5-coder:7b`: o item `507af5ef-a72f-4451-8ddb-0747f5e4e856`, tentativa `e65d1de1-ef9c-4e13-8dd5-55d784642e87`, chegou a `review` com `python -m unittest` aprovado. O handoff `20260720T205121334287Z-result.zip` tem SHA-256 `fbe7d1acf5a6017ea0eef7344d95882380be59122c8699ebbd481e8997c00e44` e contém apenas `calculator.py`. O original permaneceu byte a byte no hash `9445c47952abb8a7fc5d4a905d55b5be05771df1d69362ec597f9a50f7ede40d`, com árvore limpa. O resultado está disponível para revisão humana; `apply.status` permaneceu `not_attempted`.

## Claim exclusivo e expiração (AUTO-02, Fase B/E)

Um claim é a posse temporária e exclusiva de um work item por uma instância de supervisor. **Claim não é execução.** A sequência do domínio é `eligible → claimed → attempt_started → execution_started`, e obter o claim não afirma que qualquer tentativa começou: `acquire_work_claim` nunca muda o estado do item, que permanece `approved` até a tentativa nascer.

A menor representação coerente com os contratos existentes é `claim_id`, `work_item_id`, `approved_proposal_version`, `owner_instance_id`, `acquired_at`, `expires_at`, `attempt_id` e a liberação (`released_at` + razão). A versão aprovada é obrigatória porque toda correlação do INT-02 já a exige: proposta revisada invalida o claim em vez de herdá-lo. Não há coluna de versão para concorrência otimista — a exclusividade vem do banco, não de comparação na aplicação.

A exclusividade é garantida por duas camadas: o `SELECT ... FOR UPDATE` do item serializa supervisores concorrentes, e o índice único parcial `work_claims (work_item_id) WHERE released_at IS NULL` mantém o invariante ainda que alguém esqueça o lock. Um segundo índice parcial sobre `attempt_id` garante que uma tentativa pertence a no máximo um claim.

Expiração é **derivada** de `expires_at`, nunca um estado gravado que sobrescreva o anterior. Um claim vencido é recuperável: a aquisição seguinte o libera com razão `expired`, registra `work_claim_released` e só então concede o novo claim, deixando `superseded_claim_id` no evento `work_claimed`. A linha antiga permanece íntegra — expirar não apaga histórico.

A retomada é idempotente e explícita. Três operações permanecem conceitualmente distintas e não devem ser confundidas:

| Operação | Significado | Estado exigido |
|---|---|---|
| `replay` | devolve deterministicamente o resultado da mesma solicitação | claim ainda ativo |
| `renew` | extensão explícita da validade pelo mesmo proprietário | claim ainda ativo |
| `reacquire` | novo claim depois da expiração, referenciando o anterior | claim expirado |

Reenviar o mesmo `claim_id` ativo é **replay**: devolve o mesmo claim sem novo efeito, inclusive depois de o item ter saído de `approved` — por isso identidade e replay são verificados **antes** de elegibilidade. Reenviar um `claim_id` já expirado é recusado: renovar silenciosamente esconderia a interrupção, então a retomada é **reacquire**, com claim novo e `superseded_claim_id` no log. Reutilizar um `claim_id` com outro item, dono ou versão é conflito, não replay.

`renew` **não existe** nesta versão e não é exigido por nenhum item canônico da Fase E. Quando for necessário, deverá ser operação atômica própria, aplicável somente a claim ainda válido, sem iniciar tentativa nem alterar o estado do item.

`start_claimed_work_attempt` é o único caminho de `claimed` para `attempt_started`, vincula no máximo uma tentativa por claim e reaproveita `private.begin_work_attempt`, o mesmo corpo da execução comandada do INT-04 — cuja RPC pública e cujos payloads permanecem byte a byte inalterados quando não há claim. A razão registrada em `work_started` distingue `supervised_execution` de `commanded_execution`.

As razões de liberação formam lista fechada (`attempt_finished`, `released_without_attempt`, `expired`) e são validadas contra o que de fato aconteceu: liberar como `attempt_finished` sem tentativa iniciada, ou como `released_without_attempt` com tentativa iniciada, é recusado. Liberar de novo com a mesma razão é idempotente; com razão diferente falha fechado.

O banco enforça autoridade e posse (usuário, allowlist, estado, versão, presença da especificação de execução e exclusividade); a régua completa de elegibilidade do AUTO-01 continua sendo o predicado puro do core aplicado na fronteira, como já ocorre no INT-04. Ficam fora do AUTO-02: fila persistente, seleção do próximo item, laço contínuo, escolha de executor ou modelo, paralelismo, eleição distribuída e qualquer integração ou aplicação de resultado.

## Fila e seleção do trabalho autônomo (SUP-01 e SUP-02, Fase E)

A fila **não tem tabela própria**. Ela é projeção de `work_items`, do evento de aprovação vigente e de `work_claims`, exposta por `public.autonomous_work_queue()`. Por ser derivada, sobrevive a reinícios sem persistência adicional e não pode divergir do estado real: um item que deixa de ser elegível sai dela sozinho, sem intervenção nem rotina de limpeza.

Um item entra na fila quando é elegível pela régua completa do AUTO-01 e não pertence a ninguém. Item com claim ativo sai da fila; claim expirado ou liberado o devolve para retomada. Itens aguardando decisão humana, em execução ou encerrados nunca entram — o checkpoint humano continua soberano por construção, não por verificação adicional.

A régua de elegibilidade ganhou uma implementação SQL única e reutilizável (`private.is_autonomously_eligible`), espelhando `evaluateAutonomousEligibility`. Os predicados usam `CASE` com guarda explícita de NULL e de tipo, porque o `AND` do SQL não garante curto-circuito e `jsonb_array_elements` sobre escalar levanta exceção: entrada malformada resulta em `false`, nunca em NULL nem em erro. O predicado do core permanece a especificação do domínio, e os testes provam que as duas concordam caso a caso.

A ordenação é **FIFO pela sequência (`seq`) do evento `work_approved` vigente** — identidade única, monotônica e imutável do log append-only, imune a relógio, fuso e ajuste de horário. Empate é impossível por construção; o `work_item_id` entra como desempate secundário apenas para que a ordem seja total mesmo diante de entrada inesperada. Como a posição depende da aprovação da versão vigente, uma proposta revisada e reaprovada entra no fim da fila: a posição pertence à versão exata que se tornou executável.

`public.next_autonomous_work()` aplica a política V0 `oldest_approval_first`, que é exatamente a cabeça dessa fila, e devolve a razão da escolha (política, tamanho da fila e sequência do segundo colocado). Nenhuma ponderação de urgência, impacto, capacidade ou dificuldade participa — na dúvida, FIFO explicável. Escolher executor, modelo ou esforço pertence à Fase F.

Selecionar é **leitura e não emite evento**: o efeito auditável é o claim, que já registra `work_claimed`. Como a política é determinística sobre um log imutável, a escolha é sempre recomputável a posteriori; gravar um evento por consulta inundaria um log que não pode ser limpo. No core, `selectNextAutonomousWork` desconfia da entrada e falha fechado: fila com posições não contíguas, ordem não monotônica ou item repetido não seleciona nada, porque fila ambígua não autoriza execução.

Seleção e posse compõem com segurança sob concorrência. Dois supervisores podem selecionar a mesma cabeça — a leitura não bloqueia — mas apenas um adquire o claim; o perdedor é recusado no lock do item e, ao reconsultar, recebe o próximo item elegível. Não há execução dupla, inanição nem deadlock.

## Um trabalho ativo por alvo (SUP-03, Fase E)

A exclusividade **por item** (AUTO-02) e **por alvo** (SUP-03) são invariantes distintas e permanecem separadas: dois índices únicos parciais independentes sobre `work_claims`, um em `(work_item_id)` e outro em `(user_id, target_reference)`, ambos restritos a `released_at IS NULL`.

Alternativas consideradas para representar a posse do alvo: tabela própria `work_target_locks` — rejeitada por criar estado paralelo capaz de divergir dos `work_items`, exatamente o risco que o backlog manda evitar; verificação apenas na aplicação — rejeitada porque dois itens diferentes no mesmo alvo travam linhas diferentes, então nada serializaria a corrida; **extensão de `work_claims` com `target_reference` mais índice único parcial** — escolhida por ser a menor representação coerente, reaproveitar a posse existente e colocar a garantia no banco.

`target_reference` é derivado no servidor a partir de `intent.execution_spec.target.reference` e **nunca informado pelo cliente**. Ausente, vazio ou não textual falha fechado. O `kind` deliberadamente **não** participa da identidade do alvo: tratar `project:X` e `workspace:X` como alvos distintos seria a "definição frouxa de mesmo projeto" que fura o invariante. Mesma referência (após `btrim`) é o mesmo alvo físico; referências são opacas (Marco 004), então não há semântica de caminho a normalizar.

Um alvo está **ocupado** quando algum item está em `in_progress` **ou** possui claim ativo. O primeiro termo é indispensável e vale independentemente do claim, porque cobre dois casos reais: o claim que expira no meio de uma execução longa, e a execução comandada do INT-04, que não cria claim algum. Claim expirado ou liberado sobre item que **não** está executando não ocupa nada — o alvo nunca fica bloqueado permanentemente, e o claim vencido de outro item é liberado com razão `expired`, de forma auditável, quando o alvo é reivindicado.

Itens em `review`, `changes_requested` ou `blocked` **não** ocupam o alvo. A tentativa parou e produziu handoff; conforme o INT-03, resultado produzido nunca foi aplicado ao alvo. Bloquear ali seria confundir "aguardando humano" com "executando".

A corrida entre dois itens **diferentes** do mesmo alvo não é resolvida pelo lock do item — são linhas distintas. Um lock consultivo por alvo serializa os concorrentes, e o índice único parcial permanece como garantia final: se disparar, a corrida foi perdida e a recusa é traduzida em erro tipado. O lock do item é sempre adquirido antes do lock do alvo, o que impede ciclo.

Na fila, alvo ocupado **não descarta nem reordena** o item: ele ganha `target_occupied = true` e continua na sua posição, esperando. A seleção escolhe o mais antigo com alvo livre e informa `skipped_occupied_targets`, de modo que trabalhos em alvos diferentes progridem sem que ninguém perca a vez. Quando todo alvo está ocupado, o resultado é "aguardando alvo", que é distinto de fila vazia — o supervisor deve esperar, não concluir que não há trabalho.

**Costura conhecida:** a execução comandada do INT-04 bloqueia o alvo para o supervisor, mas o caminho inverso não é verificado — `start_commanded_work_attempt` não consulta ocupação de alvo, então um comando explícito do usuário pode iniciar execução em alvo com claim autônomo ativo. Fechar isso alteraria o contrato ratificado do INT-04 e pertence a um item próprio, com decisão humana.

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
