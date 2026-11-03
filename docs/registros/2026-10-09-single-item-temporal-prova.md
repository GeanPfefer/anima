# Single-Item — prova temporal discriminante

Data:2026-10-09; tipo: prova. Branch dev; HEAD inicial/final `6bc4aadef9414d655600c2ea37c6be436b3628c8`; nenhum commit. Continuação do [relatório temporal offline](2026-10-09-single-item-temporal.md) e do [plano053](../planos/053-single-item-natural-session-results.md). [Evidências novas](2026-10-09-single-item-temporal-prova-evidencias/); registros053 anteriores preservados.

**GO da coleta discriminante; NO-GO de promoção/execução Single-Item.** O cenário original voltou a produzir23514. Nesta reprodução, o recuo do relógio é diretamente observado e explica por que uma fixture confirmada antes de B tem created_at posterior ao timestamp de B. O controle separado confirma também o problema de usar timestamp transacional antigo em um item criado por outra transação. Não houve correção de produto, campanha334, alteração de expectativas ou aprovação automática do combinado.

## Preflight e identidade

2.484 arquivos052r2,156 migrations e556 hashes de bootstrap conferidos.17 testes runner053 e11 modelos temporais PASS; quatro fontes do runner conferidas contra revisão053 pinada. Comparador/executor052 existentes, sem caminho novo de comparação. Git Windows: dev, HEAD acima, índice vazio e46 worktrees. Imagem `public.ecr.aws/supabase/postgres@sha256:af083ef64d0408c8f098ee6f5c364a59b26f36fbc0f3a334a62c5c1d57362e9b` disponível e verificada. Host inicialmente4.708.272KiB livres; residentes DB/Auth healthy. Vector unhealthy/restarting, sem mounts, rede residente distinta, condição preexistente admitida explicitamente; não foi classificado saudável.

Foi criado **um único** container, `fadc7d17bdcb742aa22d6dce808bbce5bdd3eddefc508b77d84c81e56ec959f3`, nonce `ade113f44e304a2fbde7da1c73e740c2` (nonce e nome exatos canônicos em slots.json/identity-manifest.json), cluster `7694808364713164930`. Identidade e daemon validados antes de SQL. Rede none, sem portas/binds/volumes persistentes, PGDATA/socket tmpfs, rootfs read-only, user postgres, cap-drop ALL, no-new-privileges,1CPU/1GiB memória e swap/64PIDs. Guard inspect+mountinfo passou antes de initdb. Nenhum histórico reutilizado, iniciado, removido ou alterado pelo executor.

272/272 etapas congeladas concluídas; aplicadas somente as migrations `20261009000000` e `20261009000001`. Gate integral **279 funções GO**, com memberships reais e proteção de corpos, identidades, owner, ACL, RLS, policies, triggers, constraints e índices. Somente2+4 corpos autorizados alterados, union5. Resultado do gate `GO_CATALOG_ONLY`, não GO funcional.

## Instrumentação e limites

Arquivo de prova: `temporal_runner.py` no diretório novo. Reutiliza `single_item_natural_pairs.run` e `NaturalSession` ativos/revisados. O código efetivamente instrumentado está arquivado como `combined_candidate/temporal-proof/instrumented-original.py`.

Mantidos BEGIN, RPCs, parâmetros, estados, ordem A/B/S e barreira S. Não foram inseridos comandos de tempo adicionais em A/B/S: ampliou-se o SELECT READY já existente para retornar now(), transaction_timestamp(), statement_timestamp(), clock_timestamp(). O SELECT ITEM já existente recebeu os mesmos campos e a linha completa. Amostras extras são de conexão observadora separada; snapshot confirmado da fixture é obtido antes de abrir S/A/B. A observação adiciona latência, explicitamente, sem pré-locks de linha nas RPCs. Nenhuma mudança em fixture canônica ou SQL de produto.

Amostras Windows/WSL/container são sequenciais, com brackets UTC e monotonic_ns no coletor; não demonstram sincronização exata nem qual relógio externo é correto. `statement_timestamp` do READY é a leitura direta daquele comando; query_start da RPC vem de pg_stat_activity. Não foi injetado SELECT no instante exato do UPDATE: o valor atribuído está no detalhe PostgreSQL da linha rejeitada, correlacionado ao now() diretamente medido no READY e ao corpo instalado.

## Cenário original: fixture confirmada antes de B

Horários UTC em ordem lógica, não ordenados por valor do relógio:

| Evento | Valores recuperados |
|---|---|
| Criação e aprovação da fixture | item `7a6cb1dd-55f8-4a13-9c50-4ee52c14ea09`; created_at=updated_at=now()=transaction_timestamp=`23:13:33.961482`; clock_timestamp no SELECT ITEM=`23:13:33.987825` |
| COMMIT concluído e observado | fixture exit0; observer clock_timestamp=`23:13:34.106328`; host após leitura=`23:13:34.116658`, monotonic_ns=9368354686666 |
| Primeiro envio BEGIN após snapshot confirmado | host=`23:13:33.594504`, monotonic_ns=9368573202443; **UTC recuou0,522154s enquanto monotônico avançou0,218515777s** |
| READY S/A/B | S PID19964; A19963; B19965. B now()=transaction_timestamp=`23:13:33.692737`; statement_timestamp=`23:13:33.693201`; clock_timestamp=`23:13:33.693510` |
| A enviada e esperando S | host ao enviar RPC=`23:13:33.695634`; ao observar espera=`23:13:32.842279`; **UTC recuou0,853355s enquanto monotônico avançou0,105677126s**; observer PostgreSQL clock_timestamp=`23:13:32.939010` |
| B espera A no item | blocker19963; xact_start de B=`23:13:33.692737`; query_start da RPC=`23:13:32.951966`, também anterior ao início registrado da própria transação por recuo do relógio |
| S libera barreira | ROLLBACK, exit0; coleta completa |
| A recusa claim ativo | SQLSTATE55000, exit3; log `23:13:33.313` |
| B retoma | log `23:13:33.314`; ShareLock transação1069, tuple(0,2) work_items; espera358,400ms conforme servidor |
| B tenta iniciar | log `23:13:33.319`; SQLSTATE23514, exit3; updated_at=`23:13:33.692737`, created_at=`23:13:33.961482` |

Inversão do CHECK: **268.745 microssegundos**. A leitura corrente do PostgreSQL após COMMIT,34.106328, também é posterior à leitura corrente de B feita depois,33.693510: recuo observado de0,412818s. A ordem desses eventos é sustentada por controle de execução e monotonic_ns, não por inferência de timestamps UTC.

A/B/S completos, sem forced/timeout/readerErrors. Resultado natural `FAIL_FUNCTIONAL`; rollbackEqual=true, cleanupEqual=true, backendsAfter=0. Nenhum40P01 neste cenário; isso não demonstra ausência global de deadlocks. Tempo de início/fim de B está delimitado pelo READY e pela coleta/pg_stat_activity. PostgreSQL não arquivou um commit timestamp da transação abortada; não se inventou um instante exato de término. Tempos de parede atravessando regressões não são métricas de desempenho comparáveis.

## Proveniência real e mecanismo causal

`pg_attrdef` real confirma os dois defaults `now()`. A fixture chama create_work_proposal sem informar esses campos; SELECT ITEM e snapshot pós-COMMIT comprovam a linha. Não há timestamp futuro literal nem criação concorrente durante a espera nesse cenário.

`private.begin_work_attempt` instalado atribui `updated_at=now()` ao mudar state para in_progress. SHA raw `bcbfcbc7366406c1e5f09d55c9be6390b4d60e0ca0b6e9819b9d6bf86cb3e0cb`, **idêntico** ao item/claim arquivado053. Triggers e constraints reais foram arquivados em temporal-provenance.json; nenhum trigger de work_items sobrescreve esses campos neste UPDATE.

[Semântica PostgreSQL](https://www.postgresql.org/docs/15/functions-datetime.html#FUNCTIONS-DATETIME-CURRENT): now()/transaction_timestamp ficam ligados ao início da transação; statement_timestamp pertence ao comando e clock_timestamp lê o horário corrente. Neste caso, a sequência é: fixture confirmada → relógio observado recua → B começa com timestamp inferior ao created_at → espera locks → helper conserva now() de B → CHECK recusa. A espera não renova now(). O recuo também atingiu leituras correntes do PostgreSQL; não é somente um timestamp transacional antigo ou desordem do logger.

Essa cadeia explica integralmente a **nova reprodução**. Para a ocorrência histórica053, os valores e a sequência são compatíveis com o mesmo mecanismo, mas não havia monotonic_ns nem leituras correntes instrumentadas: a atribuição histórica permanece sustentada por reprodução equivalente, não por medição retroativa daquele recuo.

Não foi identificado o componente que ajustou o relógio: Windows, sincronização WSL/Docker, kernel, virtualização ou outro mecanismo. As amostras externas mostram diferenças entre leituras Windows e WSL/container, mas não determinam qual estava correto. Não se atribui causalidade ao Vector ou às migrations pela coincidência temporal. O container não recebeu privilégios para ajustar relógio, e os corpos candidatos não contêm operações de ajuste de relógio.

## Controle mínimo: B iniciado antes da criação

No mesmo novo cluster, após limpeza do original, um controle separado abre B antes da fixture; sem pré-locks e com a mesma RPC de início e dados sintéticos.

B PID20298: now()=transaction_timestamp=`23:13:39.964483`; clock_timestamp READY=`23:13:39.965148`. Outra transação cria/commita o item `0973792a-2b01-4476-9051-3e64678d76a0`, created_at=`23:13:41.354047`. Observador confirma B ainda aberta com aquele xact_start. B tenta atualizar depois; erro23514 às `23:13:41.729`, updated_at=`23:13:39.964483`, inferior à criação por **1,389564s**. Exit3, resultado completo, sem timeout/forced. RowsEmpty=true, backendsAfter=0 após rollback implícito/cleanup.

A sequência não depende de timestamp adulterado nem inversão de locks. Leituras amostradas do controle são crescentes; isso não demonstra monotonicidade contínua de todo relógio entre amostras. Mesmo assim, o mecanismo de timestamp transacional antigo está diretamente comprovado: updated_at é exatamente o now() de B, iniciado antes da criação observada. Não é PASS funcional; é reprodução positiva da fragilidade histórica usando RPC legítima em transação composta.

## Classificação e decisão

| Hipótese | Conclusão limitada à evidência |
|---|---|
| Fixture/sincronização defeituosa | Não sustentada: fixture confirmada antes de A/B/S, timestamps por defaults, waits e resultados completos. |
| Timestamp transacional em função histórica | Confirmado no controle; mecanismo imediato do UPDATE em ambos. |
| Regressão exclusiva das migrations candidatas | Não demonstrada: helper e defaults inalterados; mudanças de locks podem alterar interleaving, não explicam sozinhas recuo global de UTC. |
| Divergência/recuo real de relógio | Confirmado no WSL e no PostgreSQL durante a reprodução original. Componente causador e relação precisa com relógio Windows não determinados. |
| Causa indeterminada | Continua aberta para o agente do ajuste do relógio e a medição histórica053; a cadeia desta reprodução está determinada. |

GO catálogo e coleta; **NO-GO correção combinada para promoção**, gate ativo. O coletor diagnóstico terminouexit0 porque conseguiu coletar os controles previstos; isso não substitui o FAIL_FUNCTIONAL/resultado não zero da rotina natural. `evaluation.json` explicita essa distinção. Não houve campanha pgTAP ou alteração das quatro falhas históricas local/externo.

## Menor delta recomendado, não aplicado

[Diff proposto](2026-10-09-single-item-temporal-prova-evidencias/proposal.diff): somente a atribuição de updated_at no helper efetivo de início, usando `GREATEST(v_item.created_at,v_item.updated_at,clock_timestamp())` com a linha já relida e bloqueada. Preserva ordem de locks, identidade, autorização, estado e políticas de orçamento; não substitui now() de orçamento, expiração ou replay. Timestamp de mutação teria semântica de horário corrente limitado inferiormente pelos timestamps da linha, explicitamente diferente do timestamp de transação.

Trocar apenas para transaction_timestamp não resolve; statement_timestamp ainda pode anteceder a criação/espera; clock_timestamp sozinho não protege contra recuo (o log do UPDATE original também antecede created_at). Não relaxar o CHECK nem retroceder a fixture. O limite inferior pode manter um timestamp futuro em relação ao relógio corrente; não deve mascarar telemetria de regressão.

Riscos e testes necessários antes de autorização/implementação: validar replay sem novo UPDATE/evento, recusa/rollback, transação antiga, clock regressivo modelado, exclusividade/claims estrangeiros, RLS/ACL, revogação, orçamento e ordens de locks. Inspecionar outros escritores de updated_at e cronologia de work_events: eventos ainda podem usar now() antigo, portanto esse delta resolve o CHECK no caminho de início, **não garante cronologia global**. Não ampliar automaticamente a mudança a eventos, triggers ou outros caminhos. Validar monotonicidade por item e floor em caso de updated_at anterior já maior que o relógio. Prova real posterior somente após revisão/autorização.

Para infraestrutura/harness: registrar regressões via monotonic/UTC e considerar gate de estabilidade temporal antes de novas campanhas; não ajustar relógios/serviços nesta sessão. A prova já distingue as hipóteses principais; repetir334 não é o próximo passo. Próximo passo mínimo é revisão humana do delta e decisão sobre diagnóstico operacional do ajuste de relógio, separada da correção de timestamp.

## Encerramento e integridade

Logs, SQL enviado, stdout/stderr completos, exit codes, SQLSTATE, waits, metadata e catálogo preservados fora do container.10 verificações offline dos resultados reais PASS, além dos28 testes preparatórios. Integridade final:2.484 arquivos de pacotes,156 migrations,556 hashes bootstrap,5.681 evidências053 e3.253 arquivos protegidos PASS. SHA256SUMS identifica as evidências desta sessão.

Novo container encerrado pelo PostgreSQL após validação de cleanup; status exited, exitCode0, restartCount0, OOMKilled=false; docker exec pg_ctl retornou137 com término do PID1, independentemente confirmado pelo inspect. Não removido. Tmpfs perdido após encerramento; não reutilizar. DB/Auth healthy e metadados inalterados, daemonID estável, redes/volumes iguais. Todos os históricos preservados; única mudança autônoma preexistente observada foi Vector restartCount154→164, ainda unhealthy/restarting. Recursos finais:4.664.784KiB livres no Windows; snapshots CPU/RAM arquivados. Não se alegou integridade linha a linha do residente: não houve SQL residente, a confirmação foi operacional por metadata/health.

Git Windows dev/HEAD acima/índice vazio/46 worktrees preservadas; WIPs anteriores preservados. Mudanças desta sessão: evidências/instrumentação temporária novas, este registro e ponteiros PRD/plano053. Nenhuma migration, orçamento, fixture canônica, expectativa, execução governada ou gate alterado. Sem INV-11, Resident Host, compute pago, staging/commit/push/reset/clean/prune, promoção ou remoção de containers.

**BLOCKED_BY_HUMAN_DECISION:** revisar o delta e os limites causais antes de implementação de produto, promoção ou nova campanha.
