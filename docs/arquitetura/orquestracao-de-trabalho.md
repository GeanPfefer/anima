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
| `checkpoint` | snapshot estruturado retomável (`WorkCheckpointV1`) emitido mid-flight | não |
| `decision_required` | interrupção admitida pelo AUTO-06, com razão tipada | sim |
| `result` | resultado, evidências e handoff para revisão | sim |
| `error` | falha tipada, retryable explícito e handoff | sim |
| `cancelled` | reconhecimento cooperativo do cancelamento e handoff | sim |

Um transcript válido possui exatamente uma condição terminal; nada pode sucedê-la. Sequência quebrada, correlação divergente, entrada vaga ou término ausente falham fechados. Reentregar o mesmo `attemptId` com a mesma entrada deve devolver o mesmo transcript sem repetir efeitos, inclusive sob concorrência; reentrega com entrada diferente produz `attempt_payload_conflict` terminal e não retryable.

O sinal `checkpoint` (Etapa 1 da Opção B, aprovada em checkpoint humano) é o único não-terminal além de `progress` e o único que carrega continuação estruturada retomável **antes** do terminal: um `WorkCheckpointV1` enxuto com feito/restante, próximo passo, decisões, riscos, recursos tocados, validações, falhas, evidências e `handoffReference` — **sem** `status`/`stopReason`, que são fatos terminais. É opcional e emissível de 0 a N vezes; executores que não o suportam permanecem válidos emitindo zero, e por isso `terminalKinds` e `validateWorkExecutorTranscript` não mudam. `validateWorkCheckpoint` aplica a mesma régua estrutural e a mesma sanitização única do handoff (AUTO-04). A `sequence` é a da transcrição inteira, e sua monotonicidade é a chave anti-regressão. Ficam **fora** desta etapa e não estão implementados: a persistência (evento `checkpoint_recorded`, Opção B), a retomada real (AUTO-05) e a regra de idempotência por sequência, que pertence à futura RPC persistente.

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

A primeira borda efetiva implementada publica somente a branch derivada do
`WorktreeHandoffV1`. O target (provider, repositório, remote e branch-base) vem
da configuração confiável da aplicação; a branch e os SHAs vêm do handoff
persistido. O provider Git reconcilia antes de mutar, usa refspec explícito sem
force e comprova o remote depois do push. A persistência de `branch_published`
ocorre somente após receipt validado e não altera o estado `completed`. Criar PR,
mesclar, aplicar ou registrar `integrated` não pertence a essa autorização.

Não houve migration nem pgTAP no INT-03: o recorte implementa somente o contrato puro. Eventos persistentes, RPCs e mecanismo real de Git, merge, aplicação, publicação ou deploy pertencem a itens posteriores e não podem ser inferidos desta máquina de estados.

## Portabilidade e nós locais (Marco 004)

O Anima deve distinguir contexto pessoal portátil de recursos locais. Memória, decisões, trabalhos e checkpoints podem acompanhar o usuário entre dispositivos; arquivos, pastas, ferramentas e recursos de uma máquina permanecem sob um nó local e suas permissões explícitas. Portabilidade não implica copiar todo conteúdo para um banco ou expô-lo na rede.

Um nó local é executor de capacidades, não fonte de intenção nem interface concorrente. Contratos portáteis descrevem capacidade, alvo e referências opacas; não dependem de nome de máquina, caminho absoluto, sistema operacional, fornecedor ou transporte. A resolução de uma referência local acontece somente no nó autorizado, e dados sensíveis não podem vazar para eventos ou checkpoints portáteis.

Permissões para leitura, indexação, escrita, execução, transferência e administração são independentes e fail-closed. Nenhuma existe por padrão. Ações destrutivas, privilegiadas, estruturais ou com efeito externo continuam atrás de decisão humana conforme a política de interrupção. O INT-04 é a primeira prova estreita dessa direção, sem incluir sincronização, catálogo de dispositivos, administração geral ou acesso amplo ao filesystem.

## Interação com o computador e aplicações locais (Marco 007, direção)

> Direção arquitetural ratificada; **contrato e implementação não definidos** aqui. Esta seção registra o encaixe conceitual e as invariantes que qualquer materialização futura deverá respeitar — não cria adaptador, transporte, provider, taxonomia nem backlog.

O braço executor local do Marco 004 se estende à **camada visual/GUI/OS**: **perceber** o estado visível de aplicações e do sistema operacional e **operar** interfaces locais (abrir/focar, navegar, clicar, digitar, selecionar, copiar/colar, operar fluxos). É uma capacidade **provider-neutral** — o contrato de domínio não pode mencionar Claude, GPT, Codex, Ollama, transporte, processo ou runner concreto, exatamente como o `WorkExecutorAdapter` (INT-01) já exige.

Qualquer materialização futura opera **sob mandato** (envelope com escopo, impacto, alvo, duração, orçamento, dados permitidos e condições de parada) e preserva a separação **Supervisor → Executor → Reviewer/Verifier**. Cada **classe de efeito** — leitura/percepção, entrada/digitação, clique/navegação, seleção/cópia, envio, alteração, exclusão, publicação, autenticação — é uma permissão **distinta e fail-closed**, que amadurece por sua própria evidência e não é concedida por herança de outra. Conteúdo percebido de tela, documentos ou páginas é **dado, nunca instrução**: não altera o mandato nem concede autorização (proteção contra prompt injection). Toda atuação preserva **correlação, evidência observável, auditabilidade e idempotência quando aplicável**; efeitos externos ou sensíveis exigem **confirmação apropriada** à maturidade atual.

**Hierarquia de interação (não clicar se puder chamar).** Escolhe-se sempre o nível **mais semântico, preciso, auditável e seguro** que cumpra a tarefa, descendo só quando o nível anterior for inadequado ou indisponível: (1) **API/ferramenta nativa** → (2) **shell/filesystem** → (3) **DOM/acessibilidade do navegador** → (4) **automação de UI/acessibilidade do OS** (ex.: Windows UI Automation) → (5) **visão da tela** → (6) **mouse/teclado bruto por coordenadas** (fallback de última instância). Visão e coordenadas são legítimas, mas **fallback, não default**; quanto mais baixo o nível, maior a exigência de evidência e confirmação. É ordenação **conceitual e provider-neutral** (descreve níveis de acesso, não fornecedores), não um contrato — ver [Marco 007](../marcos/007-interacao-com-computador-e-aplicacoes-locais.md), "Correção/continuação — hierarquia de interação".

Antes de qualquer contrato: reusar o vocabulário existente (`WorkExecutorAdapter`, `ExecutionEventCorrelation`, mandato/`execution_spec`, terminais tipados) em vez de inventar fronteira nova, e tratar agendamento, recorrência e ciclos autônomos Supervisor → executor local como **fora de escopo** até nova autorização humana (ver Marco 007 e a seção "Fora de escopo desta fundação").

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

**Costura conhecida (fechada pelo SUP-05):** a execução comandada do INT-04 bloqueia o alvo para o supervisor, mas o caminho inverso não era verificado — `start_commanded_work_attempt` não consultava ocupação de alvo, então um comando explícito do usuário podia iniciar execução em alvo com claim autônomo ativo. Fechar isso alterava o contrato ratificado do INT-04 e por isso pertenceu a um item próprio, com decisão humana. O registro permanece aqui porque a decisão de adiar foi deliberada; a resolução está na seção do SUP-05.

## Exclusividade de alvo simétrica (SUP-05, Fase E)

A brecha deixada aberta pelo SUP-03 não era, como o enunciado supunha, uma assimetria entre o caminho comandado e o autônomo. Era uma assimetria entre **aquisição** e **início**: `acquire_work_claim` verificava ocupação do alvo, `private.begin_work_attempt` não. O caminho comandado apenas exibia o defeito primeiro, por chegar ao início sem passar por aquisição alguma.

Por isso a correção não foi acrescentar uma verificação ao caminho comandado. A fronteira atômica escolhida é `private.begin_work_attempt` — o corpo único que os dois caminhos já compartilhavam desde o AUTO-02. Uma implementação só torna a simetria **consequência estrutural**, não uma coincidência que duas cópias precisariam manter. Verificar em `start_commanded_work_attempt` foi considerado e rejeitado justamente por duplicar a regra, que é como assimetrias nascem.

A verificação **não pode** morar na aplicação, e a razão é a mesma do SUP-03 levada ao início da tentativa: dois itens diferentes no mesmo alvo travam **linhas diferentes**, então o `SELECT ... FOR UPDATE` do item não serializa nada e resta uma janela entre consultar e gravar. Isso foi medido, não deduzido: com um claim adquirido e ainda não commitado, a consulta otimista que a aplicação faria leu `alvo_ocupado = false` e retornou em menos de um milissegundo. Na mesma corrida contra o RPC real, a sessão concorrente permaneceu bloqueada por aproximadamente 3,97 segundos, até a conclusão da transação concorrente, e então terminou em recusa tipada. A janela existe e é observável.

O dispositivo é o mesmo já estabelecido pelo SUP-03: `pg_advisory_xact_lock` sobre `'work_target:'||user||':'||target`, adquirido **depois** do lock do item — a mesma ordem de `acquire_work_claim`, o que impede ciclo entre as duas funções.

Três exclusões são indispensáveis e cada uma corresponde a um modo de falha real:

| Exclusão | Sem ela | Contrato preservado |
|---|---|---|
| o próprio item não se auto-ocupa | nenhuma tentativa iniciaria | — |
| o claim desta tentativa (`p_claim_id`) não bloqueia a si mesmo | o caminho supervisionado recusaria a si próprio, pois chega segurando a posse do alvo | AUTO-02 |
| replay retorna **antes** da verificação | a reentrega da mesma tentativa seria confundida com nova ocupação e recusada | INT-04, AUTO-05 |

Claim expirado ou liberado **não** ocupa e **não** é recolhido por este caminho. Recolher posse alheia durante um início comandado seria exatamente o roubo silencioso que o aceite do SUP-05 proíbe; quem libera claim vencido de forma auditável, com razão `expired` e evento, continua sendo `acquire_work_claim`. O caminho comandado é inerte sobre posse de terceiros: recusa e não escreve nada.

Os erros reaproveitam as mensagens tipadas que a aquisição já usava — `work target is held by an active claim` e `work target is busy with a running attempt`, ambos `55000`. Mensagem idêntica para invariante idêntica: a simetria do contrato aparece também no que o cliente observa.

**Impacto assumido sobre o INT-04:** um item cujo `execution_spec` não permita derivar `target.reference` deixa de iniciar execução comandada e passa a falhar fechado com `execution target missing` (`22023`), como já ocorria na aquisição. Sem alvo derivável não há exclusividade a garantir, e iniciar assim seria executar precisamente onde a garantia não alcança. Nenhum fluxo existente depende disso — a rota `execute-commanded` já exige `evaluateAutonomousEligibility`, que reprova alvo ausente antes do RPC. Fora esse endurecimento, o contrato do INT-04 permanece: a RPC pública, sua assinatura e os payloads de `work_started` e `execution_started` continuam byte a byte idênticos quando não há claim, e o replay segue idempotente.

## Handoff obrigatório (AUTO-04, Fase B/E)

Nenhuma tentativa termina — por qualquer razão, inclusive sucesso — sem deixar estado transferível suficiente para que outra execução, instância ou capacidade continue com segurança.

O AUTO-04 **não cria um segundo conceito de handoff**. Ele estrutura o que acompanha o `handoffReference` já existente: a referência opaca do INT-04 permanece o ponteiro canônico para o artefato, e `IntegrationHandoff` (INT-03) continua casando por ela. `WorkHandoffV1` é o conteúdo que torna a retomada possível.

Os campos são classificados de propósito:

| Natureza | Campos |
|---|---|
| Correlação | item, tentativa, versão aprovada, claim (nulo na execução comandada) |
| Canônico | estado, razão de parada, o que foi feito, o que resta, decisões, riscos, próximo passo |
| Evidência | recursos tocados, validações tipadas, falhas, referências de evidência |
| Derivável | objetivo, escopo, tentativas anteriores, estado do item |

O que é derivável **não é repetido**. Objetivo e escopo vivem na versão aprovada da proposta e o handoff apenas aponta para ela — é assim que o contrato torna estruturalmente impossível ampliar escopo por handoff, em vez de depender de vigilância. Tentativas anteriores vivem no log append-only e não podem ser reescritas daqui.

Sucesso exige evidência: ao menos uma validação `passed`. Um relato `declared` é o que alguém afirmou, nunca fato verificado, e não sustenta sucesso — coerente com a semântica já estabelecida em F5. Validação reprovada é incompatível com sucesso e exige falha correspondente registrada; tentativa `failed` sem falha declarada é ocultação e falha fechado. Toda seção é lista estruturada sem entradas vazias: não existe handoff de texto livre. A sanitização contra credenciais e caminhos absolutos reutiliza a régua única do AUTO-03, exportada em vez de duplicada.

Reentregar o handoff da mesma tentativa com conteúdo idêntico é idempotente; com conteúdo divergente falha fechado, porque reescrever um handoff já registrado apagaria o estado a partir do qual alguém pode ter retomado.

Produzir handoff **não autoriza nada**. Ele não muda estado de item, de claim ou de integração, não substitui evento canônico algum e é incapaz de expressar autorização: integrar continua exigindo resultado aceito mais uma segunda decisão humana explícita (INT-03).

O AUTO-04 é conceito antes de schema, como INT-01–03: não há migration. A persistência do handoff estruturado acompanha a evolução dos eventos de término da tentativa.

## Pausa e retomada (AUTO-05, Fase B/E)

Retomar é eleger o último checkpoint válido somado às evidências persistidas e continuar dali com **novo claim e nova tentativa**. Nunca é confiar no contexto conversacional anterior de um executor: tudo o que atravessa a interrupção precisa ter sido escrito antes dela, no handoff do AUTO-04.

Os sete cenários do Marco 003 formam lista fechada — `provider_limit_reached`, `application_shutdown`, `machine_restart`, `container_runtime_unavailable`, `network_failure`, `model_failure`, `executor_change`. Não existe "outro", como na política do AUTO-06. Todos compartilham o **mesmo mecanismo**: a distinção entre eles é de diagnóstico e auditoria, não de caminho. Não há cenário privilegiado que dispense checkpoint ou reaproveite posse.

`planWorkResumption` é puro e fail-closed. Ele recusa quando:

- não há checkpoint persistido — retomar seria reconstruir por suposição, então o caso exige reparação ou decisão humana;
- o checkpoint pertence a outro item, ou a uma versão de proposta que não é a vigente — retomar ali mudaria o escopo aprovado;
- o checkpoint aponta tentativa ausente do histórico;
- o `attemptId` ou o `claimId` propostos repetem os anteriores — a retomada exige identidades novas, coerente com a regra do AUTO-02 de que claim expirado não é renovado e sim substituído;
- ainda existe claim ativo, o que duplicaria execução;
- o item está em `in_progress`, que precisa de reconciliação (SUP-04) antes de qualquer retomada;
- o item deixou de ser elegível.

Checkpoints humanos permanecem soberanos: `review`, `changes_requested` e `blocked` **não** são retomados automaticamente. `blocked` em especial aguarda informação, autoridade ou dependência externa pela régua ratificada do AUTO-01; resolver o bloqueio devolve o item a `approved`, e só então a retomada segue.

Limite de tentativas esgotado não vira loop: a decisão sai como `requires_human` com a razão tipada `persistent_inability_after_limits` e o limite atingido (`attempts`), reaproveitando exatamente o vocabulário do AUTO-06.

O contexto carregado para a nova tentativa é extraído **estritamente** do handoff: o que resta, o próximo passo, os riscos, os recursos tocados e as falhas anteriores. Falhas atravessam a interrupção — a retomada não recomeça limpa fingindo que nada deu errado. Planejar retomada é puro: não adquire posse, não inicia tentativa, não altera o checkpoint e não carrega autorização de aplicação ou integração.

A retomada automática, sem alguém pedindo, pertence ao SUP-04.

## Reconciliação após interrupção (SUP-04, Fase E)

### Diagnóstico confirmado no código

Nenhum caminho tirava um item de `in_progress` sem um sinal do executor. `private.begin_work_attempt` vira o item; o desfecho chega por `record_commanded_work_terminal` ou `finish_work_execution`. A rota `execute-commanded` fica até 1800 segundos entre os dois, executando o runner. Se o processo morrer nessa janela — máquina reiniciada, Docker fora, limite de provedor, rede caída —, o item permanece em `in_progress` **para sempre**: ocupa o alvo permanentemente pelo SUP-05, sai da fila do SUP-01 (que exige `approved`) e `planWorkResumption` recusa com `work_not_resumable` apontando explicitamente para cá. O AUTO-05 era, até aqui, estruturalmente inalcançável — o SUP-04 é o elo que faltava.

O que sobrevive a uma queda é exatamente `work_items.state`, o log append-only `work_events` e as linhas de `work_claims`. O executor, seu progresso e sua vitalidade são memória de processo e não sobrevivem a nada. **Não existe heartbeat**: o lease é o único contrato de posse persistido.

### O que a reconciliação sabe perguntar

Ausência de processo, executor ou heartbeat **não prova sucesso nem fracasso**. A pergunta que a reconciliação consegue responder não é "a execução terminou?" — essa ela não pode responder — e sim **"esta tentativa excedeu um limite que alguém declarou e o banco guardou?"**. Duas fontes de limite existem no contrato atual, e nenhuma é relógio solto:

| Caminho | Limite persistido | Origem |
|---|---|---|
| tentativa sob claim | `work_claims.expires_at` | AUTO-02 — o contrato de posse que `acquire_work_claim` já recolhe com razão `expired` |
| tentativa comandada | `execution_spec.limits.max_duration_minutes` | AUTO-01 — declarado na proposta **aprovada**, já validado por `private.is_valid_execution_limits`, medido a partir do `execution_started` persistido |

Sem nenhum limite declarado não há fato: a reconciliação relata `attempt_without_declared_bound` como `requires_human` e **não muda nada**. Com limites declarados, exige-se que **todos** os aplicáveis estejam excedidos — lease vencido com a duração ainda dentro do declarado não abandona, porque a execução pode legitimamente seguir viva. A posse vencida ainda assim é recolhida: recolher é seguro, abandonar não.

`attempt_abandoned` afirma estritamente que a tentativa excedeu seu limite declarado e deixou de ser a ocupante do item. É afirmação **mais fraca** que `result_submitted` ou `execution_failed`, e é essa fraqueza que a torna segura de emitir sem evidência do executor.

### Decisões possíveis

| Fato persistido | Ação | Vocabulário |
|---|---|---|
| desfecho já gravado, item ainda `in_progress` | aplica a transição da matriz normativa, **sem** emitir evento novo | `terminal_not_materialized` → `state_materialized` |
| posse aberta cuja tentativa já tem desfecho | libera com `attempt_finished` | `claim_open_after_terminal` → `claim_released` |
| posse aberta com lease vencido | libera com `expired`, linha preservada | `claim_expired` → `claim_released` |
| posse ainda válida | nada | `claim_active` → `none` |
| tentativa com algum limite ainda dentro | nada | `attempt_within_declared_bounds` → `none` |
| tentativa com todos os limites excedidos | evento `attempt_abandoned`, item → `approved` | `attempt_abandoned` |
| tentativa sem limite algum declarado | nada | `attempt_without_declared_bound` → `requires_human` |
| item `in_progress` sem tentativa correlacionada | nada | `attempt_missing` → `requires_human` |

Materializar estado derivado **não emite evento**: ele já existe, e duplicá-lo inventaria um segundo fato.

### Ações explicitamente proibidas

A reconciliação nunca conclui sucesso ou fracasso a partir do desaparecimento do executor; nunca toma, renova ou libera claim ainda ativo; nunca apaga linha, evento ou evidência; nunca aceita resultado, autoriza integração ou aplica coisa alguma; e **nunca inicia execução**. Devolver o item a `approved` restaura *elegibilidade* — escolher e iniciar continuam sendo SUP-02 e AUTO-02, e o `planWorkResumption` do AUTO-05 continua fail-closed sem checkpoint. São duas decisões distintas e ambas precisam passar.

### Alternativas rejeitadas

- **marcar a órfã como `failed`** — afirma um desfecho que ninguém observou;
- **mandar a órfã para `blocked`** — beco sem saída real: nenhuma RPC emite `work_blocked` e `begin_work_attempt` exige `approved`, de modo que a linha `blocked → work_started` da matriz é inexecutável. Trocaria um item travado por outro;
- **deixar em `in_progress` e apenas relatar** — o alvo fica ocupado para sempre e nada é restaurado, que é o defeito de origem;
- **dar lease ao caminho comandado** — alteraria o contrato ratificado do INT-04 sem regressão demonstrada; o limite da proposta aprovada já é contrato persistido suficiente;
- **reconciliar e já iniciar a próxima tentativa** — o backlog separa reconciliar de executar.

### Fronteira transacional e concorrência

Uma transação por chamada de `public.reconcile_supervised_work()`. Um `pg_advisory_xact_lock` por **usuário** no início serializa duas reconciliações inteiras; depois dele, `FOR UPDATE` por item, na ordem do id. A reconciliação **nunca** adquire lock de alvo — `acquire_work_claim` e `begin_work_attempt` pegam item→alvo, ela pega usuário→item e nunca pede o alvo, então não existe ciclo possível entre elas.

**Corrida real medida entre três sessões**, com um item cujo lease vencera: a sessão A reconciliou (posse recolhida + tentativa abandonada, item → `approved`) e segurou a transação; a sessão B, iniciada 1 segundo depois, **permaneceu bloqueada por 4,02 segundos** e, ao destravar, retornou **zero linhas** — nada restava a reconciliar. O estado final commitado tem exatamente **um** `attempt_abandoned` e **um** `work_claim_released`. **Contrafactual medido:** durante a mesma janela, a sessão C executou a consulta otimista que uma verificação na aplicação faria e leu `in_progress` com `lease_vencido = true` em 0,5 milissegundo — ou seja, decidiria abandonar uma segunda vez. A janela de corrida é observável, não hipotética, e o lock é necessário.

### Consequência assumida sobre o INT-04

Abandonar cria um estado que antes não existia: a tentativa deixou de ser a ocupante, mas seu executor pode continuar vivo e entregar depois. `record_commanded_work_terminal` ganhou uma guarda que recusa sinal de tentativa abandonada com `attempt was abandoned by reconciliation` (`55000`). A guarda entra **depois** da verificação de replay idempotente, para que a reentrega de um terminal legitimamente registrado continue idempotente. Fora ela, o corpo permanece byte a byte o da migration do INT-04. `classifyPersistedAttempt` ganhou o status `abandoned` e a rota `execute-commanded` recusa com `409` antes de gastar uma execução inteira que seria rejeitada no fim.

`private.begin_work_attempt` **não foi tocado**: o contrato ratificado do SUP-05 permanece idêntico.

## O laço operacional do Supervisor V0 (Fase E)

Até aqui a Fase E entregou capacidades sem chamador: fila, seleção, posse, início supervisionado e reconciliação só eram alcançáveis por pgTAP. O único caminho operacional vivo era a execução comandada do INT-04. O laço é a costura que torna essas capacidades reais em código de aplicação — e **nada além disso**: ele não é um item novo do backlog, e sim o objetivo da própria fase.

O ponto de entrada é `POST /api/work-orchestration/supervisor-turn`, e executa **uma volta por invocação**. Não há daemon, agendador nem polling: a periodicidade, se um dia existir, pertence a quem chama, e `requiresAnotherTurn` informa se vale insistir. A escolha por rota autenticada não é estética — toda RPC do ciclo resolve `auth.uid()` e consulta a allowlist, então um processo residente exigiria uma credencial de serviço nova, ampliando a superfície exatamente onde a V0 quer estreitá-la.

A sequência é fixa: reconciliar, selecionar, ler o item, adquirir posse, iniciar sob claim, delegar ao executor, registrar o terminal, liberar a posse.

A reconciliação vem **antes** da seleção porque religar sem reconciliar escolheria sobre um estado que a interrupção deixou mentindo. Ela não é reimplementada: o laço chama `reconcile_supervised_work()` e apenas relata o que ela produziu.

A aplicação **não julga** elegibilidade, ordem, ocupação de alvo ou posse. Todas essas regras vivem no banco e já foram ratificadas; aqui existe composição e tradução de recusa. O predicado `evaluateAutonomousEligibility` é chamado uma única vez e apenas como **parser** do `execution_spec`, para montar a entrada delimitada do executor. Se ele recusar um item que a fila ofereceu, isso é divergência entre o espelho puro e o espelho SQL — defeito, não licença para executar às cegas: a volta sai fail-closed, sem tomar posse.

Não há consulta prévia de disponibilidade antes do claim. Prever posse na aplicação é precisamente a janela de corrida que o SUP-05 mediu em menos de um milissegundo; a RPC é a fonte de verdade e a recusa dela é o resultado. A serialização é inteiramente do banco — lock do item, lock consultivo de alvo e índice único parcial — e **não existe mutex em memória**, que seria uma segunda fonte de verdade capaz de discordar da primeira.

O lease do claim é derivado de `max_duration_minutes` mais folga. Um lease mais curto que a duração declarada faria a reconciliação recolher a posse de uma execução legitimamente viva.

O terminal reusa `record_commanded_work_terminal`. A RPC valida por correlação do `execution_started` — que `private.begin_work_attempt` emite nos dois caminhos — e não por origem, então serve ao supervisionado sem alteração alguma. Criar uma RPC nova duplicaria a guarda do SUP-04 contra sinal tardio, e duplicar regra é como assimetrias nascem. O nome nasceu estreito; o contrato nunca foi.

**Incerteza não vira conclusão.** Se o executor lança, ou se a transcrição viola o contrato do INT-01, ou se o banco recusa o terminal, o laço **não** inventa desfecho e **não** libera a posse: a tentativa fica aberta, exatamente como a órfã que o SUP-04 sabe reconciliar por limite persistido. Liberar ali afirmaria um encerramento que não existe no log.

O desfecho máximo de uma volta é um item em `review`. Nenhum caminho do laço aceita, autoriza, integra ou aplica resultado — a fronteira do INT-03 permanece intacta.

## Persistência de checkpoint mid-flight (Etapa 2A, Opção B)

O sinal `checkpoint` do INT-01 ganha persistência **append-only, sem tabela nova**. `public.record_work_checkpoint` grava um `WorkCheckpointV1` como evento `checkpoint_recorded` — não-terminal, fora da matriz de estados, que **não muda o estado do item, não conclui, não aceita, não autoriza e não integra**. A RPC decide só por fato persistido e é fail-closed: exige item do usuário em `in_progress`, tentativa iniciada (por `execution_started`), sem terminal e não abandonada pelo SUP-04, versão aprovada correta, payload estruturalmente válido (`private.is_valid_work_checkpoint`, espelho SQL de `validateWorkCheckpoint` que reusa os primitivos existentes) e origem `executor`. Se há claim ativo no item, ele tem de ser o desta tentativa — o `claim_id` é **derivado no servidor**, nunca vem do sinal.

A `sequence` é a da transcrição inteira (1-indexada); a RPC não vê os `progress` não persistidos, então checkpoints são **monotônicos mas não consecutivos**. Para a maior sequência já persistida da tentativa: sequência menor recusa por regressão; mesma sequência com conteúdo idêntico é replay idempotente sem novo evento; mesma sequência com conteúdo diferente é conflito fail-closed; sequência maior registra. A comparação de replay é o mesmo dispositivo determinístico (jsonb `=` sobre o sinal bruto) que o terminal comandado já usa. A concorrência é serializada pelo `FOR UPDATE` do item, com o índice único parcial `(attempt_id, signal_sequence)` como garantia final; não há mutex em memória.

`public.latest_work_checkpoint` reconstrói o checkpoint de maior sequência apenas por fato persistido, preservando o histórico, com **ausência tipada** (NULL) quando não há nenhum. O espelho puro em `packages/core` (`reconcileCheckpointDelivery`, `selectLatestCheckpoint`, `projectCheckpointContinuation`) reproduz a mesma lógica e projeta a continuação **sem derivar `status`/`stopReason` terminais**.

Fora desta etapa (2B e adiante), e **não implementados**: o laço operacional, o `LocalRunnerAdapter` e o runner ainda não emitem checkpoints; `resumed_from_attempt_id`, `reason = 'resumed_execution'`, a criação de nova tentativa e a retomada real do AUTO-05 (que continua puro e fail-closed via `planWorkResumption`, jamais chamado aqui).

## Persistência de checkpoint em stream no laço (Etapa 2B.1)

O laço operacional passa a **consumir a transcrição do executor incrementalmente** e a persistir cada `checkpoint` assim que chega, **antes** do próximo sinal — para que uma tentativa cujo processo morra antes do terminal preserve todos os checkpoints já confirmados. `runExecutorStreamed` substitui o consumo que só devolvia o terminal: `progress` é observado e **não** persistido; `checkpoint` é gravado imediatamente por uma **porta genérica** (`CheckpointSink`, injetada pelo laço com uma chamada a `record_work_checkpoint`), sem acoplar o consumidor ao Supabase; o terminal único é processado depois de zero ou mais não-terminais. Replay idempotente segue normalmente; **falha ao persistir um checkpoint interrompe o consumo fechado**, sem processar o terminal, sem liberar a posse e sem inventar desfecho — a tentativa fica aberta para o SUP-04, com os checkpoints confirmados preservados. O mesmo vale quando o executor lança ou termina sem terminal. O caminho comandado do INT-04 permanece single-shot (`runExecutorOnce`, que rejeita checkpoints fail-closed); o `LocalRunnerAdapter`, o `BoundedWorkExecutorAdapter` e o runner **não** são tocados.

A guarda de sequência do terminal foi corrigida: `record_commanded_work_terminal` não exige mais `sequence == 1`. A `sequence` pertence à transcrição inteira, então o terminal pode vir depois de `progress` e `checkpoint`. O menor contrato persistente passa a exigir `sequence` inteiro positivo e, quando há checkpoint persistido em N, `sequence > N` (`sequence <= N` recusa fail-closed). `progress` não é persistido, logo **lacunas** entre o maior checkpoint e o terminal são legítimas — não se exige `terminal == checkpoint + 1`. A continuidade completa da transcrição continua sendo do `validateWorkExecutorTranscript`, no processo que consome o stream, não do banco. A guarda entra **depois** do replay idempotente e da recusa de tentativa abandonada (SUP-04), que permanecem; o `signal_sequence` gravado passa a ser o real do terminal.

Naquele marco ainda ficavam fora a retomada real (entregue na Etapa 2B.2 abaixo) e qualquer produtor real de checkpoints; o `LocalRunnerAdapter` segue emitindo zero.

## Retomada real após abandono (Etapa 2B.2)

`WorkHandoffV1` permanece exclusivamente o handoff de um `TerminalExecutionAttempt`. A retomada após SUP-04 não fabrica `status`, `stopReason` nem causa externa: `planWorkResumption` recebeu a fonte discriminada `WorkResumptionSourceV1`, com os ramos `terminal_handoff` (comportamento anterior preservado) e `abandoned_checkpoint`.

`AbandonedCheckpointV1` é uma projeção apenas de fatos append-only: tentativa e claim de origem, versão aprovada, `seq` dos eventos de checkpoint e abandono, `signal_sequence`, conteúdo do checkpoint, razão técnica fechada do abandono e instante persistido. `lease_expired`, `duration_limit_exceeded` e `declared_bounds_exceeded` são fatos operacionais; não são convertidos em `machine_restart`, `network_failure` ou outro `InterruptionScenario`.

`abandoned_work_resumption_source` distingue item nunca executado de tentativa abandonada, seleciona o maior checkpoint válido anterior ao abandono e preserva ausência como `checkpoint: null`. O laço chama `planWorkResumption`; ausência na fonte abandonada exige humano e nunca cai no início normal.

`begin_resumed_work_attempt` é a fronteira atômica final. Sob lock do item e lock consultivo do alvo, ela revalida estado `approved`, versão, evento `attempt_abandoned`, checkpoint escolhido e sua maximalidade, IDs novos e ausência de ocupação; então cria claim e tentativa novos. `work_started` e `execution_started` registram `reason = resumed_execution`, tentativa de origem, sequência e `seq` do checkpoint e `seq` do abandono. A tentativa e o checkpoint anteriores permanecem intactos.

O executor recebe `carriedContext` informativo com restante, próximo passo, riscos, recursos tocados e falhas anteriores, marcando explicitamente nova tentativa e continuação do checkpoint. Esse contexto não amplia permissões. O máximo da volta continua sendo `review`; aceite e integração não são derivados.

## Roteamento de inteligência por tentativa (INTEL-02)

O Supervisor não recebe mais um executor implícito. Ele recebe um catálogo de
rotas que separa o adaptador executável de sua descrição genérica:
`route_id`, `executor_id`, referências opacas de provedor e modelo, esforço,
capacidades, disponibilidade, latência e prioridade. A política pura
`work-routing-v1` consome a classificação vigente do INTEL-01 e escolhe a rota
disponível de menor esforço suficiente.

Os níveis são ordenados `light < standard < strong`. `light` exige,
simultaneamente, complexidade rotineira, risco baixo, reversibilidade e plano
claro. Qualquer complexidade alta, risco alto/crítico, irreversibilidade ou
plano incerto exige `strong`; o restante exige `standard`. Urgência pode
desempatar candidatos já equivalentes por latência, mas nunca reduz o esforço
mínimo. Ausência de rota compatível é uma parada tipada, sem fallback para uma
rota insuficiente.

Antes de adquirir posse, `record_work_routing_decision` grava
`work_routing_decided` no log append-only, correlacionando classificação
vigente, versão aprovada e `attempt_id`. O payload registra fatores, rota
selecionada e rejeições. `work_routing_decision` oferece a projeção consultável
e uma guarda `BEFORE INSERT` recusa `execution_started` autônomo sem esse fato
ou com `executor_id` divergente. A decisão pode ser o único evento anterior de
uma tentativa retomada; todos os demais usos prévios do identificador
continuam recusados.

O catálogo inicial contém somente a rota local realmente configurada. A
política não codifica fornecedor específico. Neste checkpoint do INTEL-02,
histórico de falhas, escalonamento/redução e orçamento ainda pertenciam
respectivamente ao INTEL-03 e ao INTEL-04.

## Ajuste de esforço entre tentativas (INTEL-03)

O ajuste é uma decisão separada da seleção de rota. O banco projeta somente
tentativas autônomas encerradas da versão aprovada, correlacionadas por
`attempt_id` a `work_routing_decided`; execuções comandadas não contaminam o
histórico. A política pura conta a sequência final de `execution_failed` e
`attempt_abandoned`. Com duas falhas consecutivas, sobe um nível; sucesso ou
cancelamento encerra a sequência; `strong` é teto.

Redução significa remover um escalonamento anterior, nunca reduzir o baseline
do INTEL-01. Ela exige que a tentativa escalada mais recente tenha um
`checkpoint_recorded` correlacionado, com `nextStep` não vazio,
`remainingSteps` não vazio e `failures` vazio. Isso usa estrutura persistida,
não interpretação de texto.

`record_work_routing_adjustment` compara byte a byte a decisão da aplicação
com `private.expected_work_routing_adjustment`, calculada sob lock do item.
Aceita apenas a versão aprovada atual e grava `work_routing_adjusted`
append-only. O evento contém `kind`, baseline, esforço efetivo, sequência de
falhas, IDs de evidência e razão. A decisão de rota subsequente deve declarar
esse esforço efetivo, e `execution_started` autônomo exige ambos os fatos com
o mesmo item, versão e tentativa. Falta de capacidade no novo piso interrompe;
nenhuma regra faz downgrade.

## Orçamento autônomo e reserva interativa (INTEL-04)

O orçamento V0 mede unidades observáveis já persistidas: tentativas e tempo.
Cada item admite até 3 tentativas autônomas em 24 horas, ou menos quando a
proposta aprovada declara um teto inferior. Por usuário, a janela móvel de 24
horas admite até 6 tentativas e 120 minutos. Em cada janela móvel de 60 minutos,
somente 45 podem ser consumidos pelo modo autônomo; os 15 restantes formam a
reserva interativa.

`private.autonomous_work_budget_usage` reconstrói o consumo a partir de
`execution_started` com `claim_id` e do primeiro desfecho correlacionado. Uma
tentativa aberta conta até o instante observado. O caminho comandado não possui
`claim_id` e, portanto, não entra nessa contabilidade. A decisão é consultável
por `autonomous_work_budget_status`.

A guarda `enforce_autonomous_work_budget_before_start` serializa por usuário e
revalida a decisão no `INSERT` de `execution_started`; duas admissões
concorrentes não podem ultrapassar o orçamento. O Supervisor faz uma leitura
antecipada antes do roteamento para evitar trabalho inútil. Quando ela nega a
admissão, `block_work_on_budget` materializa `input_requested` +
`work_blocked`, retirando o item da fila e preservando o checkpoint anterior
quando existe. Essa leitura não substitui a guarda autoritativa.

Depois que `record_work_checkpoint` confirma um checkpoint, o Supervisor chama
`interrupt_work_on_budget`. Se tempo global ou reserva se esgotaram, a RPC
registra `input_requested` e `work_blocked`, ambos correlacionados à tentativa e
ao último checkpoint, move o item para `blocked` e libera o claim. Nenhum
resultado é inferido e o terminal posterior do executor não é consumido. Os
limites de tentativas são gates entre tentativas; não encerram uma tentativa já
admitida. Tokens, dinheiro e janelas específicas de fornecedores permanecem
fora do V0.

## Governança de recursos da máquina — Resource Governor (V0 implementado)

> Direção arquitetural **investigada** (abaixo) e, no **V0 observacional/advisory**,
> **implementada** (ver §"Resource Governor V0 implementado" ao fim desta seção).
> Estende a "reserva interativa" do INTEL-04 (que reserva *tempo* de execução autônoma)
> para os **recursos físicos da máquina** (CPU/RAM/disco/GPU), e generaliza o "sob mandato"
> do [Marco 007](../marcos/007-interacao-com-computador-e-aplicacoes-locais.md) e os
> "recursos locais sob permissão explícita" do [Marco 004](../marcos/004-anima-portatil-e-nos-locais.md).
> Origem: sessão em **modo de convivência** (usuário jogando no mesmo PC). Detalhe/achado em
> `docs/registros/2026-08-16-modo-convivencia-resource-governor.md`; a implementação do V0 em
> `docs/registros/2026-08-17-resource-governor-v0.md`.

O problema: o Anima executa trabalho local (gates, coder backends, modelos locais, Docker/
Supabase, suítes) na **mesma máquina** que o usuário usa interativamente. Rodar workloads
pesados durante uso interativo degrada a experiência do usuário. O INTEL-04 já reserva *tempo*
de modo autônomo; falta reservar **recursos físicos**.

A direção **não** é aplicar thresholds fixos cegamente. O alvo é um **Resource Governor** que
**aprenda o custo real**:

```text
tipo de tarefa + repo + comando + histórico da máquina
   → previsão de CPU / RAM / I/O / GPU / duração
comparado com
recursos atuais + reserva do usuário
   → pode executar agora? adiar? exigir máquina exclusiva?
```

Capacidades desejadas (nenhuma implementada): conhecer a carga atual (CPU, RAM livre, processos,
I/O, GPU/VRAM, Docker/WSL, Ollama); prever o consumo de uma tarefa por classe (CPU-/RAM-/disk-/
network-/GPU-bound); aprender o custo real de execuções anteriores; reservar recursos para o
usuário; detectar atividade interativa importante (ex.: um jogo); limitar concorrência
automaticamente; rodar tarefas leves durante uso interativo; acumular/deferir tarefas pesadas;
avisar antes de uma fase de carga alta; aproveitar janelas ociosas para trabalho pesado; saber
quando precisa de "máquina exclusiva".

**Heurística V0 grosseira** (stopgap, enquanto não há predição aprendida): classificar cada
operação em **LOW** (leitura, edição, git local, testes muito focados), **MEDIUM** (typecheck
pequeno, suíte focada, poucos processos) e **HIGH** (full suites, builds, pgTAP completo, Docker
pesado, campanhas, modelos 14B/30B, GPU compute, paralelismo amplo). LOW/MEDIUM rodam sob
convivência; HIGH é adiado até uma janela de máquina livre, e — quando um HIGH for realmente
necessário para provar um recorte — o sistema **avisa e espera**, nunca afrouxa o gate. A
classificação é **coarse e provisória**: o alvo é a predição aprendida, não o rótulo fixo.

**Fundação já existente, subutilizada (through-line com o implementado):**

- **Custo observado.** A evidência de gate observada pelo host (`HostObservedGateEvidenceV1`) já
  registra `durationMs` real por gate — uma **semente de custo** que o governor pode acumular por
  `(comando, repo)` para prever duração. O mesmo padrão "host observa fatos de runtime" serviria
  para observar CPU/RAM/GPU de uma execução.
- **Observação barata.** O host mede a pressão da máquina com chamadas leves (`Get-CimInstance
  Win32_OperatingSystem`, `Get-Process`, `docker ps`, `ollama ps`, `nvidia-smi`), sem virar
  workload pesado — a medição não pode custar como o que ela evita.
- **Reserva sob mandato.** O "sob mandato" do Marco 007 e a "reserva interativa" do INTEL-04 já
  fixam que o usuário tem precedência; o governor generaliza isso de *tempo* para *recursos
  físicos*, e não concede autoridade nova — apenas decide **quando/como** executar o já autorizado.

**Achado concreto** (medido barato no modo de convivência): com o usuário jogando, o maior
consumidor atribuível ao trabalho de dev do Anima era o `vmmem` (VM do WSL2/Docker hospedando os
contêineres do Supabase), ~1,2 GB, com ~4,6 GB de RAM livre no total; **nenhum** modelo Ollama
carregado. Ou seja: em repouso, o gargalo dominante do modo autônomo local é o **Docker/Supabase**,
não os modelos. Um Resource Governor deveria tratar "subir Supabase" como custo **HIGH de RAM** e
liberá-lo quando ocioso — exatamente a ação tomada manualmente nesta sessão.

Exemplos do comportamento desejado (ilustrativos, não regras fixas): jogo ativo + GPU/VRAM
pressionadas → não carregar Ollama 30B; jogo ativo + alteração documental → executar normalmente;
jogo ativo + teste unitário pequeno → baixa concorrência; full suite + build + Supabase + Ollama →
esperar janela de máquina exclusiva.

**Fora do escopo desta direção:** modelo de predição, agendador, e qualquer automação que ganhe
autoridade nova. É **direção**, não contrato; a construção real exige recorte próprio e autorização,
proporcional ao valor. Invariante mantido: nenhuma decisão de recurso afrouxa gate ou validação — a
economia é de **quando/como** executar, nunca de remover prova.

### Resource Governor V0 implementado

O V0 realiza o eixo `observação real → evidência durável → classificação/advisory → histórico`
**antes** de `previsão → controle automático`. É **observacional e advisory**: sensor + histórico
+ classificação + parecer, **sem autoridade nova** — não mata processo, não para Docker/Supabase,
não descarrega modelo, não agenda, não produz nenhum efeito externo. Preserva a separação canônica
do Verifier: **EVIDÊNCIA ≠ CLASSIFICAÇÃO ≠ ADVISORY/DECISÃO**.

Camadas puras e determináveis (`packages/core`, sem LLM, sem schema novo):

- **Evidência** (`resource-observation.ts`): `WorkloadCostObservationV1` (tipo, comando, repo,
  instante, duração, desfecho, proveniência) + `MachineSnapshotV1` (memória/CPU/loadavg), com
  todos os campos de recurso **opcionais e honestos** (ausência > número falso). A **semente real**
  é `deriveWorkloadCostObservationsFromEvents`: reaproveita o `durationMs` já registrado na evidência
  de gate observada pelo host (`host_observed_gate_evidence_recorded`, append-only) — **custo zero
  de schema**. Idempotente; histórico não é apagado nem colapsado; envelope incoerente é descartado.
- **Classificação** (`resource-classification.ts`): custo `low/medium/high/unknown` **relativo à
  distribuição observada** (percentis p50/p90 dos próprios dados), não a thresholds universais;
  amostras insuficientes ou sem espalhamento → `unknown`. Pressão da máquina relativa à **reserva
  interativa injetada** (não constante embutida no core).
- **Histórico** (`resource-history.ts`): perfil `(tipo, comando, repo) → distribuição` com
  estatísticas simples e determinísticas (contagem, mediana, máximo, faixa de memória, classe
  predominante, última observação, falhas). Isolamento por chave (um workload não contamina outro).
- **Advisory** (`resource-advisory.ts`): `adviseWorkloadExecution` puro →
  `safe_to_run | prefer_defer | machine_exclusive_recommended | insufficient_evidence`, decidindo
  **quando/como**, nunca **se pode**, e nunca executando ação. `composeResourceGovernorView` é o
  read-model recomputável de UM alvo; `adviseWorkloadProfiles` estende o parecer a **cada** perfil
  histórico contra o mesmo snapshot/reserva (um turno exercita vários gates), sem colapsar workloads.

Lado host-side (`apps/web/lib/work-orchestration`): `machine-telemetry.ts` lê uma amostra barata e
pontual via `node:os` (sem dependência nova, sem polling; **omite `loadAvg1` no Windows**, onde
`os.loadavg()` é sempre 0). `resource-governor.ts` é o **seam central de leitura**: deriva o histórico
dos eventos, lê o snapshot vivo e compõe a visão — em vez de espalhar telemetria por cada executor.

**Consumidor real (implementado).** O advisory deixou de ser um seam sem consumidor:
`composeSupervisorResourceAdvisory` (em `resource-governor.ts`) é anexado ao read-model da resposta de
`POST /supervisor-turn` (`resourceGovernor`, **ao lado** de `value`, nunca dentro do resultado do
Supervisor). É um bloco **independente e totalmente fail-open** (fetch de eventos + composição sob
`try/catch`), **pós-terminal**, **fora do caminho quente** (`runSupervisorTurn`): um defeito de
telemetria/transporte vira advisory **ausente**, jamais um erro que altere a resposta do turno. Não
decide, não bloqueia, não muda elegibilidade. A leitura é **machine-wide**: alimenta o advisory com a
evidência de gate de **todos os itens do usuário** (`listEventsByType('host_observed_gate_evidence_recorded')`,
isolada pela **RLS já ratificada** de `work_events`, o mesmo padrão de `findResumableWorkItems`), não só
o item do turno — senão um item novo cairia sempre em `insufficient_evidence`. O custo é da **máquina**,
não do item; a chave do perfil `(kind, command, repo)` já agrega cross-item.

**Superfície na UI (implementada, read-only).** A projeção per-item `resourceCost`
(`projectWorkResourceCost`, pura, serializada pela presentation) é renderizada no `WorkProposalCard`
(web) e no `MobileWorkCard` (paridade UX-04): por comando de gate, contagem, duração mediana, classe
de custo e falhas — o **CUSTO** per-item (evidência + classificação), durável e serializado. Além
disso, o `WorkProposalCard` (web) surfa o **advisory machine-wide** devolvido pela resposta de
`/supervisor-turn` **após** uma execução autônoma, como painel de transparência (pressão da máquina +
recomendação por workload) — read-only, pós-execução, sem endpoint novo (usa o `resourceGovernor` que
já viaja na resposta). O advisory não teve papel na execução que já rodou; só informa. Descritores
compartilhados no core (`describeCostClass`, `formatObservedDurationMs`, `describeExecutionAdvisory`,
`describeMachinePressure`), a régua de `describeValidationOutcome`. Paridade mobile do painel de
advisory ainda não feita.

**Advisory pré-execução (implementado, read-only).** Além do parecer pós-turno, há um advisory
ACIONÁVEL antes de rodar: a rota `GET /api/work-orchestration/items/[id]/resource-advisory` compõe,
para os gates **declarados** no contrato do item (`declaredGateCommands` ← `execution_spec.validation_criteria`),
o parecer relativo ao histórico **machine-wide** de cada comando + a pressão viva (`composeItemGateAdvisory`
→ core `adviseDeclaredGates`). Diferente do pós-turno: um gate declarado mas **nunca observado** aparece
como `insufficient_evidence` em vez de sumir, e o report **nunca** é null (para pré-execução, mostrar os
gates do item é o ponto). No `WorkProposalCard`, o botão "Consultar parecer de recursos" (só quando o
item está aprovado e elegível) busca o endpoint e mostra o painel — **consultar não executa**. Read-only:
informa a decisão de rodar, não decide/bloqueia/muda elegibilidade.

**Persistência própria: avaliada e dispensada.** Antes de considerar schema/RPC novos, ficou
**demonstrado** que derivar de `host_observed_gate_evidence_recorded` **é suficiente** para o custo
cross-item — a limitação era só o **escopo per-item da leitura**, resolvido por uma leitura machine-wide
dos eventos que já existem. Nenhuma persistência nova foi criada.

**Ainda fora do V0 (fronteiras honestas):** predição/ML; agendador/daemon; qualquer **controle**
(matar, parar, descarregar, priorizar); telemetria de máquina persistida; observação de custo **além do
gate** (coder/suite/build/container — só o gate carrega `durationMs` num evento persistido; o resto
exigiria um ponto de observação novo no executor, com cuidado no caminho quente); paridade mobile do
painel de advisory. Nada disso concede autoridade — o V0 é sensor + parecer. A construção de qualquer
automação de controle exige recorte próprio e autorização.

## Verifier e evidência observada pelo host (independência real)

> Direção arquitetural ratificada (Marco 005/006) e **parcialmente implementada**.
> O Verifier é **advisory**: confere, não autoriza. O humano continua o gate final
> de aceite/integração. Detalhes de sessão em `docs/registros/2026-08-14-verifier-v0.md`,
> `2026-08-14-verifier-independencia.md` e `2026-08-15-host-observed-evidence-e-auto-mode.md`.

Duas independências distintas governam o ciclo autônomo, e são o eixo desta seção:

1. **`Policy != Executor`** (direção futura): quem quer executar não é a única
   autoridade que decide se pode. É a peça de um Policy Gate anterior à ação
   (registrada em "Benchmark do Claude Auto Mode" abaixo), ainda **não implementada**.
2. **`Evidence/Verifier != Executor`** (implementado no escopo abaixo): quem executa
   não é a única autoridade que produz a evidência usada para verificar o próprio
   trabalho.

O **Verifier V0** (`verifyWorkResult`/`verifyPersistedWorkResult`, puro e
determinístico em `packages/core`) re-deriva um parecer de três valores
(`verified`/`inconclusive`/`rejected`) do **contrato autorizador** (proposta
aprovada + critérios) cruzado com a evidência estruturada. Cada achado carrega
proveniência `independent` ou `attested`, e o parecer expõe `restsOnAttestedEvidence`:
honestidade de independência, nunca substituição do humano nem promoção automática.

### Evidência OBSERVADA pelo host vs ATESTADA pelo executor

O `WorktreeHandoffV1` (INT-05) é **atestado**: o executor põe os valores (arquivos
alterados, diff, SHAs, gates) no sinal `result`. Um executor mal-comportado pode
mantê-los internamente coerentes e assim **fabricar um `verified`** — a mitigação
antes desta etapa era só honestidade (`restsOnAttestedEvidence` exposto), não
prevenção.

A prevenção real, agora implementada para **git**: depois da execução, a branch
descartável `anima-work/<attemptId>` permanece no repositório (o dispose preserva a
branch). O **host** — código servidor que o executor não controla — inspeciona
essa branch diretamente (`observeHostGitEvidence`: `git diff` base..branch) e produz
uma `HostObservedGitEvidenceV1`. O git não mente sobre o que foi commitado.

**Persistência append-only** (`record_host_observed_evidence` → evento
`host_observed_evidence_recorded`): `author='system'` + `origin='host'` — proveniência
que o sinal do executor **não forja** por este nem por nenhum outro caminho (é outro
tipo de evento, outra RPC, outro autor). A RPC exige item do usuário, allowlist, uma
**tentativa real correlacionada** (`execution_started` na versão aprovada) e a
correlação casando com os parâmetros; é **idempotente por tentativa ignorando
`observedAt`** (reobservação determinística do mesmo git replaya; conteúdo divergente
é conflito `55000`) — impossível criar duas verdades num retry, ou reconciliável após
crash entre observar e persistir. Um índice único parcial por `attempt_id` é a garantia
final. A régua estrutural SQL espelha `buildHostObservedGitEvidence` (SHAs, `base!=commit`,
caminhos relativos, cobertura fixa `git=true`/`gates=false`).

**Consumo pelo Verifier**: `projectHostObservedEvidence` reconstrói a última evidência
do log (cruzando a correlação declarada contra o envelope do próprio evento) e
`verifyPersistedWorkResult` a passa como `observed`. Como `presentation` já compõe o
Verifier, a comparação **observed × attested** é viva e sem I/O: quando presente e
correlacionada, a evidência observada é a **autoridade sobre quais arquivos foram
alterados** (o escopo passa a ser conferido contra ela, proveniência `independent`), e
uma divergência entre atestado e observado vira `attested_contradicts_observed`.
**Observado vence; a contradição permanece visível como finding.**

A cadeia viva fecha assim: `Executor → host observa git → evento append-only →
projeção → Verifier compara observed × attested → humano (gate final)`. A observação é
fiada na rota `/supervisor-turn` (o host que conhece `repoRoot`/`baseSha`/`attempt`),
**fail-open**: qualquer falha só significa "sem evidência independente nesta volta" (o
Verifier recai na atestação), jamais altera o desfecho nem a resposta. O Supervisor
permanece provider-neutral — a observação vive na rota, não nele.

### Cobertura honesta V0

- **Git → independente.** Se o executor mentir sobre os arquivos alterados ou o commit,
  o host tem evidência independente suficiente para o Verifier detectar a mentira. Para
  git, a resposta é **SIM**.
- **Gates → independentes no caminho worktree** (`coverage.gates=true` quando há evidência
  observada). Ver "Independência dos gates — IMPLEMENTADA" abaixo: o host preserva sua
  observação de primeira parte dos gates que ele mesmo executa, sem reexecução, e o Verifier
  a trata como autoridade. Para executores que rodem gates fora do host, permanece atestado.
- **Não implementado**: captura de gate para executores remotos/não-confiáveis; qualquer
  política automática de maturidade.

### Parecer do Verifier persistido (append-only, versionado) — IMPLEMENTADO

> A distinção canônica: **EVIDÊNCIA** (histórico observado/atestado) ≠ **PARECER**
> (interpretação versionada da evidência) ≠ **DECISÃO** (autorização humana/política).

O `WorkVerificationReport` é o parecer EM MEMÓRIA (puro/determinístico). O
`VerifierOpinionV1` o embala para persistência auditável, acrescentando `verifierVersion`
(a versão da LÓGICA que concluiu — a política está embutida nela; não há hoje config de
política separada a versionar) e `evidenceBasis` (a identidade dos eventos de evidência
considerados: o `result_submitted` do handoff e o `host_observed_evidence_recorded` quando
presente, + a cobertura independente). Os achados vão compactados (código/severidade/
proveniência/sujeito), sem a prosa recomputável.

**Persistência** (`record_verifier_opinion` → evento `verifier_opinion_recorded`,
`author=system`/`origin=verifier`): o Verifier é uma função pura do host/system, não do
executor — o sinal do executor não forja esta proveniência. A RPC exige tentativa real,
correlação com os parâmetros e uma base de evidência que aponte eventos reais DESTA
tentativa (parecer não referencia evidência alheia).

**Histórico versionado, não verdade única.** O mesmo attempt pode legitimamente receber
mais de um parecer: quando a **evidência muda** (a observação do host aparece depois da
atestação: parecer sobre atestado apenas → parecer sobre atestado + observado) ou quando o
**Verifier evolui de versão**. A identidade é `(attempt, verifier_version, result_event_id,
observed_event_id)`: idêntico replaya; conteúdo divergente na mesma base é conflito `55000`
(o Verifier é determinístico); base ou versão diferente **acrescenta** sem apagar o
anterior. `projectVerifierOpinionHistory` reconstrói a evolução para auditoria.

**Recomputável = auditoria, não verdade a proteger.** Como `computeVerifierOpinion` é puro
sobre (item, eventos), um crash entre computar e persistir **não perde nada**: recomputa-se
no próximo seam a partir do log. Por isso a persistência não introduz efeito irreversível e
o wiring vivo (na rota `/supervisor-turn`, após o terminal `result`, lendo o estado fresco
que já inclui a evidência observada) é **fail-open**.

**Separação rígida vs `integration_decision` (ADR-002).** Um `VERIFIED` persistido NÃO
aceita resultado, NÃO cria nem decide integração (`integration_decided` é `author=user`,
outro fato, outro momento — pós-aceite humano, item em `completed`), não publica, não
mergeia, não deploya, não aumenta maturidade e não remove o gate humano. O parecer nasce em
`review` (pós-resultado, pré-aceite) e mantém o item em `review`. O parecer é **advisory**;
a autoridade permanece humana.

### Independência dos gates — IMPLEMENTADA (captura de primeira parte, sem reexecução)

> Decisão humana (2026-08-16): **não** reexecutar gates só para o Verifier. Em vez disso,
> preservar como evidência observada de primeira parte do host os desfechos que o host JÁ
> observa ao executar cada gate. A investigação anterior havia deixado duas opções (reexecução
> ou mover a execução de gate para fora do contrato); a decisão escolheu **nenhuma das duas** —
> capturar o que o host já mede, sem duplicar trabalho.

Fato do código: os gate commands rodam **em processo** no host (`runGate` → `runProcess` →
`child_process.spawn`), que mede diretamente `command`, `exitCode`, `durationMs`, `timedOut` e
`cancelled`. Quem roda o gate (`runGate`, TS de host) **não** é o `CoderBackend`/LLM (o autor
não-confiável do código) — é código de host. A independência é, portanto, relativa ao **autor
do código**: um executor que minta no `worktreeHandoff.gates` é contraditado pelo que o host
mediu.

O mecanismo separa os papéis sem reexecutar:

1. **Observação host-side** — o `WorktreeExecutorAdapter` recebe um `onGateObserved` injetado
   pela rota (o host), e reporta a ele os fatos brutos logo após cada `runGate`, **num canal do
   host separado** do `worktreeHandoff.gates` atestado. Inclui o gate que falhou.
2. **Evidência durável** — a rota `/supervisor-turn` coleta essas observações e persiste
   `HostObservedGateEvidenceV1` (evento `host_observed_gate_evidence_recorded`, `author=system`/
   `origin=host`, `record_host_observed_gate_evidence`), **inclusive em terminal de erro** (gate
   falho é a evidência mais valiosa). O `outcome` é **DERIVADO** do exitCode/timeout/cancelamento
   (a régua recusa um outcome que não seja o derivado), então o desfecho não pode discordar do
   código observado. Idempotente por tentativa; a proveniência system/host não é forjável pelo
   sinal do executor.
3. **Consumo pelo Verifier** — quando presente e correlacionada, a evidência de gate é a
   **autoridade** sobre o desfecho: gate observado falho reprova (`gate_failed`, `independent`);
   divergência por rótulo entre atestado e observado é `attested_gate_contradicts_observed`;
   todos passando é `gates_independently_observed`. `coverage.gates` do parecer vira **true**.

**Honestidade preservada.** Isto só produz evidência quando o **host** executa o gate (caminho
worktree in-process). Um executor futuro que rode seus próprios gates num processo separado
(ex.: runner em contêiner, backend em nuvem) **não** gera esta evidência — e aí `coverage.gates`
é honestamente **false** para aquele executor. Não há promessa de independência onde o host não
observa; `coverage.gates=true` só aparece quando a observação real existe.

Teste central provado: *executor atesta gate passou; host observa `exitCode != 0`; Verifier
marca `attested_gate_contradicts_observed` + `gate_failed` e NÃO conclui `verified`.* A
evolução da base (a evidência de gate chega depois) acrescenta um novo parecer versionado, sem
apagar o anterior. Fica **fora** deste recorte (futuro): captura de gate para executores
remotos/não-confiáveis, que exigiria reexecução ou um protocolo de atestação assinada.

## Benchmark do Claude Auto Mode e autonomia progressiva (direção)

> Direção arquitetural ratificada; **não implementada**. Registra a comparação com um
> sistema autônomo real (o Auto Mode do Claude Code) como benchmark externo e os
> princípios daí derivados. Detalhe em `docs/registros/2026-08-15-host-observed-evidence-e-auto-mode.md`
> e no [Marco 005](../marcos/005-autonomia-progressiva-e-identidade-una.md).

O Auto Mode do Claude é usado como **benchmark, não blueprint**: a pergunta não é "como
copiar o Claude?", e sim "que mecanismo resolve bem um problema real e merece ser
adaptado ao Anima?". A comparação cruza documentação declarada, comportamento real
observado durante o desenvolvimento do próprio Anima, princípios canônicos do Anima e a
arquitetura já implementada.

A cadeia arquitetural completa que orienta a direção (sem pular etapas):

```text
Policy Gate      → decide se a ação pode começar        (DIREÇÃO, não implementado)
Executor         → executa
HostObservedEvidence → registra fatos independentes      (IMPLEMENTADO p/ git)
Verifier         → avalia usando observado + atestado     (IMPLEMENTADO, advisory)
Historical Evidence  → acumula resultado real             (DIREÇÃO)
Maturity Policy  → poderá usar histórico p/ conquistar    (DIREÇÃO, BLOQUEADO)
                   mais autonomia por classe de ação
```

Princípios preservados como **direção ratificada** (a política automática permanece
**bloqueada**):

- **`Policy != Executor`** antes da ação, simétrico ao já implementado `Verifier != Executor`
  depois da ação. Um Policy Gate independente do Executor poderia classificar ações em
  `ALLOW` / `REQUIRE_HUMAN` / `DENY` (vocabulário **não congelado**).
- **Hard boundary vs maturity boundary.** Hard boundary: limite que a execução atual não
  pode atravessar mesmo que o Executor queira. Maturity boundary: limite que existe hoje
  mas é **conquistável por evidência e segurança**. Segurança limita o **estado atual** da
  autonomia, não a ambição final — uma maturity boundary não vira proibição eterna.
- **O componente não concede poder a si próprio.** O Anima pode editar o próprio código e
  propor evolução de permissões, mas uma execução **não** pode "determinar que já é M4" e
  imediatamente usar o novo poder. Promoções vêm de outra autoridade/processo e de
  evidência acumulada — o equivalente, no domínio de permissões, ao princípio de que o
  Executor não fabrica sozinho seu `VERIFIED`. Políticas que ampliam poderes devem viver
  numa camada de confiança que o próprio trabalho executado não consiga modificar e ativar
  na mesma execução (crítico para o futuro em que o Anima edita o Anima).
- **Dados estruturados e confiáveis > texto arbitrário para decisões de política.** O
  Policy Gate futuro deve receber fatos estruturados (ação, alvo, escopo de autorização,
  maturidade atual × exigida, efeito externo, rollback) e gates determinísticos, não a
  narrativa do Executor nem texto de páginas/arquivos não confiáveis.
- **Classificador semântico útil, nunca autoridade única.** Um classificador pode responder
  o difícil de codificar (escalada de escopo? compatível com a intenção? sinais de prompt
  injection?), mas o desenho preferido combina **política determinística + maturidade +
  evidência histórica + classificador quando necessário + Verifier**. Se uma ação exige M5 e
  o Anima está em M2, "parece seguro" não a torna permitida.
- **Bloqueios como evidência histórica.** Uma decisão de bloqueio pode virar evidência:
  ação bloqueada → autorizada explicitamente pelo humano → executada → host observa → Verifier
  confirma → padrão repetido sem incidentes pode contribuir para avaliar promoção de
  maturidade; o inverso (ação autorizada que produz problema) é evidência negativa. Maturidade
  futura é orientada por **histórico real**, não por confiança abstrata.

A diferença central que o Anima pretende manter: o Auto Mode ajuda a decidir "esta ação
pode ser executada agora?"; o Anima pretende também responder "o sistema já acumulou
evidência suficiente para **conquistar** mais autonomia nesta classe de ação?". Essa
autonomia progressivamente conquistada por evidência continua sendo uma diferença central
— e a política automática que a materializaria permanece **explicitamente não autorizada**.

## Fora de escopo desta fundação

- migrations, tabelas, enums, views, RPCs ou policies;
- tipos de domínio e serviços de aplicação;
- componentes, rotas, endpoints ou mudanças de navegação;
- APIs, CLIs, filas ou serviços externos;
- execução automática por Claude, Codex ou qualquer outro fornecedor;
- agentes autônomos ou conversas livres entre agentes;
- contrato, transporte ou provider concreto da interação com o computador/aplicações locais (Marco 007);
- agendamento, recorrência ou ciclos autônomos Supervisor → executor local, até nova autorização humana;
- Policy Gate / classificador de permissão funcional, política automática de maturidade, promoção automática de nível, ou uso de histórico para conceder permissões — a evidência histórica pode ser registrada, mas **não** decide autonomia sozinha; o gate humano permanece;
- reexecução/captura independente de gates (evidência observada de gate); persistência automática decisória do parecer do Verifier;
- XP, recompensas ou vínculo inicial com quests;
- catálogo configurável de capacidades;
- migração retroativa de conversas e quests existentes.
