# Backlog — Modo Autônomo V0

> Backlog documental do [Plano 002](002-modo-autonomo-v0.md), derivado do [Marco 003](../marcos/003-trabalho-autonomo-seguro.md). O estado factual de cada item é registrado junto ao item. Itens descrevem a **capacidade necessária** do braço executor, nunca um fornecedor fixo (Claude, Codex e outros são executores substituíveis).

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

**Estado (2026-07-20):** concluído. Contrato puro `work-claim.ts` em `packages/core` (aquisição, vínculo de tentativa, liberação, status derivado e payloads append-only) com 38 testes de domínio, e persistência real em `public.work_claims` com as RPCs `acquire_work_claim`, `start_claimed_work_attempt` e `release_work_claim` (31 asserções pgTAP). A exclusividade é do banco — lock do item mais índice único parcial — e foi provada por **corrida real entre dois supervisores concorrentes**: o segundo bloqueou no lock e foi recusado com `work item is held by an active claim`, restando exatamente um claim, um evento `work_claimed` e nenhuma tentativa. Claim expirado é substituível de forma auditável (`superseded_claim_id`), sem apagar a linha anterior. O início da tentativa passou a compartilhar `private.begin_work_attempt` com o INT-04, cujos payloads permanecem byte a byte inalterados (suíte `commanded_execution` verde sem alteração). Seção correspondente na arquitetura. Fila, seleção do próximo item e laço contínuo permanecem em SUP-01–04.

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

**Estado (2026-07-20):** concluído como contrato de domínio, antes de schema. `WorkHandoffV1` estrutura o conteúdo que acompanha o `handoffReference` já existente do INT-04 — **não** é um segundo conceito concorrente: a referência opaca continua canônica e a projeção para a fronteira do INT-03 casa por ela, comprovado em teste. Campos classificados em correlação (item, tentativa, versão, claim), canônicos (estado, razão, feito, restante, decisões, riscos, próximo passo), evidência (recursos, validações, falhas, referências) e **deriváveis, que não são repetidos** — objetivo e escopo vivem na versão aprovada, e é assim que o contrato torna impossível ampliar escopo por handoff. Sucesso exige ao menos uma validação `passed` (relato `declared` não é evidência); validação reprovada é incompatível com sucesso e exige falha registrada; sanitização reutiliza a régua única do AUTO-03. Replay idêntico é idempotente e divergente falha fechado. 48 testes de domínio. Sem migration: o recorte é conceito antes de schema, como INT-01–03.

- **Problema:** trabalho relevante hoje pode existir só na memória de uma sessão de executor; interrupção significa perda e retrabalho.
- **Resultado esperado:** definição tipada de checkpoint/handoff (commit, branch, patch, artefato, checkpoint estruturado, relatório, evidência) e a regra: nenhuma tentativa termina — por qualquer razão — sem produzir um estado transferível referenciável.
- **Dependências:** AUTO-03. **Escopo:** conceito + tipos + validação de que toda razão de parada exige handoff correspondente. **Fora do escopo:** armazenamento binário de artefatos; sincronização entre máquinas.
- **Aceite:** tentativa sem handoff é inválida por contrato; cada tipo de handoff tem referência verificável (ex.: hash, caminho, id de evidência).
- **Evidências:** testes de domínio; exemplo real na Fase D.
- **Riscos:** handoff "de papel" que não permite retomada real — o teste de aceitação é retomar a partir dele.
- **Tamanho:** M · **Capacidade:** modelagem de domínio · **Raciocínio:** alto · **Checkpoint humano:** não · **Braço isolado:** sim

### AUTO-05 — Pausa e retomada

**Atualização (2026-07-28, ratificação e conclusão da Fase E):** o usuário ratificou, nos limites exatos das provas, a capacidade **“Checkpoint real pós-planejamento e retomada informada por contexto.”** O produtor real do runner, a transmissão canônica e opt-in pelo `LocalRunnerAdapter`, a persistência correlacionada e a nova tentativa com `carriedContext` estão ratificados; o INT-04 comandado permanece sem checkpoints e fail-closed diante deles, e o máximo continua sendo `review`. As provas determinísticas (runner 99, `mypy` 17, `compileall`, `LocalRunnerAdapter` 10, Supervisor 27, web 68, core 432, typecheck 5, pgTAP 16/447) e a prova real do item `b6d38d8b` sustentam a decisão. Esta era a última pendência canônica aberta da Fase E, agora **formalmente concluída em 2026-07-28 por ratificação do usuário**. Limitações e melhorias futuras registradas no [Plano 002](002-modo-autonomo-v0.md) não reabrem a fase. Próxima fase elegível: **Fase F — Uso sustentável de inteligência**, não iniciada.

**Atualização (2026-07-28, checkpoints reais — pronto para revisão):** o **produtor real de checkpoints** foi implementado e está **aguardando ratificação**; ver "Produção e consumo reais de checkpoints" no [Plano 002](002-modo-autonomo-v0.md). O runner local emite um checkpoint após o planejamento (protocolo `ANIMA_CHECKPOINT_JSON=`, projeção do `Plan` no `WorkCheckpointV1`, sem prosa/segredos/terminais); o `LocalRunnerAdapter` transmite em stream (opt-in por chamador, INT-04 comandado intacto single-shot); a retomada entrega `carriedContext` como preâmbulo `[RETOMADA]`. Provas determinísticas (runner 99, `local-runner` 10, supervisor 27, core 432, web 68, typecheck 5, pgTAP 16/447) **e** prova real com `qwen2.5-coder:14b`: ciclo completo item `b6d38d8b` — checkpoint persistido (seq 2552), abandono SUP-04 `declared_bounds_exceeded` (2554), retomada `resumed_execution` (2557), checkpoint da retomada (2558), `result_submitted` → `review` (2559), zero `result_accepted`, workspace byte-intacta. Fase E segue **aberta** até ratificação humana. Commits: runner `b7d17f9`/`5361101`, monorepo `cae9d92`.

**Atualização (2026-07-28, 2B.2):** a **retomada real (Etapa 2B.2)** foi implementada e **ratificada**; ver "Ratificação da Etapa 2B.2" no [Plano 002](002-modo-autonomo-v0.md). `planWorkResumption` recebeu a fonte discriminada `WorkResumptionSourceV1` com os ramos `terminal_handoff` (preservado) e `abandoned_checkpoint` (projeção só de fatos, correlacionada a `attempt_abandoned`). O Supervisor lê `abandoned_work_resumption_source`, planeja e inicia a tentativa nova por `begin_resumed_work_attempt` (claim + início atômicos, `reason='resumed_execution'`). `WorkHandoffV1` continua **exclusivamente terminal**; os três motivos (`lease_expired`, `duration_limit_exceeded`, `declared_bounds_exceeded`) atravessam **literais**, sem virar `InterruptionScenario`, `paused`, `timed_out` ou `time_limit_reached`. Provas: `supabase test db` 16 arquivos/447 asserções PASS (novo `work_resumption_reasons.test.sql` prova os três motivos ponta a ponta), core 432/432, supervisor 27/27, typecheck limpo. **Pendência nomeada da Fase E:** um **produtor real de checkpoints** no `LocalRunnerAdapter` (ainda emite zero) — sem ele, a retomada *prática* de ponta a ponta com executor real não é demonstrável.

**Atualização (2026-07-26, 2B.1):** a **persistência de checkpoint em stream no laço (Etapa 2B.1)** foi implementada, provada ao vivo contra o Supabase local e **ratificada**; ver "Ratificação da Etapa 2B.1" no [Plano 002](002-modo-autonomo-v0.md). O laço agora persiste cada checkpoint assim que chega (antes do próximo sinal), fail-closed em falha, com a tentativa aberta para o SUP-04 quando não há terminal; `record_commanded_work_terminal` passou a aceitar terminal posterior a checkpoints. Resta a **Etapa 2B.2** (retomada real), **não iniciada**: ler `latest_work_checkpoint`, projetar para `WorkHandoffV1`, chamar `planWorkResumption` (que permanece puro e intocado) e criar a nova tentativa/claim de retomada; falta ainda um produtor real de checkpoints (o `LocalRunnerAdapter` emite zero).

**Atualização (2026-07-26):** a **persistência de checkpoint (Etapa 2A)** — evento append-only `checkpoint_recorded`, RPCs `record_work_checkpoint`/`latest_work_checkpoint`, validador SQL e espelho puro no core — foi implementada, provada em base real (pgTAP total 406, PASS; corridas concorrentes reais medidas) e **ratificada**; ver "Ratificação da Etapa 2A" no [Plano 002](002-modo-autonomo-v0.md). Isso desbloqueia parcialmente o AUTO-05: `planWorkResumption` já pode, no futuro, ser alimentado por checkpoint persistido. A **retomada real (Etapa 2B)** — laço persistindo checkpoints em stream, projeção para `WorkHandoffV1`, `resumed_from_attempt_id`/`reason='resumed_execution'` e criação da nova tentativa — **continua não iniciada**, e `planWorkResumption` permanece puro e intocado.

**Estado (2026-07-20):** concluído como regras puras de domínio. Os sete cenários do Marco 003 formam lista fechada e compartilham o mesmo mecanismo — a distinção é de diagnóstico, não de caminho; nenhum dispensa checkpoint ou reaproveita posse. `planWorkResumption` retoma do handoff do AUTO-04 com **novo claim e nova tentativa**, carregando estritamente o que foi persistido (restante, próximo passo, riscos, recursos, falhas anteriores) — nunca contexto conversacional. Recusa fail-closed sem checkpoint, com correlação ou versão divergente, com identificador reaproveitado, com claim ainda ativo, com item `in_progress` (exige reconciliação do SUP-04) ou inelegível. Checkpoints humanos continuam soberanos: `review`, `changes_requested` e `blocked` não retomam sozinhos. Limite de tentativas esgotado sai como `requires_human` com `persistent_inability_after_limits` e limite `attempts`, reusando o vocabulário do AUTO-06 em vez de criar outro. 47 testes de domínio, com cobertura por cenário. A demonstração ao vivo de um cenário pertence à Fase E via SUP-04.

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

**Estado (2026-07-20):** concluído como contrato puro antes de persistência. `IntegrationBoundary` separa resultado produzido, aceite, autorização/recusa e registro de integração; exige handoff tipado, decisão humana explícita e correlação intacta do INT-02. Repetições idênticas são idempotentes, entradas divergentes e transições ambíguas falham fechadas. `completed` continua significando resultado aceito, nunca merge/deploy/aplicação. Nenhuma migration ou integração real foi criada; por isso pgTAP não se aplica a este recorte. **Ratificação humana cumprida (2026-07-20):** o Gean aprovou a sequência fechada, a separação entre execução, resultado, aceite e integração, a autorização humana obrigatória, o handoff vinculado ao resultado exato, a preservação da correlação, a idempotência e o comportamento fail-closed, sem efeitos externos.

- **Problema:** o risco permanente é "executou, logo aplicou"; produzir alteração não pode equivaler a integrá-la.
- **Resultado esperado:** fronteira formal entre produzir resultado (tentativa) e integrar (aplicar/mergear/publicar), com estados/eventos distintos e gate humano ou explícito entre eles.
- **Dependências:** INT-01. **Escopo:** regras de domínio + validação de transições. **Fora do escopo:** mecânica de merge/PR; publicação.
- **Aceite:** não existe transição válida de "resultado produzido" para "integrado" sem decisão registrada; testes provam a recusa.
- **Evidências:** testes de domínio + pgTAP.
- **Riscos:** atalhos de conveniência na Fase D violarem a fronteira.
- **Tamanho:** P · **Capacidade:** modelagem de domínio · **Raciocínio:** médio · **Checkpoint humano:** não · **Braço isolado:** sim

### INT-04 — Primeira execução sob comando

**Estado (2026-07-20): resultado produzido; checkpoint de revisão humana pendente.** O endpoint autenticado comandou o `work_item` `507af5ef-a72f-4451-8ddb-0747f5e4e856`, tentativa `e65d1de1-ef9c-4e13-8dd5-55d784642e87`, por um adaptador local com alvo resolvido apenas no nó. O runner `qwen2.5-coder:7b` produziu em isolamento o handoff `20260720T205121334287Z-result.zip`, SHA-256 `fbe7d1acf5a6017ea0eef7344d95882380be59122c8699ebbd481e8997c00e44`, contendo somente `calculator.py`; `python -m unittest` passou (1 teste) e o item entrou em `review`. A reentrega da mesma tentativa foi idempotente. O arquivo original permaneceu com SHA-256 `9445c47952abb8a7fc5d4a905d55b5be05771df1d69362ec597f9a50f7ede40d` e a árvore do piloto permaneceu limpa. `apply.status=not_attempted`; nenhuma aplicação, merge, push ou deploy ocorreu. A conclusão formal aguarda a decisão humana sobre o resultado.

**Ratificado (2026-07-20): revisão humana aceitou tecnicamente o resultado; INT-04 concluído.** A decisão apoiou-se na prova anterior acima somada a uma reprodução independente (bundle `20260720T221717004114Z-result.zip`, SHA-256 `8706d0ef9504893e7c2b1179b3af08bf15f727e2098653f63cdfd09204faad7e`, apenas `calculator.py`, `python -m unittest` verde), à robustez controlada do runner (`db704e4`) e ao teste de regressão que impede reinterpretação semântica de conteúdo (`5bd917d`). Limitações registradas: `qwen2.5-coder:7b` é estocástico (quatro tentativas para uma amostra verde; falhas de `SyntaxError` por escape duplo e `iteration_limit` corretamente barradas fail-closed). Nenhuma aplicação automática ocorreu; o piloto permaneceu byte a byte intacto. Detalhamento na seção "Aceite formal da Fase D (2026-07-20)" do [Plano 002](002-modo-autonomo-v0.md). O resultado produzido **não** foi aplicado, merjado nem deployado — isso permanece como decisão humana futura fora do INT-04.

- **Problema:** as duas metades comprovadas (orquestração no Anima; execução isolada no runner) nunca se tocaram; sem uma integração estreita, tudo acima é teoria.
- **Resultado esperado:** um `work_item` aprovado; usuário comanda "executar"; um adaptador concreto (fora do core) entrega o pacote a um executor real em workspace isolada; uma tentativa; evidências e resultado retornam tipados; revisão humana decide; nenhuma aplicação automática.
- **Dependências:** INT-01–03; ORQ-01–04; autorização explícita para integração externa. **Escopo:** um executor, um projeto, início manual. **Fora do escopo:** fila, supervisor, seleção de executor, segunda tentativa automática, aplicação/merge.
- **Aceite:** ciclo real completo dentro do produto (exceto a execução em si) com evidências persistidas; falha de integração deixa o item íntegro com histórico; sequência estreita do Marco 003 respeitada à risca.
- **Evidências:** registro da execução real; eventos correlacionados; testes do adaptador com executor simulado.
- **Riscos:** acoplamento aos internos do runner; vazamento de segredos/caminhos; escopo crescer para "já que estamos aqui".
- **Tamanho:** G · **Capacidade:** integração + programação + verificação ao vivo · **Raciocínio:** alto · **Checkpoint humano:** sim (comando de início e revisão do resultado) · **Braço isolado:** não (exige ambiente local e decisões do usuário)

## SUP — Supervisor V0

### SUP-01 — Fila persistente

**Estado (2026-07-20):** concluído. A fila é projeção, não tabela: `public.autonomous_work_queue()` deriva de `work_items`, da aprovação vigente e de `work_claims`, com espelho puro `projectAutonomousQueue` em `packages/core` (28 testes) e 28 asserções pgTAP. Persistência entre reinícios é consequência de ser derivada; um teste prova que nenhuma tabela de fila existe. Item com claim ativo sai da fila e claim expirado o devolve; item que entra em execução sai sozinho. A régua completa do AUTO-01 ganhou implementação SQL única (`private.is_autonomously_eligible`) com guarda de NULL e tipo, falhando fechado em entrada malformada em vez de levantar exceção.

- **Problema:** não existe representação persistente de "trabalhos aguardando execução autônoma"; sem fila, autonomia é um botão, não uma capacidade.
- **Resultado esperado:** fila derivada da fonte de verdade (itens elegíveis + ordem), persistente entre reinícios, sem estado paralelo que possa divergir dos `work_items`.
- **Dependências:** INT-04 comprovado; AUTO-01. **Escopo:** conceito + projeção consultável. **Fora do escopo:** prioridades configuráveis avançadas; multiusuário.
- **Aceite:** reiniciar o sistema preserva a fila; item que deixa de ser elegível sai da fila sem intervenção.
- **Evidências:** testes de projeção; pgTAP se houver persistência própria.
- **Riscos:** fila como tabela independente divergindo do estado dos itens — preferir projeção.
- **Tamanho:** M · **Capacidade:** persistência + modelagem · **Raciocínio:** médio · **Checkpoint humano:** não · **Braço isolado:** sim

### SUP-02 — Seleção do próximo item

**Estado (2026-07-20):** concluído. Política V0 `oldest_approval_first` — FIFO pela sequência do evento `work_approved` vigente, imune a relógio, com o `work_item_id` como desempate defensivo (empate é impossível no log). `public.next_autonomous_work()` devolve a escolha e sua razão (política, tamanho da fila, sequência do segundo colocado); `selectNextAutonomousWork` no core recusa fila ambígua (posições não contíguas, ordem não monotônica, item repetido). 16 testes de domínio e 14 asserções pgTAP, incluindo prova de que selecionar não grava evento, não cria claim e não altera estado. **Decisão registrada:** selecionar é leitura e não emite evento próprio — o efeito auditável é o claim, e a política determinística sobre log imutável torna a escolha recomputável. Corrida real entre dois supervisores: ambos selecionaram a mesma cabeça, um venceu o claim e o outro recebeu o próximo item ao reconsultar.

- **Problema:** com mais de um elegível, alguém precisa escolher o próximo de forma explicável e segura.
- **Resultado esperado:** política de seleção determinística e documentada (ex.: aprovação mais antiga primeiro, respeitando SUP-03), com a razão da escolha registrada.
- **Dependências:** SUP-01. **Escopo:** política V0 simples + registro da decisão. **Fora do escopo:** priorização por urgência/valor; reordenação pelo usuário (futuro).
- **Aceite:** dada uma fila conhecida, a seleção é reproduzível em teste; a escolha fica auditável.
- **Evidências:** testes determinísticos da política.
- **Riscos:** esconder juízo de valor numa heurística — na dúvida, FIFO explicável.
- **Tamanho:** P · **Capacidade:** programação · **Raciocínio:** leve · **Checkpoint humano:** não · **Braço isolado:** sim

### SUP-03 — Um trabalho ativo por projeto

**Estado (2026-07-20):** concluído. `work_claims` ganhou `target_reference` (derivado no servidor, nunca informado pelo cliente) e um índice único parcial `(user_id, target_reference) WHERE released_at IS NULL`, independente do índice por item — as duas exclusividades permanecem distintas. Alternativas consideradas e rejeitadas: tabela própria (estado paralelo) e verificação só na aplicação (não serializa itens diferentes). Ocupação = claim ativo **ou** item `in_progress`, este último valendo mesmo sem claim, o que cobre o claim que expira durante execução longa e a execução comandada do INT-04. Claim expirado/liberado não bloqueia o alvo; itens em `review`/`changes_requested`/`blocked` também não. Lock consultivo por alvo serializa itens diferentes; o índice é a garantia final. Na fila o item espera com `target_occupied`, sem ser descartado nem reordenado; a seleção pula para o alvo livre mais antigo e informa `skipped_occupied_targets`. 26 testes de domínio e 31 asserções pgTAP; corrida real com três sessões: dois itens no mesmo alvo (um vence, o outro é recusado e continua esperando) e um terceiro em alvo distinto adquirindo posse em paralelo. **Costura registrada:** `start_commanded_work_attempt` não verifica ocupação de alvo — fechar isso alteraria o contrato ratificado do INT-04 e exige decisão humana.

- **Problema:** paralelismo dentro do mesmo projeto/workspace gera conflito de arquivos, claims e revisão — a V0 proíbe isso por decisão do marco.
- **Resultado esperado:** invariante: no máximo uma execução autônoma ativa por projeto/workspace; segundo elegível espera; a noção de "projeto/alvo" fica registrada no item (vinda de AUTO-01).
- **Dependências:** SUP-01, AUTO-02. **Escopo:** invariante + testes. **Fora do escopo:** paralelismo entre projetos distintos (permitido só quando explicitamente habilitado; não é meta da V0).
- **Aceite:** corrida simulada entre dois itens do mesmo alvo resulta em um executando e um aguardando, sem deadlock.
- **Evidências:** testes de concorrência simulada.
- **Riscos:** definição frouxa de "mesmo projeto" furando o invariante.
- **Tamanho:** P · **Capacidade:** modelagem + programação · **Raciocínio:** médio · **Checkpoint humano:** não · **Braço isolado:** sim

### SUP-04 — Recuperação após interrupção

**Estado (2026-07-21):** **ratificado na revisão humana e encerrado** — a aprovação nominal de cada decisão, as evidências ratificadas e os riscos que sobrevivem estão em "Ratificação do SUP-04" no plano `002-modo-autonomo-v0.md`. A pendência que bloqueava a ratificação — a demonstração ao vivo de um cenário do Marco 003 com executor real — foi satisfeita e ratificada (commit `40b8815`). A revisão destacou como núcleo do aceite a recusa da reconciliação **57 s após a morte do executor**: a ausência do processo não foi tratada como prova, e a decisão só veio depois de o limite persistido vencer. Riscos registrados e não resolvidos: executor zumbi conceitual, tentativa comandada sem `max_duration_minutes` permanecendo em `in_progress` até decisão humana, e bundle de tentativa abandonada nem aceito nem descartado. O diagnóstico do backlog foi confirmado e localizado: nenhum caminho tirava um item de `in_progress` sem sinal do executor, então processo morto durante a janela de até 1800 s da rota `execute-commanded` travava o item **para sempre**, ocupando o alvo pelo SUP-05 e tornando o AUTO-05 estruturalmente inalcançável (`planWorkResumption` já recusava apontando para cá). `public.reconcile_supervised_work()` decide exclusivamente por fato persistido: a pergunta respondível não é "a execução terminou?" e sim "esta tentativa excedeu um limite declarado e guardado?" — o lease de `work_claims` (AUTO-02) e/ou `max_duration_minutes` da proposta aprovada (AUTO-01). Exige **todos** os limites aplicáveis excedidos; sem limite algum, sai como `requires_human` sem mutação. Novo evento `attempt_abandoned` com a única transição nova da matriz (`in_progress → approved`): afirmação estritamente mais fraca que concluir ou falhar, e é a fraqueza que a torna segura sem evidência do executor. Desfecho já persistido é materializado **sem** emitir evento novo; lease vencido é recolhido com a mesma razão `expired` de `acquire_work_claim`, preservando a linha; posse ainda válida é intocada. Alternativas rejeitadas: `failed` (afirma o não observado), `blocked` (beco sem saída — nenhuma RPC emite `work_blocked` e `begin_work_attempt` exige `approved`), apenas relatar (alvo ocupado para sempre) e lease para o caminho comandado (alteraria o INT-04 sem regressão). Fronteira: lock consultivo por usuário e `FOR UPDATE` por item; nunca pega lock de alvo, logo não há ciclo com `acquire_work_claim`. 65 asserções pgTAP novas e 381 no total sem falha; 23 testes de domínio no espelho puro. **Corrida real entre três sessões:** a concorrente bloqueou 4,02 s e retornou zero linhas, com exatamente um `attempt_abandoned` e um `work_claim_released` no estado final; a consulta otimista que uma verificação na aplicação faria leu "abandonaria = true" em 0,5 ms na mesma janela. **Impacto no INT-04:** guarda nova que recusa sinal tardio de tentativa abandonada, posicionada **depois** do replay idempotente; `private.begin_work_attempt` não foi tocado e o SUP-05 permanece idêntico. **Demonstração ao vivo (2026-07-21):** cenário `application_shutdown` do Marco 003 provado com a rota `execute-commanded`, o `LocalRunnerAdapter` e o runner local reais sobre cópia isolada do piloto — item `41fe2069`, `max_duration_minutes = 1`, o menor limite que o contrato permite, sem alterar timestamp algum depois do início. Servidor derrubado no meio da execução; item confirmado órfão em `in_progress` sem terminal e sem claim. **Reconciliação executada 57 s após a morte do executor recusou concluir qualquer coisa** (`attempt_within_declared_bounds`), e só abandonou depois de o limite declarado vencer — prova direta de que a decisão é do limite persistido, não da ausência. Exatamente um `attempt_abandoned`, item de volta a `approved`, segunda e terceira passadas com zero linhas, terminal tardio recusado com `attempt was abandoned by reconciliation`, workspace isolada byte a byte intacta. Detalhes e limitações em "Demonstração ao vivo do SUP-04" no plano. **Fora do escopo desta entrega:** o laço que escolhe e executa continua sendo SUP-02 + AUTO-02.

- **Problema:** o supervisor precisa sobreviver ao mundo real: processo morto, máquina reiniciada, Docker/Ollama fora, limite de provedor.
- **Resultado esperado:** ao religar, o supervisor reconcilia claims expirados, tentativas órfãs e checkpoints, e retoma (ou re-enfileira) sem duplicar execução nem perder evidência.
- **Dependências:** SUP-01–03; AUTO-05. **Escopo:** rotina de reconciliação + cenários nomeados do marco. **Fora do escopo:** alta disponibilidade; failover multi-máquina.
- **Aceite:** cada cenário de interrupção do Marco 003 tem teste (executor falso) e pelo menos um foi demonstrado ao vivo com evidências.
- **Evidências:** testes por cenário; demonstração real documentada.
- **Riscos:** reconciliação agressiva matando claims válidos; duplo processamento.
- **Tamanho:** G · **Capacidade:** orquestração + programação · **Raciocínio:** alto · **Checkpoint humano:** não · **Braço isolado:** parcialmente (demonstração ao vivo exige ambiente)

### SUP-05 — Exclusividade de alvo simétrica

**Estado (2026-07-21):** **ratificado na revisão humana e encerrado** — a aprovação nominal de cada decisão e as evidências ratificadas estão em "Ratificação do SUP-05" no plano `002-modo-autonomo-v0.md`. O diagnóstico do backlog foi confirmado no efeito, mas corrigido na causa: a assimetria não era comandado-vs-autônomo e sim **aquisição-vs-início** — `acquire_work_claim` verificava ocupação, `private.begin_work_attempt` não, e o caminho comandado apenas exibia o defeito primeiro por chegar ao início sem passar por aquisição. A fronteira atômica é `begin_work_attempt`, o corpo único que os dois caminhos já compartilhavam desde o AUTO-02, o que torna a simetria consequência estrutural em vez de duas cópias que precisariam concordar. Lock consultivo por alvo adquirido após o lock do item (mesma ordem de `acquire_work_claim`, sem ciclo). Três exclusões: o item não se auto-ocupa, o claim da própria tentativa não bloqueia a si mesmo, e o replay retorna antes da verificação — sem a última, a reentrega seria confundida com nova ocupação. Claim expirado não bloqueia nem é recolhido por este caminho: recolher posse alheia seria o roubo silencioso que o aceite proíbe. 25 asserções pgTAP novas e 316 no total sem falha. **Corrida real medida** entre um comando explícito e um claim autônomo: a sessão concorrente permaneceu bloqueada por aproximadamente 3,97 segundos, até a conclusão da transação concorrente, e então recusou com erro tipado; a consulta otimista que uma verificação na aplicação faria leu "alvo livre" em menos de 1 milissegundo durante a mesma janela — a janela de corrida é observável, não hipotética. **Impacto no INT-04:** alvo inderivável passa a falhar fechado com `execution target missing`; fora isso, RPC, assinatura e payloads permanecem byte a byte idênticos.

**Origem (2026-07-20):** costura identificada e deliberadamente deixada aberta no SUP-03, com ratificação humana. O SUP-03 impede que o supervisor reivindique alvo ocupado — inclusive por execução comandada —, mas `start_commanded_work_attempt` não consulta ocupação de alvo. Um comando explícito do usuário ainda pode iniciar execução sobre alvo com claim autônomo ativo. Fechar isso altera o contrato ratificado do INT-04 e por isso não foi feito dentro do SUP-03.

- **Problema:** a exclusividade por alvo é assimétrica: vale para o caminho autônomo e não para o comandado. Enquanto o Supervisor não inicia execuções reais o risco é teórico; a partir daí, dois braços podem atuar no mesmo alvo.
- **Resultado esperado:** nenhuma execução — comandada ou autônoma — inicia sobre alvo ocupado por claim ativo ou item `in_progress`. A verificação é atômica e garantida pelo banco; o bloqueio produz erro tipado e evidência auditável; nenhum claim é silenciosamente roubado ou liberado por uma execução comandada. A retomada da **mesma** execução é caso separado e continua permitida (é replay, não nova ocupação).
- **Dependências:** SUP-03. **Escopo:** estender a verificação de alvo ao caminho comandado, preservando idempotência do replay. **Fora do escopo:** mudar a sequência estreita do INT-04; paralelismo entre alvos distintos.
- **Aceite:** execução comandada sobre alvo com claim autônomo ativo é recusada com erro tipado; replay da mesma tentativa continua idempotente; nenhum claim é liberado ou roubado pelo caminho comandado.
- **Evidências:** pgTAP das duas direções; corrida real entre um comando explícito e um claim autônomo.
- **Riscos:** recusar uma retomada legítima por confundi-la com nova execução; alterar o INT-04 além do necessário.
- **Tamanho:** P · **Capacidade:** persistência + modelagem · **Raciocínio:** médio · **Checkpoint humano:** sim (altera contrato ratificado do INT-04) · **Braço isolado:** sim

> **Bloqueante — satisfeito em 2026-07-21:** devia ser fechado **antes** de o Supervisor passar a iniciar execuções reais. Com a ratificação do SUP-05 esse bloqueio cai. O registro permanece porque a condição era real e orientou a ordem da Fase E.

### Laço operacional — costura sem item próprio

**Estado (2026-07-26): implementado, comprovado ao vivo e ratificado.** A revisão humana aprovou nominalmente as sete decisões arquiteturais em 2026-07-26; ver "Ratificação do laço operacional" no [Plano 002](002-modo-autonomo-v0.md). Provas frescas na ratificação: espelho do SUP-04 23/23, laço 15/15, `typecheck` limpo nos cinco workspaces. Riscos que sobrevivem: `WorkHandoffV1` sem persistência e AUTO-05 em retomada real não iniciado.

Não é um item novo do backlog e **não deve virar SUP-06**: é o objetivo da Fase E, nomeado no plano e no próprio SUP-04 como "o laço que escolhe e executa continua sendo SUP-02 + AUTO-02". O diagnóstico foi confirmado no código — nenhuma das RPCs da fase tinha chamador em código de aplicação, e o único caminho vivo era a execução comandada do INT-04.

Ponto de entrada `POST /api/work-orchestration/supervisor-turn`, **uma volta por invocação**, sem daemon nem polling. Compõe as fronteiras ratificadas sem reimplementar nenhuma: reconciliar → selecionar → posse → início sob claim → executor real → terminal → liberação. Serialização inteiramente do banco, sem mutex em memória. Incerteza (executor que lança, transcrição inválida, terminal recusado) deixa a tentativa aberta para o SUP-04, sem inventar desfecho nem liberar posse.

15 testes novos em `apps/web`; 381 asserções pgTAP inalteradas. Prova ao vivo com dois itens em FIFO (`approval_seq` 4316 e 4319), um por volta, sem sobreposição, ambos terminando em `review`; terceira volta em `no_eligible_work`. Prova concorrente real com as duas recusas tipadas observadas (215 ms e 321 ms), sempre exatamente um claim e uma tentativa por item.

Detalhamento, limitações e confirmações de segurança em "Laço operacional do Supervisor V0" no [Plano 002](002-modo-autonomo-v0.md). **`WorkHandoffV1` continua sem persistência e o AUTO-05 não foi iniciado.**

## INTEL — Uso sustentável de inteligência

### INTEL-01 — Classificação de trabalho

**Estado (2026-07-28): implementado, ratificado e encerrado.** O primeiro incremento definiu em
`packages/core` o contrato puro V1 com cinco eixos obrigatórios, `unknown`
explícito, proveniência humana ou sistêmica e readiness separada da validade.
O segundo acrescentou o evento append-only
`work_intelligence_classified`, as RPCs
`record_work_intelligence_classification` e
`current_work_intelligence_classification`, concorrência otimista por revisão
esperada e um espelho puro que reconstrói e valida a cadeia de supersessão. A
reclassificação cria novo evento; a versão anterior nunca é sobrescrita. A
vigência é estrita à versão de proposta atual e aprovada, portanto uma nova
versão retorna ausência até receber classificação própria. O terceiro compôs
AUTO-01 e INTEL-01 no core e no banco: a fila, a criação do claim e o início
sob claim exigem classificação vigente e completa; ausência produz
`work_intelligence_classification_missing`, e qualquer `unknown` produz
`work_intelligence_classification_incomplete` com eixos em ordem canônica.
Propostas e aprovações continuam permitidas sem classificação, e o INT-04
comandado permanece fora do gate. Nenhum executor, provedor, modelo ou esforço
é selecionado, e o INTEL-02 não foi iniciado. Os critérios implementáveis do
INTEL-01 estão satisfeitos. O usuário ratificou os cinco eixos, o comportamento
de `unknown`, a proveniência, a reclassificação append-only, a vigência por
versão aprovada, o gate exclusivo do caminho autônomo e a separação do
INTEL-02. A decisão e suas evidências estão registradas em "Ratificação do
INTEL-01" no [Plano 002](002-modo-autonomo-v0.md).

- **Problema:** sem classificar complexidade, risco e reversibilidade, toda decisão de roteamento é chute.
- **Resultado esperado:** classificação tipada por item/tentativa (complexidade, risco, reversibilidade, clareza do plano, urgência), atribuída na proposta e revisável, persistida com proveniência.
- **Dependências:** Fase E operando. **Escopo:** conceito + tipos + registro. **Fora do escopo:** inferência automática sofisticada (começa com classificação assistida/manual).
- **Aceite:** todo item elegível carrega classificação; mudanças são eventos auditáveis.
- **Evidências:** testes de domínio.
- **Riscos:** classificação virar burocracia — poucos níveis, definições concretas.
- **Tamanho:** M · **Capacidade:** modelagem · **Raciocínio:** médio · **Checkpoint humano:** não · **Braço isolado:** sim

### INTEL-02 — Seleção de provedor e esforço

**Estado (2026-07-28): concluído e ratificado.** A política V1 aprovada mapeia
os cinco eixos do INTEL-01 para `light`, `standard` ou `strong`, escolhe a
menor rota disponível que satisfaça capacidade e esforço mínimo e usa urgência
somente para desempatar equivalentes. A decisão append-only é consultável por
tentativa e o banco recusa início sem rota ou com executor divergente. O
catálogo permanece genérico; a configuração inicial declara somente o runner
local real. INTEL-03 e INTEL-04 não foram antecipados. Evidências: 12 cenários
puros, integração do Supervisor, 20 provas específicas e regressão de 522
testes pgTAP, além de 609 testes Jest, `typecheck` e build de produção.

- **Problema:** hoje a escolha de executor/modelo/esforço é humana e implícita; a visão exige que seja automática, explicável e alinhada ao princípio "leve para operar, médio para construir, forte para decidir, destravar e revisar".
- **Resultado esperado:** política que mapeia classificação (INTEL-01) → executor/provedor/modelo/nível de esforço, registrando os fatores considerados (incl. recursos da máquina e limites conhecidos dos provedores).
- **Dependências:** INTEL-01; histórico de AUTO-03. **Escopo:** política V0 por regras explícitas. **Fora do escopo:** otimização por custo de token como objetivo primário; aprendizado de política.
- **Aceite:** para cada tentativa, a decisão de roteamento é consultável com fatores; a política é reproduzível em teste.
- **Evidências:** testes da política; decisões persistidas.
- **Riscos:** acoplar a política a nomes de fornecedores em vez de capacidades.
- **Tamanho:** M · **Capacidade:** design de política + programação · **Raciocínio:** alto · **Checkpoint humano:** sim (aprovar a política inicial) · **Braço isolado:** sim

### INTEL-03 — Escalonamento e redução

**Estado (2026-07-28): concluído.** Duas falhas consecutivas elevam exatamente
um nível, sem ultrapassar `strong`; resultado ou cancelamento quebra a
sequência. Uma tentativa antes escalada só volta ao baseline quando deixou
checkpoint estruturado com próximo passo e restante, sem falhas, e nunca reduz
abaixo do mínimo do INTEL-01. O histórico é reconstruído no banco apenas para
tentativas autônomas da versão aprovada. `work_routing_adjusted` registra
decisão e evidências antes da rota; banco e Supervisor falham fechados diante
de divergência ou rota insuficiente. Evidências: 10 cenários puros, integração
do Supervisor, prova SQL de duas falhas seguida de escalonamento, regressão de
532 testes pgTAP e 621 Jest, `typecheck` e build.

- **Problema:** falhas repetidas com executor leve desperdiçam tentativas; manter executor forte após o plano consolidar desperdiça capacidade.
- **Resultado esperado:** regras explícitas de escalonamento (após N falhas ou bloqueio persistente → executor/esforço mais forte) e de redução (plano consolidado/etapa mecânica → mais leve), sempre registradas como eventos.
- **Dependências:** INTEL-02; AUTO-05. **Escopo:** regras + integração com limites de tentativa existentes. **Fora do escopo:** ajuste dinâmico intra-tentativa.
- **Aceite:** cenários de escalonamento e redução reproduzíveis em teste; nenhum escalonamento ultrapassa limites/orçamento do item.
- **Evidências:** testes de cenário; eventos de roteamento.
- **Riscos:** ping-pong entre níveis; escalonamento mascarando problema de escopo (deve virar interrupção AUTO-06).
- **Tamanho:** M · **Capacidade:** programação + política · **Raciocínio:** alto · **Checkpoint humano:** não · **Braço isolado:** sim

### INTEL-04 — Orçamento e reserva de capacidade

**Estado (2026-07-28): concluído e ratificado.** O orçamento V0 limita cada
item a 3 tentativas autônomas em 24 horas (ou ao menor limite declarado), cada
usuário a 6 tentativas e 120 minutos em 24 horas e o modo autônomo a 45 minutos
por janela móvel de 60 minutos, preservando 15 minutos interativos. O consumo
vem do log append-only e a admissão é serializada no banco. O Supervisor para
antes da posse quando não há orçamento e, após checkpoint, bloqueia com razão
tipada e libera o claim quando o tempo ou a reserva se esgotam. O caminho
comandado permanece fora da contabilidade. Evidências: 15 provas pgTAP
específicas, regressão de 547 SQL e 631 Jest, `typecheck` e build. Com isso, a
Fase F está concluída.

- **Problema:** o modo autônomo não pode esgotar os limites de provedor do usuário nem monopolizar a máquina; "maximizar progresso confiável por unidade de recurso" exige orçamento.
- **Resultado esperado:** noção de orçamento por item/período (tentativas, tempo, janelas de provedor) e reserva de capacidade para uso interativo do usuário; execução autônoma para com razão tipada ao atingir orçamento.
- **Dependências:** INTEL-02; AUTO-03 (consumo registrado). **Escopo:** conceito + enforcement nos limites existentes. **Fora do escopo:** billing real; medição fina de custo por token.
- **Aceite:** orçamento atingido interrompe com checkpoint e razão; reserva impede o autônomo de consumir a capacidade interativa configurada.
- **Evidências:** testes de orçamento; cenário demonstrado.
- **Riscos:** contabilidade de consumo imprecisa — começar por unidades simples (tentativas, tempo) antes de tokens.
- **Tamanho:** M · **Capacidade:** programação + política · **Raciocínio:** médio · **Checkpoint humano:** sim (definir orçamentos padrão) · **Braço isolado:** sim

## UX — Experiência no chat

### UX-00 — Intenção natural para proposta persistida

**Estado (2026-07-29): pronto para revisão, não ratificado.** Pedidos naturais
de análise, síntese, documentação e organização de trabalho passam a criar
proposta versionada real em vez de cair em conversa livre. A proposta inicial é
deliberadamente planning-first e não inventa nó, alvo, caminhos, permissões ou
limites. `orchestration_not_enabled` deixa de ser silencioso. Para propostas e
capacidade ausente, a resposta é determinada pelo servidor; o modelo não pode
simular cartão nem alegar leitura/execução anterior à aprovação. Evidências:
551 testes core, 104 web, typecheck dos cinco workspaces, build e prova real
autenticada com persistência e reconstrução após refresh. Limite: transformar a
proposta aprovada em especificação autônoma completa permanece dependente de
nós locais e de refinamento posterior.

- **Problema:** intenção operacional curta podia produzir apenas prosa do modelo, inclusive cartão simulado e alegação falsa de acesso.
- **Resultado esperado:** intenção reconhecida → `work_item` e eventos persistidos → cartão real → decisão versionada, sem execução anterior.
- **Dependências:** ORQ-01–04. **Escopo:** interpretação conservadora, persistência existente, resposta honesta e cartão existente. **Fora do escopo:** resolver nó/alvo, fabricar permissões ou tornar a proposta automaticamente elegível ao Supervisor.
- **Aceite:** mensagem real cria cartão; conversa comum não cria trabalho; capacidade ausente é explícita; cartão e resposta sobrevivem ao refresh.
- **Riscos:** falsos positivos do classificador; confundir proposta de planejamento com autorização de execução.

### UX-01 — Cartão de execução

**Estado (2026-07-29): ratificado (web).** Cartão conversacional que é **exclusivamente projeção do estado persistido** (`projectAutonomousExecution` em `packages/core`, integrado ao `WorkPresentation`): estado da tentativa, executor/provedor/modelo/esforço, início, limites, checkpoint mais recente, pedido de controle pendente, resultado aplicado e bloqueio por orçamento. Pausa/cancelamento são **cooperativos**: `request_work_control` persiste a intenção sem mudar estado; o laço aplica via `apply_work_control_at_checkpoint` num checkpoint seguro (espelhando o `interrupt_work_on_budget` do INTEL-04), movendo o item para `blocked`/`cancelled`, gravando `work_paused`/`work_cancelled` e liberando o claim com `attempt_finished`; o orçamento para de contar em `work_paused`. Terminal tardio já é recusado pela guarda de estado do RPC ratificado; execução comandada (INT-04) fica fora do controle. Os três rascunhos de migration foram auditados e finalizados (removido `current_work_control_request`; guardas de allowlist/versão; ordem de aplicação). **Evidências verdes:** core 551, web 107, mobile 12, supabase 7 (2 integrações ignoradas), pgTAP `work_control` 20/20 + regressão 22 arquivos sem falha no Supabase local, typecheck 5 workspaces e build web. **Prova interativa:** na conta local descartável, o cartão iniciou o trabalho explicitamente selecionado, persistiu o pedido de pausa durante uma execução Ollama, aplicou-o no checkpoint #1 e reconstruiu após reload o estado `blocked`, “Pausada por você” e os quatro passos restantes. O alvo original permaneceu intacto; a execução ocorreu em workspace isolada. Detalhes em "UX-01 pronto para revisão" no [Plano 002](002-modo-autonomo-v0.md).

- **Problema:** execução autônoma sem projeção conversacional é caixa-preta; o chat é a entrada e a lente únicas.
- **Resultado esperado:** cartão de execução na conversa mostrando estado da tentativa, progresso conhecido, limites, checkpoint mais recente e ações de pausar/cancelar — sempre como projeção do estado persistido.
- **Dependências:** INT-04 (dados reais); padrão de cartões existente (F4/F5). **Escopo:** web primeiro; mobile em paridade em seguida. **Fora do escopo:** streaming de log bruto; telas dedicadas.
- **Aceite:** durante uma execução real, o cartão reflete eventos persistidos (nunca estado próprio); pausar/cancelar geram eventos e efeito real.
- **Evidências:** testes de componente; demonstração ao vivo.
- **Riscos:** poll/refresh criando estado fantasma; cartão virar console.
- **Tamanho:** M · **Capacidade:** programação de UI + integração · **Raciocínio:** médio · **Checkpoint humano:** não · **Braço isolado:** sim

### UX-02 — Cartão de decisão necessária

**Estado (2026-07-29): fluxo ponta a ponta implementado e pronto para ratificação interativa.** A revisão do incremento anterior encontrou duas lacunas: o pedido persistido ainda não continha o `InputRequestedPayloadV1`/`WorkHandoffV1` completo e a opção de retomada apenas devolvia o item a `approved`, sem iniciar uma nova tentativa pelo checkpoint. O cenário determinístico `ux02-deterministic-decision` agora produz progresso, checkpoint e `decision_required` sem depender de inferência do modelo. `record_work_decision_required` persiste o pedido e o handoff pausado; a projeção reconstrói o cartão desses eventos após refresh; `human_decision_resumption_source` e `begin_human_decision_resumed_attempt` consomem uma resposta `resume` uma única vez e abrem nova tentativa com o contexto do checkpoint. A interface web encadeia “Continuar” ao Supervisor somente depois da aprovação persistida; `cancel` termina em `cancelled`. Repetição idêntica é idempotente e alternativa divergente, resposta tardia ou tentativa terminal falham fechadas. Evidências verdes: core 563, web 123, mobile 12, pgTAP UX-02 26/26, typecheck dos cinco workspaces e build web.

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
