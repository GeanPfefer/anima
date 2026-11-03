# Single-Item — investigação temporal 23514

Data: 2026-10-09. Tipo: análise e testes offline. Branch dev; HEAD inicial/final `6bc4aadef9414d655600c2ea37c6be436b3628c8`; nenhum commit. Continuação do [registro053](2026-10-09-single-item-053-prova.md) e do [plano053](../planos/053-single-item-natural-session-results.md). Evidências anteriores preservadas; novas verificações em [diretório temporal](2026-10-09-single-item-temporal-evidencias/).

Resultado: **GO da investigação offline; NO-GO para promoção do combinado.** A causa imediata da recusa é comprovada; a origem da inversão temporal nesta execução permanece **indeterminada**. Não há demonstração de defeito exclusivo da segunda migration, nem de relógio do host incorreto. Há um contraexemplo temporal geral no produto, modelado offline, ainda sem prova SQL específica.

## Linha temporal recuperada

Fonte: `combined_candidate/natural-claim_acquire_start-reviewed/{fixture.sql,fixture.meta.json,session-S.json,session-A.json,session-B.json,locks-before-release.json,result.json}` e `combined_candidate/final/postgres-server.stderr` do diretório053. Horários abaixo são UTC do PostgreSQL; ordem lógica não deve ser confundida com ordenação dos valores do relógio.

| Ordem lógica / observação | Evidência |
|---|---|
| Fixture: BEGIN, criação da proposta, aprovação, classificação, claim e routing; COMMIT | SQL arquivado; processo exit0, duração monotônica do executor 0,250894903s. O runner só prossegue depois de `check_returncode()` e snapshot. |
| S/A/B recebem BEGIN antes da disputa | S PID20924, A20925, B20926. Cada READY coletado. Não se arquivaram `xact_start` individuais ou tempos monotônicos por envio. |
| S segura somente lock advisory do alvo | HELD=1. A/B não recebem pré-locks manuais de linha. |
| B tem timestamp transacional `22:15:59.931977` | Inferido de `updated_at=now()` na linha rejeitada, não de uma medição separada de `xact_start`. |
| A segura item e espera S no alvo | `pg_locks.waitstart=22:15:59.939438`; blockers=[20924]. |
| B espera A no item | `waitstart=22:16:00.036684`; ShareLock transação1195; blockers=[20925]; log confirma tuple(9,13) de work_items. |
| S ROLLBACK e saída | exit0, coleta completa. |
| A obtém alvo e recusa claim ativo | log `22:16:00.242`, espera303,531ms; erro às `.245`; SQLSTATE55000, exit3. |
| B obtém item após rollback de A | log `.245`, espera208,880ms; adquire claim e alcança helper de início. |
| B tenta UPDATE e falha | log `22:16:00.250`; SQLSTATE23514, exit3. |
| Coleta e limpeza | A/B/S completos, sem forced/timeout/readerErrors; rollbackEqual=true, cleanupEqual=true, backendsAfter=0. Dispatcher exit1. |

Linha rejeitada: item `bf86c503-f7f9-4076-b7a0-7a54ac3a1c46`, owner `ef793024-48b1-53a9-bbe2-658f76add511`, estado tentado `in_progress`, proposal_version1; `created_at=2026-10-09 22:16:01.252507+00`, `updated_at=2026-10-09 22:15:59.931977+00`. Diferença **1,320530s**. O próprio horário do log de erro está aproximadamente1,002507s antes do created_at. A precisão do log é milissegundos, a dos campos microssegundos.

## Proveniência e semântica

A fixture chama `pg_temp.make_proof_item` → `public.create_work_proposal`. A função efetiva OID19322 insere work_items sem informar created_at/updated_at. Ambos usam DEFAULT now(), conforme `20260714000000_work_orchestration_contracts.sql:90`; não há alteração dessas colunas nas migrations candidatas. A fixture informa timestamps de auth.users, que não são os timestamps de work_items. A classificação possui classifiedAt sintético independente; não alimenta created_at.

O UPDATE recusado é de `private.begin_work_attempt(uuid,uuid,integer,uuid,text,text,uuid)`, OID19461, chamado por public.start_claimed_work_attempt. Atribui `updated_at=now()` ao mudar approved→in_progress. Corpo raw idêntico nos dois catálogos arquivados, SHA256 `bcbfcbc7366406c1e5f09d55c9be6390b4d60e0ca0b6e9819b9d6bf86cb3e0cb`. A função de criação também é raw idêntica, SHA256 `eee288d543f349be202fed91baefb7339e179aebfa93b75ba196f15d9f6f5286`.

Triggers efetivos de work_items: guard_mandated_review_release (BEFORE UPDATE state), clear_terminal_work_focus (AFTER UPDATE state), work_items_verifier_requirement_monotonic (BEFORE UPDATE intent). Nenhum atribui created_at/updated_at; o primeiro não entra na condição review para este UPDATE, o último não é disparado por alteração apenas de state/updated_at. O AFTER não pode corrigir uma linha recusada pelo CHECK. FKs verificam referências, sem atribuição temporal. `public.set_updated_at()` existe para outras tabelas, mas não está associado a work_items no catálogo efetivo. Os três corpos de trigger são idênticos entre variantes. Defaults derivam do bootstrap íntegro; não houve coleta arquivada explícita de pg_attrdef neste cenário, limitação que a prova discriminante deve fechar.

[PostgreSQL15, funções temporais](https://www.postgresql.org/docs/15/functions-datetime.html#FUNCTIONS-DATETIME-CURRENT): now() e transaction_timestamp() representam o início da transação; statement_timestamp() representa o início do comando; clock_timestamp() lê o horário corrente durante sua execução. Esperar um lock não renova now(). Substituir now() por transaction_timestamp() não muda o resultado. statement_timestamp() ainda pode anteceder uma espera; clock_timestamp() sozinho não garante monotonicidade do relógio.

## O que está e não está explicado

**Comprovado:** 23514 é uma recusa real e integralmente coletada, porque updated_at<created_at; não é Broken pipe, deadlock40P01, timeout nem erro de classificação do runner. O CHECK é correto para a regra declarada. O timestamp de UPDATE vem de uma função histórica não alterada.

**Contraexemplo demonstrado apenas no modelo:** em READ COMMITTED, B pode iniciar uma transação; outra transação cria/commita um item; um comando posterior de B vê esse item e o atualiza com now() antigo. Isso viola o CHECK com relógio monotônico e operações de aplicação legítimas. Esperas não são necessárias, mas podem ampliar a janela. Para esta possibilidade basta uma transação composta longa, não um timestamp adulterado na fixture. Replay reconhecido retorna antes do UPDATE; recusa anterior também não executa essa atribuição. Não generalizamos isso a todos os caminhos de replay/retomada.

**Não explica integralmente a campanha:** no runner efetivo, a fixture já foi confirmada antes de abrir S/A/B. Assumindo defaults e corpos arquivados e um relógio não decrescente, timestamp da criação≤timestamp de B. Assim, apenas a estabilidade transacional de now() mais a espera não produz os valores observados. O cenário “registro criado durante a espera” é um contraexemplo geral, não a sequência comprovada deste runner.

**Hipóteses abertas:** uma regressão do relógio compartilhado entre fixture e B é compatível com os valores; causa, componente e instante não medidos. Defaults efetivos inesperados ou outro escritor não observado exigiriam evidência adicional, apesar do bootstrap/catalog gate e do isolamento reduzirem essas possibilidades. O log arquivado não contém reversão entre seus timestamps consecutivos; ausência de log no intervalo não prova monotonicidade. Não existem pares sincronizados host/container/PostgreSQL e monotonic clock por evento que permitam atribuir divergência ao host, WSL ou daemon. Fuso horário não explica dois timestamptz +00. Não foi inspecionada infraestrutura nesta sessão.

Classificação: **falha funcional comprovada, atribuição causal da campanha indeterminada**; fragilidade temporal histórica do produto demonstrada por contraexemplo offline. Sem prova de defeito da fixture, do gerenciamento053 ou da migration combinada. Nenhum PASS histórico foi reinterpretado.

## Comparação das variantes

Item/claim: ordem localizada item→claim, helper histórico de início inalterado; dois naturais completos passaram (A55000/B0). Combinado: para nova admissão antecipa advisory de orçamento antes de item→claim; replay e algumas recusas podem evitar esse lock; revalida autoridade após esperas. B observado esperou item, não há evidência de espera no orçamento neste cenário. Segunda migration não muda defaults, CHECK, helper begin_work_attempt ou expressão now() desse UPDATE. Pode modificar interleaving/duração e expor fragilidade prévia; não demonstra causalidade temporal exclusiva. Aumentar a duração da espera não torna now() posterior à criação. Passar no item/claim e falhar no combinado não é um experimento temporal controlado entre relógios/instantes equivalentes.

Combinado continua330/334 pgTAP, quatro FAIL históricos local/externo preservados. Segundo natural e provas posteriores interrompidos; não atribuídos PASS nem novas falhas. Esta investigação não altera a avaliação de deadlocks já observados.

## Proposta e única prova discriminante

Não implementar correção de produto agora. Caso confirmada a fragilidade em RPC legítima, proposta mínima no helper efetivo de início: atribuir timestamp de mutação limitado inferiormente por created_at e updated_at anteriores, por exemplo `GREATEST(v_item.created_at,v_item.updated_at,clock_timestamp())`, usando a linha relida sob lock. Preservar now()/v_now usados em orçamento, expiração, autorização e demais políticas. Isso é uma mudança semântica explícita do timestamp de mutação, não uma correção de política de orçamento; requer autorização, análise dos outros escritores e prova real. Não substituir todos os now() globalmente nem relaxar CHECK. Apenas GREATEST(created_at,now()) satisfaz esse CHECK, mas pode não representar o instante corrente e pode reduzir updated_at anterior. A proposta completa deve decidir a semântica monotônica por item.

Se a causa for relógio regressivo/ambiente, não “corrigir” fixture com timestamps retroativos nem alterar expectativas. Proposta restrita ao harness: instrumentar eventos e recusar preflight/prova temporal quando a fixture apresentar created_at posterior ao relógio observado, preservando valores brutos. Isso detecta a anomalia; não prova origem nem resolve transações legítimas antigas.

Após revisão e autorização posterior: **uma prova mínima instrumentada**, um novo descartável combinado, bootstrap e gate052 íntegros, nenhuma campanha334 repetida. Usar o mesmo controle natural acquire/start e um controle temporal sequencial no mesmo ambiente:

1. Arquivar pg_attrdef dos dois campos, triggers, helper efetivo e constraint; registrar relógio host UTC + monotonic_ns, clock_timestamp(), statement_timestamp(), transaction_timestamp(), pg_backend_pid() e xact_start em cada evento, identificando CID/cluster. A coleta host e SQL tem intervalo de latência; não tratá-la como sincronização exata.
2. Fixture em transação própria, registrar seus timestamps e row timestamps imediatamente antes/depois do COMMIT. Abrir S/A/B somente após confirmação, registrar três funções temporais no BEGIN/antes da RPC; coletar waits/xact_start por observador e relógio corrente na liberação de S. Capturar resultado completo e rollback/cleanup053.
3. Controle que discrimina o contraexemplo: B BEGIN e registro dos tempos; outra sessão cria/commita item e claim por RPCs autorizadas; B inicia esse claim em comando posterior, sem pré-locks manuais. Registrar se created_at>B.transaction_timestamp e se ocorre23514 no helper histórico. Cleanup auditado.
4. Se natural falha apesar da ordem fixture-antes-B, comparar tempos/eventos e defaults; regressão temporal medida favorece hipótese de relógio, mas atribuição ao componente exige evidência própria. Se controle antigo falha e natural não, fica comprovada a fragilidade de transação composta, sem provar causa histórica. Se nenhuma anomalia reaparece, causa histórica continua indeterminada. Não promover candidato só por não reprodução.

Não instrumentar SQL de produto, adicionar sleeps para “verde” ou reciclar os dois clusters encerrados. A prova acima é um roteiro, não executada nem autorizada nesta sessão.

## Validação e checkpoint

[Modelos](../../supabase/tests/single_item_temporal_model_test.py):11 PASS, incluindo horários reais, fixture anterior com relógio monotônico, criação durante transação antiga, espera, replay/recusa, ordem de locks, statement time e clock regressivo. São modelos, não prova SQL. Runner053:17 PASS. Integridade:2.484 arquivos de pacotes052r2,156 migrations,556 hashes bootstrap e5.681 evidências053 conferidos sem divergência; resultados brutos no diretório temporal. Nenhuma migration, fixture, expectativa pgTAP, pacote ou evidência053 modificada.

Mudanças desta sessão: teste temporal novo, este registro, evidências novas, ponteiros append-only no plano053 e estado vivo PRD. Git inicial/final e integridade arquivados no checkpoint. WIPs preexistentes e46 worktrees preservados, índice vazio. Nenhum Docker/SQL, efeito sobre residente, ferramenta reinstalada, serviço externo pago, promoção, INV-11 ou Resident Host. Gate `single_item_atomic_claim_unavailable` permanece ativo.

Próxima fronteira: revisão humana da classificação indeterminada e do roteiro discriminante; autorização específica antes de prova real ou implementação de produto.
