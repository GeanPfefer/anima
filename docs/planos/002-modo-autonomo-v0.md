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
| A | **Aceita (2026-07-20)** | ORQ-01–04 comprovados ao vivo em web autenticado e em dispositivo físico (iPhone 14 Pro); Fase B desbloqueada |
| B | **Concluída (2026-07-20)** | AUTO-01 a AUTO-06 concluídos como contrato de domínio; AUTO-03 completo (ambiente e consumo) permanece adiado por decisão do próprio item |
| C | **Concluída (2026-07-20)** | INT-01–03 implementados e ratificados conforme seus checkpoints |
| D | **Aceita (2026-07-20)** | INT-04 ratificado na revisão humana (resultado tecnicamente aceito); handoff produzido, sem aplicação/merge — ver "Aceite formal da Fase D" |
| E | **Em andamento** | SUP-01 a SUP-05 completos e ratificados. O **laço operacional** (SUP-02 + AUTO-02 compostos) foi implementado, comprovado ao vivo e **ratificado (2026-07-26)** — ver "Ratificação do laço operacional". Resta a comprovação do AUTO-05 em retomada real, **não iniciada**, bloqueada pela persistência de `WorkHandoffV1`, que é tarefa separada com checkpoint humano |
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

### Registro de verificação da Fase A (2026-07-20) — demonstração web autenticada

Sessão real na stack local (Supabase + Next.js dev + Ollama), autenticada com conta descartável criada pela Admin API (`fase-a-demo-1784563575@teste.local`, usuário `4d848bc9`, habilitado na allowlist de orquestração). Todos os comportamentos exigidos por ORQ-01–04 foram exercitados pelo fluxo real do chat:

- **ORQ-01** — item `564f5738` criado por mensagem no chat (`work_proposed` v1 + `context_attached` atômicos); aprovado, iniciado, resultado registrado com evidências tipadas (referência, validações `passou`/`falhou`, limitação) e aceito. Cartão final `completed · v3` com "Resultado aceito · v3" e evidências preservadas; `result_accepted` aponta exatamente a versão 3.
- **ORQ-03** — correção pelo cartão gerou v2 (par atômico `proposal_changes_requested` v1 + `proposal_revised` v2, mesmo commit de transação); correção concorrente por segundo cliente gerou v3; aprovação sobre o cartão obsoleto em v2 foi recusada com HTTP 409 (`version_conflict`/55000), **sem nenhum evento de decisão**, o cartão reconciliou para v3 e a explicação "O item mudou desde a última leitura." permaneceu visível após o reconcile; a aprovação válida foi registrada uma única vez sobre a v3.
- **ORQ-02** — quatro itens no ciclo, dois ativos simultâneos; foco seguiu o item mais novo, troca explícita por "Usar como foco" persistida em `work_focus`; rejeitar o item em foco limpou o foco; mensagem de continuação ambígua produziu o cartão "A qual trabalho você se refere?" com os dois candidatos, e a escolha definiu o foco e anexou a mensagem como contexto (`context_attached` v2) sem duplicar trabalho.
- **ORQ-04** — reload completo da página reidratou mensagens, cartões, estados e foco; arquivar preservou a sessão e as 12 mensagens (`conversation_sessions.archived_at` preenchido, mensagens intactas); "Retomar conversa anterior" reabriu a conversa com todos os cartões reconstruídos de item + eventos + contextos (completed/proposed/rejected e foco corretos); aprovar o item em foco após a retomada registrou exatamente um `work_approved` v1.
- Log de eventos do item `564f5738` íntegro e sem duplicatas: `work_proposed` → `context_attached` → (`proposal_changes_requested`+`proposal_revised`)×2 → `work_approved` → `work_started` → `result_submitted` → `result_accepted`, todos os eventos de decisão ancorados na v3.
- Suítes no mesmo HEAD (`0c1569a`): typecheck 4 workspaces + mobile, core 61, supabase 7, web 31, pgTAP 177, build web — todos verdes.
- **Mobile (sem dispositivo):** typecheck verde; `MobileWorkCard`/`mobile-work.ts` consomem o mesmo domínio `@anima/core` (coberto pelas suítes) e implementam reconcile pós-erro com mensagem preservada (`run()` recarrega via `reloadWork` mantendo o erro exibido). Não há tooling Android/iOS nesta máquina; a execução em dispositivo físico/emulador **não ocorreu** e é o único aceite restante da Fase A.

#### Roteiro manual mobile (único aceite pendente)

Pré-requisito: Expo Go em dispositivo na mesma rede, Supabase local acessível, usuário allowlisted. Passos determinísticos:

1. `npm run dev:mobile`, abrir no dispositivo, logar e enviar "Planeje uma melhoria no app" → **esperado:** cartão de proposta v1 em foco.
2. Pedir correção pelo cartão → **esperado:** cartão passa a v2 com o ajuste no escopo.
3. Em um navegador web logado na mesma conta, pedir outra correção (v3); no dispositivo, sem recarregar, aprovar o cartão v2 → **esperado:** recusa com mensagem compreensível, cartão reconcilia para v3 e a mensagem permanece visível.
4. Aprovar v3, iniciar, registrar resultado com uma validação `ok:` e uma `falha:`, aceitar → **esperado:** cartão `completed · v3` com evidências.
5. Fechar e reabrir o app → **esperado:** conversa e cartão reconstruídos com o mesmo estado.
6. Evidências a registrar: capturas de cada passo e `SELECT event_type, proposal_version FROM work_events WHERE work_item_id = '<item>' ORDER BY seq;` sem duplicatas.

Com o roteiro cumprido em dispositivo, a Fase A pode ser declarada aceita e a Fase B desbloqueada.

### Aceite formal da Fase A (2026-07-20) — validação em dispositivo físico

O roteiro manual acima foi executado integralmente em um **iPhone 14 Pro** (Expo Go, conectado via Tailscale à stack local), com a conta descartável `fase-a-demo-1784563575@teste.local`, guiado passo a passo com capturas de tela e verificação do banco a cada etapa. Item descartável: `e570b888`.

- **Login e retomada:** autenticação por senha funcionou; a conversa da sessão web foi reidratada no dispositivo com os quatro cartões anteriores em estado/versão/foco corretos (`completed · v3` com ajustes, `approved · v1` em foco com botão Iniciar, `proposed · v1`, `rejected · v1`).
- **Criação resiliente:** o envio de "Planeje uma melhoria no app" falhou na resposta do Ollama (firewall da máquina bloqueia entrada no 11434/11435 — problema de ambiente, não de produto), mas a proposta e a mensagem de origem foram persistidas; ao reabrir o app, o cartão v1 apareceu em foco, comprovando o backend como fonte de verdade.
- **Correção no dispositivo:** cartão v1 → v2 com par atômico `proposal_changes_requested`+`proposal_revised` (seq 692/693).
- **Conflito:** correção concorrente do cliente web levou o servidor a v3; aprovar o cartão obsoleto em v2 no dispositivo foi recusado com "O item mudou desde a última leitura.", o cartão reconciliou para v3 exibindo o ajuste vindo da web e **a mensagem permaneceu visível**; nenhum evento de decisão foi gravado.
- **Ciclo completo:** aprovar v3 → iniciar → resultado com validações `passou`/`falhou`, referência e limitação → aceite. Log final do item: 10 eventos, um por intenção, decisões ancoradas exclusivamente na v3, estado `completed · v3`.
- **Persistência:** fechar e reabrir o app reconstruiu o cartão `completed · v3` idêntico.

**A Fase A está formalmente aceita.** Critério do plano cumprido: ciclo completo comprovado ao vivo em web e mobile, com eventos consistentes e foco estável entre plataformas. A Fase B (AUTO-01–06) está desbloqueada.

Limitações registradas (não bloqueantes, fora do critério de aceite):
- Respostas de chat no mobile dependem de liberar `ollama.exe` no firewall do Windows (regras de bloqueio de entrada existentes); as ações de orquestração não passam pelo Ollama e funcionaram integralmente.
- O cartão mobile exibe as evidências na revisão, mas não re-exibe o "Resultado aceito" no estado `completed` como o web — lacuna de paridade anotada para correção separada.
- UX mobile: tocar no campo de texto do cartão pode desviar o foco para o input do chat — anotado para correção separada.

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

### Aceite formal da Fase D (2026-07-20) — ratificação da revisão humana do INT-04

O resultado do INT-04 foi **tecnicamente aceito na revisão humana**. A ratificação apoia-se em quatro evidências independentes e append-only, sem reescrever nenhum registro anterior:

- **Robustez do runner** (repositório separado `anima-local-agent-poc`, commit `db704e4`): tolerância estritamente controlada a respostas estruturadas inválidas por regeneração limitada do modelo (no máximo duas tentativas compartilhadas), com revalidação idêntica, auditoria da resposta bruta + SHA-256, e sem qualquer reinterpretação semântica. Fail-closed, escopo, allowlists, isolamento e separação produção/aplicação permaneceram intactos.
- **Teste adicional de regressão** (mesmo repositório, commit `5bd917d`): fixa que `write_file` com `\n` literais no `content` é preservado byte a byte, jamais desescapado — travando o contrato contra reinterpretação semântica do conteúdo produzido pelo modelo.
- **Prova anterior pelo endpoint** (registrada em `af4d8b4`): item `507af5ef-a72f-4451-8ddb-0747f5e4e856`, tentativa `e65d1de1-ef9c-4e13-8dd5-55d784642e87`, handoff `20260720T205121334287Z-result.zip` (SHA-256 `fbe7d1acf5a6017ea0eef7344d95882380be59122c8699ebbd481e8997c00e44`), item em `review`.
- **Nova prova independente (2026-07-20)**: o runner foi comandado exatamente como o adaptador o invoca (`--produce-only --model qwen2.5-coder:7b`, gate `python -m unittest`) contra uma **cópia isolada** do piloto. O sucesso produziu o bundle `20260720T221717004114Z-result.zip`, SHA-256 `8706d0ef9504893e7c2b1179b3af08bf15f727e2098653f63cdfd09204faad7e`, contendo apenas `calculator.py` corrigido (`return a + b`, quebras de linha reais); `python -m unittest` verde (1 teste); escada de gates completa até `result_produced`. É uma amostra distinta da anterior (bundle diferente, ambos válidos).

**Limitações observadas do `qwen2.5-coder:7b` (não bloqueantes):** o modelo é estocástico e fraco — foram necessárias quatro tentativas para uma amostra verde. Modos de falha observados e preservados como evidência: `content` com `\n` literais duplo-escapados (gerou `SyntaxError`, corretamente barrado pelo gate de testes) e `iteration_limit`. Em todas as tentativas a robustez agiu corretamente: nenhuma resposta estruturada válida foi indevidamente recusada e as falhas foram do gate factual, nunca do gate estrutural.

**Confirmações de segurança:** nenhuma aplicação automática ocorreu em nenhuma tentativa (`apply.status=not_attempted`); nenhum merge, push ou deploy. O piloto original permaneceu **byte a byte intacto** (SHA-256 de `calculator.py` = `9445c47952abb8a7fc5d4a905d55b5be05771df1d69362ec597f9a50f7ede40d`, árvore limpa, HEAD `9101ec5`).

**A Fase D está formalmente aceita.** Critério do INT-04 cumprido: ciclo real comandado pelo Anima com resultado tipado e evidências persistidas, revisão humana concluída, integração sem corromper o item nem apagar histórico, e nenhuma aplicação sem revisão. A comprovação ao vivo (pré-requisito da Fase E) foi atendida pela prova registrada em `af4d8b4`.

## Fase E — Supervisor V0

**Objetivo:** o primeiro laço autônomo: fila persistente de itens elegíveis, escolha do próximo item, claim exclusivo, um trabalho por vez, pausa, retomada e recuperação de claims expirados.

**Pré-requisitos:** Fase D comprovada ao vivo.

**Entregáveis:** SUP-01 a SUP-04; AUTO-05 comprovado (retomada real após interrupção).

**Critérios de aceite:** com N itens elegíveis, o supervisor executa um por vez na ordem definida; interrupções (processo morto, Docker fora, limite de provedor) deixam checkpoint e a retomada continua do último estado válido; claim expirado é recuperado sem duplicar execução.

**Evidências obrigatórias:** cenário de interrupção forçada documentado com evidências; testes de recuperação de claim.

**Riscos:** duplo processamento por claim mal desenhado; supervisor virando scheduler genérico antes da hora.

**Fora do escopo:** paralelismo geral; múltiplos projetos simultâneos; priorização sofisticada.

### Ratificação do SUP-05 (2026-07-21) — exclusividade de alvo simétrica

A revisão humana **aprovou e ratificou** o SUP-05. Registro append-only, sem reescrever nenhuma evidência anterior. Foram aprovados nominalmente:

- a correção em `private.begin_work_attempt` como **fronteira única** compartilhada pelos inícios comandado e autônomo — e não uma verificação acrescentada ao caminho comandado, que duplicaria a regra;
- o uso de `pg_advisory_xact_lock` por `user_id + target_reference`;
- a manutenção da mesma ordem de locks de `acquire_work_claim` (item antes do alvo), que impede ciclo;
- o retorno de **replay antes** da verificação de exclusividade, preservando a idempotência do INT-04 e do AUTO-05;
- as exclusões do próprio item e do claim pertencente à própria tentativa;
- claims expirados **não bloquearem** e **não serem apropriados silenciosamente** pelo caminho comandado;
- o **endurecimento para falha fechada** (`execution target missing`, `22023`) quando o alvo não puder ser derivado — única alteração assumida sobre o contrato ratificado do INT-04;
- a garantia limitada por `user_id`, coerente com a V0 monousuário;
- o lock permanecer apenas durante a **transação curta de início**, e não pela duração da execução;
- as evidências pgTAP, a regressão completa e a corrida real entre duas sessões.

**Evidências ratificadas:**

- **Suíte específica** (`supabase/tests/commanded_target_exclusivity.test.sql`, commit `8310808`): 25 asserções cobrindo alvo livre, bloqueio por item `in_progress`, bloqueio por claim autônomo ativo, não-ocupação por estados encerrados ou em revisão, idempotência do replay sobre alvo ocupado por ele mesmo, e a inércia da recusa (claim alheio com `released_at`, `owner_instance_id` e `attempt_id` intactos; item comandado sem evento de execução).
- **Regressão completa:** 316 asserções pgTAP em 11 suítes, zero falhas; `typecheck` limpo nos cinco workspaces; 365 testes Jest em `packages/core` e 7 em `packages/supabase`; build do `apps/web` concluído.
- **Corrida real entre duas sessões**, com dois itens **diferentes** no **mesmo** alvo — a configuração em que locks de linha não serializam: a sessão concorrente permaneceu bloqueada por aproximadamente 3,97 segundos, até a conclusão da transação concorrente, e então foi recusada com `work target is held by an active claim` (`55000`).
- **Contrafactual medido:** durante a mesma janela, a consulta otimista que uma verificação na aplicação faria leu `alvo_ocupado = false` e retornou em menos de 1 milissegundo. É a prova de que a janela de corrida é observável e de que o lock é necessário, não decorativo.

**Correção documental desta ratificação:** o resumo em chat da prova concorrente trouxe a forma ambígua "3.968 ms"; a medição real é ~3,97 segundos (`Time: 3967.680 ms (00:03.968)`). A forma ambígua **nunca entrou no repositório** — a documentação e o commit `5aac4e4` já registravam "3,97 s" —, mas a redação foi uniformizada para a unidade inequívoca em todas as ocorrências.

**Confirmações de segurança:** nenhum resultado produzido foi integrado ou aplicado; nenhum merge, push, deploy ou `db reset`. O SUP-04 (reconciliação após interrupção) **não foi iniciado**. Com o SUP-05 encerrado, cai o bloqueio que impedia o Supervisor de iniciar execuções reais.

### SUP-04 pronto para revisão (2026-07-21) — reconciliação após interrupção

**Ainda não ratificado.** Registro append-only do estado alcançado, para o checkpoint humano.

**Diagnóstico confirmado:** nenhum caminho tirava um item de `in_progress` sem sinal do executor. A rota `execute-commanded` fica até 1800 s entre `start_commanded_work_attempt` e `record_commanded_work_terminal`; morto o processo nessa janela, o item ficava travado **para sempre**, ocupando o alvo pelo SUP-05 e saindo da fila do SUP-01. O AUTO-05 era estruturalmente inalcançável: `planWorkResumption` já recusava `in_progress` apontando para o SUP-04.

**Decisão central submetida à revisão:** a reconciliação não pergunta se a execução terminou — não pode saber. Pergunta se a tentativa **excedeu um limite declarado e persistido**: o lease de `work_claims` (AUTO-02) para a tentativa sob claim, e `execution_spec.limits.max_duration_minutes` da proposta **aprovada** (AUTO-01) para a comandada. Exige **todos** os limites aplicáveis excedidos. Sem limite algum declarado, sai como `requires_human` e não muda nada. `attempt_abandoned` afirma estritamente que a tentativa excedeu seu limite e deixou de ser a ocupante — mais fraco que concluir ou falhar.

**Decisões que pedem aprovação nominal:**

- a escolha de `approved` como destino do abandono, e a rejeição explícita de `failed` (afirma o não observado) e de `blocked` (beco sem saída: nenhuma RPC emite `work_blocked` e `begin_work_attempt` exige `approved`);
- o uso de `max_duration_minutes` da proposta aprovada como contrato persistido do caminho comandado, em vez de criar lease novo — que alteraria o INT-04;
- a exigência conjunta de todos os limites, em vez de qualquer um;
- materializar desfecho já persistido **sem** emitir evento novo;
- o recolhimento do lease vencido mesmo quando a tentativa continua protegida pelo limite de duração;
- o `pg_advisory_xact_lock` por usuário e a decisão de **não** adquirir lock de alvo, o que impede ciclo com `acquire_work_claim`;
- a guarda nova em `record_commanded_work_terminal` contra sinal tardio de tentativa abandonada, posicionada depois do replay idempotente;
- o status `abandoned` em `classifyPersistedAttempt` e a recusa `409` na rota.

**Evidências:**

- **Suíte específica** (`supabase/tests/supervisor_reconciliation.test.sql`): 65 asserções cobrindo reconciliação vazia inerte, posse válida intocada, lease vencido recolhido com razão declarada e linha preservada, órfã supervisionada e órfã comandada, o caso em que um único limite excedido **não** basta, ausência total de limite saindo como `requires_human`, desfecho já persistido materializado sem duplicar evento, posse liberada por fato com lease ainda ativo, idempotência em segunda e terceira passadas, recusa do sinal tardio, replay do INT-04 intacto e exclusividade do SUP-05 preservada.
- **Regressão completa:** 381 asserções pgTAP em 12 suítes, zero falhas; `typecheck` limpo nos cinco workspaces; 388 testes Jest em `packages/core` e 7 em `packages/supabase`; build do `apps/web` concluído.
- **Corrida real entre três sessões:** A reconciliou e segurou a transação; B, iniciada 1 s depois, **bloqueou 4,02 s** e retornou **zero linhas**; o estado final commitado tem exatamente um `attempt_abandoned` e um `work_claim_released`.
- **Contrafactual medido:** na mesma janela, a consulta otimista que uma verificação na aplicação faria leu `in_progress` com `lease_vencido = true` — "abandonaria = true" — em 0,5 ms. A janela de corrida é observável, não hipotética.

**Riscos e limitações declarados:**

- **Executor zumbi.** O banco não mata processos. Um executor que ignore seu próprio limite declarado pode continuar mexendo no alvo depois do abandono. Mitigações reais: o abandono só ocorre depois do limite que o próprio contrato declarou; a exclusividade do SUP-05 continua valendo no início da tentativa seguinte; e o sinal tardio é recusado. Fechar isso por completo exigiria cancelamento cooperativo do runner — fora do escopo do SUP-04.
- **Tentativa comandada sem `max_duration_minutes` permanece travada** em `in_progress` até decisão humana. É deliberado: sem limite declarado não há fato. Um caminho humano explícito de abandono seria o próximo passo natural, e não foi criado aqui para não ampliar escopo.
- **Bundle da tentativa abandonada não é aceito nem descartado.** Ele permanece no nó local, referenciado pelo evento de abandono; nenhuma via automática o promove a resultado.
- ~~**A demonstração ao vivo** de um cenário do Marco 003 com executor real, exigida pelo aceite do SUP-04, **ainda não foi feita**.~~ — **satisfeito em 2026-07-21**, ver "Demonstração ao vivo do SUP-04" abaixo.
- A garantia é limitada por `user_id`, coerente com a V0 monousuário.

### Demonstração ao vivo do SUP-04 (2026-07-21) — `application_shutdown` com executor real

Evidência exigida pelo aceite do SUP-04 ("cada cenário de interrupção do Marco 003 tem teste e pelo menos um foi demonstrado ao vivo"). Registro append-only; **o SUP-04 continua não ratificado**.

**Cenário:** `application_shutdown` — o processo da aplicação morre no meio da execução comandada, sem gravar sucesso nem falha.

**Fluxo real atravessado:** rota `POST /api/work-orchestration/execute-commanded` com sessão autenticada real (cookie `@supabase/ssr` de `sup04-live@test.invalid`), `LocalRunnerAdapter` (`local-runner-v1`) invocando o runner de `G:/anima-local-agent-poc` (`python -m local_agent --produce-only --model qwen2.5-coder:7b`) sobre **cópia isolada** do piloto, com Ollama local. RPCs reais: `create_work_proposal`, `resolve_approval`, `start_commanded_work_attempt`, `reconcile_supervised_work`, `record_commanded_work_terminal`. Nenhuma linha foi inserida diretamente no banco para simular o executor; o SQL serviu apenas para observar.

**Item da prova:** `41fe2069-eacf-404d-956e-dd9499e1dd64`, tentativa `41fe2069-0000-4000-8000-00000000b002`, `max_duration_minutes = 1` — o **menor limite que o contrato permite**, para tornar a prova prática sem alterar nenhum timestamp depois do início.

**Cronologia observada (UTC):**

| Horário | Fato persistido |
|---|---|
| 15:29:19 | `work_proposed`, `context_attached`, `work_approved` (seq 3478–3480) |
| 15:29:34.44 | `work_started` + `execution_started` (seq 3481–3482); item em `in_progress`; runner real vivo (PIDs 24344 e 11424) |
| ~15:29:54.8 | **servidor da aplicação derrubado**; a conexão HTTP da rota caiu sem resposta; nenhum terminal foi gravado |
| 15:30:01 | item confirmado órfão: `in_progress`, **0** eventos terminais, **0** claims (caminho comandado não cria lease) |
| **15:30:31** | **reconciliação executada 57 s depois da morte do executor: recusou concluir qualquer coisa** — `attempt_within_declared_bounds` / `none`, item permaneceu `in_progress` (faltavam 3 s do limite declarado) |
| 15:30:49 | limite excedido; reconciliação produziu `attempt_abandoned` (seq 3483, autor `system`), item → `approved` |

**A linha de 15:30:31 é a evidência central da prova.** O processo executor estava morto havia quase um minuto e a reconciliação ainda assim não afirmou nada, porque o limite declarado não tinha vencido. É a demonstração direta de que a decisão é governada pelo **limite persistido**, não pela ausência do executor.

**Payload do abandono:** `reason: duration_limit_exceeded`, `origin: commanded`, `claim_id: null`, `lease_expires_at: null`, `max_duration_minutes: 1`, `attempt_started_at: 15:29:34.440604Z`, `observed_at: 15:30:49.369586Z`.

**Idempotência:** segunda e terceira reconciliações, cada uma em transação própria, retornaram **0 linhas**. O item terminou com **6 eventos** no total e **exatamente um** `attempt_abandoned`. Nenhum claim foi criado ou liberado — não havia nenhum.

**Terminal tardio:** a chamada real de `record_commanded_work_terminal` com os identificadores da tentativa abandonada e um sinal `result` bem-formado foi **recusada** com `attempt was abandoned by reconciliation` (`55000`). Depois da recusa: item ainda `approved`, ainda 6 eventos, **zero** eventos terminais indevidos. **Limitação declarada:** não foi reproduzido um executor zumbi real — os processos do runner morreram junto com a aplicação nesta configuração (observação registrada abaixo) —, então a guarda foi exercitada pela fronteira real com os identificadores da tentativa abandonada, como o checkpoint autorizou.

**Nenhum efeito de resultado ou integração:** zero `result_accepted` e zero itens `completed` em todo o banco local; a workspace isolada terminou **byte a byte intacta** (`git status` vazio, `sum()` ainda retornando `a - b`) — nada foi aplicado, aceito, autorizado ou integrado.

**Diferenças entre o esperado e o observado:**

1. **Primeira tentativa falhou por setup, não por defeito do SUP-04.** O runner exige workspace em repositório git limpo; a cópia isolada não era repositório, o runner caiu com `EOFError` no prompt interativo de workspace suja e saiu com código 1. O adaptador converteu isso corretamente em `execution_failed`, e o item `1766ad82-29e4-4d0d-b1ee-d2859630acce` foi para `failed` — comportamento correto do INT-04, não órfão. A prova foi refeita com a workspace inicializada como repositório git (HEAD `6f32937`).
2. **Os processos do runner não sobreviveram à queda da aplicação** nesta configuração: derrubado o servidor, os PIDs filhos desapareceram junto. Isso **reduz** a exposição prática ao risco de executor zumbi, mas **não o elimina** — é uma observação sobre este ambiente (encerramento em árvore no Windows), não uma garantia do contrato. O risco permanece registrado.
3. Fora esses dois pontos, o comportamento observado coincidiu exatamente com o projetado.

**Configuração local da prova** (não versionada, `apps/web/.env.local` é ignorado pelo git): `ANIMA_LOCAL_RUNNER_ROOT`, `ANIMA_LOCAL_RUNNER_MODEL=qwen2.5-coder:7b` e `ANIMA_LOCAL_TARGETS_JSON` apontando `sup04-live` para a cópia isolada no diretório temporário da sessão. As linhas ficaram marcadas com comentário; removê-las desabilita o executor local.

**Validações após a prova:** 381 asserções pgTAP em 12 suítes (incluindo as 65 do SUP-04), 23 testes de domínio do espelho puro e `typecheck` limpo nos cinco workspaces. Nenhum arquivo de código foi alterado pela demonstração; a árvore permaneceu limpa em `f06f19d`.

**Estado dos dados locais:** as fixtures das provas de corrida (SUP-03, SUP-05 e SUP-04) e da demonstração ao vivo foram **preservadas** como evidência auditável, seguindo o padrão já adotado. Verificado ao final: **zero claims ativos** e **zero itens em `in_progress`** em todo o banco local — nenhum alvo permanece ocupado. Todas as contas de prova usam o domínio `@test.invalid`.

**Confirmações de segurança:** nenhuma execução foi disparada pela reconciliação; nenhum resultado foi aceito, autorizado, integrado ou aplicado; nenhum outro item da Fase E foi iniciado; `private.begin_work_attempt` não foi tocado e o SUP-05 permanece idêntico; nenhum merge, push, deploy ou `db reset`.

### Ratificação do SUP-04 (2026-07-21) — reconciliação após interrupção

A revisão humana final **aprovou, ratificou e encerrou** o SUP-04. Registro append-only: nenhuma evidência ou seção anterior foi reescrita, e as duas seções acima permanecem como o percurso que levou até aqui.

**A pendência que bloqueava a ratificação está satisfeita.** O aceite do SUP-04 exigia que ao menos um cenário de interrupção do Marco 003 fosse demonstrado ao vivo com executor real. A demonstração registrada no commit `40b8815` cumpriu o requisito e foi ratificada integralmente, com seus quinze pontos: início pela rota real `POST /api/work-orchestration/execute-commanded`, autenticação real por sessão, `LocalRunnerAdapter` e executor local reais, `work_started` e `execution_started` persistidos, interrupção da aplicação sem terminal, item órfão em `in_progress`, reconciliação recusada antes do vencimento do limite, abandono somente após `max_duration_minutes = 1` ser excedido, exatamente um `attempt_abandoned`, retorno a `approved`, reconciliações posteriores idempotentes e sem novos eventos, recusa de terminal tardio pela fronteira real, ausência de aceite, autorização, integração ou aplicação, ausência final de claims ativos e alvos ocupados, e workspace isolada sem alteração.

**O núcleo da ratificação:** a revisão destacou nominalmente a recusa da reconciliação aos **57 segundos** após a morte do executor como parte central do aceite. A ausência do processo não foi tratada como prova de nada; a decisão só ocorreu depois que o limite persistido venceu. É esse comportamento — e não o abandono em si — que o checkpoint ratificou.

**Decisões arquiteturais ratificadas nominalmente:**

- `attempt_abandoned` como afirmação **mais fraca** que sucesso ou falha;
- a transição `in_progress → approved`, única linha nova da matriz normativa;
- a **rejeição de `failed`** como conclusão inferida da ausência do executor;
- a **rejeição de `blocked`** enquanto não existir caminho executável de retomada a partir desse estado;
- `work_claims.expires_at` como limite persistido do caminho supervisionado;
- `execution_spec.limits.max_duration_minutes` como limite persistido do caminho comandado;
- a exigência de que **todos** os limites aplicáveis estejam excedidos;
- ausência de limite declarado resultando em `requires_human`, **sem mutação**;
- a guarda contra terminal tardio de tentativa abandonada;
- o **replay idempotente preservado antes** dessa guarda;
- a reconciliação restaurar consistência e elegibilidade **sem iniciar execução**;
- eventos append-only e operações idempotentes;
- o lock consultivo por usuário combinado com o lock por item;
- nenhuma interação da reconciliação com aceite, autorização ou integração.

**Observações aceitas pela revisão, sem alterar o resultado:**

- a primeira tentativa da prova falhou porque a workspace não era repositório git limpo — falha de preparação de ambiente, não defeito do SUP-04; o adaptador produziu corretamente `execution_failed`;
- os processos do runner não sobreviveram à queda da aplicação neste ambiente, o que **reduz a exposição observada** ao executor zumbi mas **não elimina o risco conceitualmente**; ele permanece no registro de riscos;
- a guarda contra terminal tardio foi comprovada pela chamada real da fronteira terminal com os identificadores da tentativa abandonada, e não por um zumbi genuíno;
- as fixtures permanecem no banco local como evidência auditável, e a configuração local do runner em `apps/web/.env.local` permanece como está.

**Riscos que sobrevivem à ratificação** (registrados, não resolvidos): o executor zumbi conceitual, que o banco não pode matar; a tentativa comandada **sem** `max_duration_minutes` declarado, que permanece em `in_progress` até decisão humana por não haver fato que sustente transição; e o bundle de uma tentativa abandonada, que não é aceito nem descartado automaticamente.

**O SUP-04 está ratificado e encerrado.** Suas decisões não devem ser reabertas sem evidência concreta de regressão ou incompatibilidade. Com isso, **SUP-01 a SUP-05 estão todos concluídos**; o que resta para fechar a Fase E é o laço que escolhe e executa (SUP-02 + AUTO-02 operando juntos) e a comprovação do AUTO-05 em retomada real — nenhum deles iniciado.

**Confirmações de segurança desta ratificação:** nenhum código funcional foi alterado; nenhum resultado foi aceito, autorizado, integrado ou aplicado; nenhum próximo item da Fase E foi iniciado; nenhuma fixture foi removida; o SUP-05 permanece intocado; nenhum merge, push, deploy ou `db reset`.

### Laço operacional do Supervisor V0 (2026-07-21) — pronto para revisão

**Não ratificado.** Registro append-only do estado alcançado, para o checkpoint humano. Nenhuma seção anterior foi reescrita.

**Diagnóstico confirmado no código.** As capacidades da Fase E existiam sem chamador: `autonomous_work_queue`, `next_autonomous_work`, `acquire_work_claim`, `start_claimed_work_attempt`, `release_work_claim` e `reconcile_supervised_work` não tinham **uma única chamada** em código de aplicação — apenas migrations, pgTAP e espelhos puros em `packages/core`. O único caminho operacional vivo era `POST /api/work-orchestration/execute-commanded` (INT-04), que usa o início comandado e não passa por posse. Não existia rota, worker, script ou processo capaz de executar o primeiro laço autônomo.

**Ponto de entrada criado:** `POST /api/work-orchestration/supervisor-turn` — **uma volta por invocação**, sem daemon, agendador ou polling. Rota autenticada porque todas as RPCs do ciclo resolvem `auth.uid()` e consultam a allowlist; um processo residente exigiria credencial de serviço nova.

**Sequência implementada:** `reconcile_supervised_work()` → `next_autonomous_work()` → leitura do item → parser do `execution_spec` → contextos → `acquire_work_claim` → `start_claimed_work_attempt` → `LocalRunnerAdapter` → `record_commanded_work_terminal` → `release_work_claim('attempt_finished')`.

**Fronteiras reutilizadas, nenhuma reimplementada.** Elegibilidade, ordem FIFO, ocupação de alvo e exclusividade continuam no banco. `evaluateAutonomousEligibility` é chamado só como parser do spec; divergência entre ele e o espelho SQL sai fail-closed **sem tomar posse**. O terminal reusa a RPC ratificada do INT-04, que valida por correlação de `execution_started` — emitido pelos dois caminhos — e não por origem; uma RPC nova duplicaria a guarda do SUP-04 contra sinal tardio.

**Serialização.** Exclusivamente do banco: lock do item, lock consultivo de alvo e índice único parcial. **Nenhum mutex em memória.** Não há consulta prévia de disponibilidade antes do claim — prever posse na aplicação é a janela que o SUP-05 mediu.

**Incerteza não vira conclusão.** Executor que lança, transcrição fora do contrato do INT-01 ou terminal recusado deixam a tentativa **aberta**, sem desfecho inventado e **sem liberar a posse** — é a órfã que o SUP-04 reconcilia por limite persistido.

**Testes (15 casos, `apps/web/lib/work-orchestration/supervisor.test.ts`):** o fake modela as invariantes ratificadas (posse única por item, alvo ocupado por claim ativo ou item em execução, replay idempotente, liberação idempotente por razão), de modo que os testes provam obediência às recusas e não coreografia de chamadas. Cobrem fila vazia sem efeito, reconciliação antes da seleção, cabeça FIFO, claim antes do início, uso de `start_claimed_work_attempt` e nunca do comandado, executor acionado exatamente uma vez, terminal registrado, posse liberada após o terminal, falha do executor virando terminal de falha, duas invocações concorrentes sem execução dupla, corrida perdida com recusa tipada, posse alheia intocada, exclusividade de alvo, item inelegível barrado antes da posse, replay sem duplicar efeito e ausência de aceite, autorização ou integração.

**Validações no HEAD da entrega:** 381 asserções pgTAP em 12 suítes, zero falhas (inalteradas — SUP-04 e SUP-05 intocados); Jest 388 em `packages/core`, 51 em `apps/web` (36 anteriores + 15 novos), 12 em mobile, 7 em `packages/supabase`; `typecheck` limpo nos quatro workspaces; build do `apps/web` concluído com a rota registrada. **Não existe script de lint neste repositório** (registrado no `AGENTS.md`), então essa validação não foi executada.

#### Prova ao vivo (2026-07-21) — dois itens, FIFO, executor real

Rota real com sessão autenticada (`suploop-fifo@test.invalid`), `LocalRunnerAdapter` invocando o runner de `G:/anima-local-agent-poc` sobre **cópias isoladas** do piloto, cada item em seu alvo. Nenhuma linha foi inserida diretamente no banco para simular o executor; o SQL serviu apenas para observar.

| Invocação | Selecionado | `approval_seq` | Desfecho | Terminal | Posse |
|---|---|---|---|---|---|
| 1ª | `7493f05f` (suploop-a) | 4316 | `execution_completed` | `result` | liberada |
| 2ª | `49104e5b` (suploop-b) | 4319 | `execution_completed` | `result` | liberada |
| 3ª | — | — | `no_eligible_work` | — | — |

Log dos dois itens, **sem sobreposição**: `work_claimed` 4320 → `work_started` 4321 (`supervised_execution`) → `execution_started` 4322 → `result_submitted` 4323 → `work_claim_released` 4324 (`attempt_finished`); só então `work_claimed` 4325 do segundo item, e a mesma escada até 4329. A posse do segundo item é adquirida **estritamente depois** da liberação do primeiro: um por vez, na ordem definida.

Handoffs persistidos: `local-runner:suploop-a:20260721T164718743084Z-result.zip:sha256:12445eee…` e `local-runner:suploop-b:20260721T164913520389Z-result.zip:sha256:f4e4eb2b…`. Ambos os itens terminaram em **`review`** — decisão humana pendente, nunca `completed`.

#### Prova concorrente real

Duas invocações disparadas **no mesmo tick**, cada uma uma requisição HTTP independente:

- **Itens diferentes disponíveis:** cada volta selecionou um item distinto (`approval_seq` 4276 e 4279), com claims e tentativas distintos. Progresso paralelo em alvos distintos, sem colisão.
- **Um único item disponível (duas repetições):** ambas as voltas selecionaram **o mesmo item** — a leitura da seleção não bloqueia, exatamente como o SUP-02 documenta — e a perdedora foi recusada **no claim**, com `claimId` e `attemptId` nulos, sem jamais acionar o executor. As duas recusas tipadas do contrato foram observadas ao vivo: `work item is held by an active claim` (**215 ms**, perdedora chegou depois da aquisição e antes do `in_progress`) e `work item is not eligible for an autonomous claim` (**321 ms** e **1,2 s**, perdedora chegou depois do início). Estado final: exatamente **um** claim, **um** `execution_started` e **um** terminal por item.

#### Cancelamento cooperativo observado sem ser planejado

Numa das voltas o cliente navegou durante a execução; o `AbortSignal` da requisição propagou ao adaptador, que emitiu `cancelled`, e o laço registrou `work_cancelled` e liberou a posse com `attempt_finished`. Comportamento correto do contrato, observado por acidente e registrado por honestidade.

#### Achado sobre o executor, fora do escopo desta entrega

As primeiras **onze** voltas terminaram em `execution_failed`. A investigação isolou a causa e ela **não está no laço**: `taskFor()` do `LocalRunnerAdapter` (INT-04) costura `Fora do escopo: <lista>` no prompt do modelo, e citar ali um **arquivo real** faz o modelo planejar editá-lo. Reproduzido fora da rota: com o texto exato que o adaptador monta, o runner falhou pela CLI (`model_execution_iteration_limit`, plano incluindo "Atualizar test_calculator.py"); com o objetivo isolado, a mesma CLI produziu `result_produced` de primeira. Removendo nomes de arquivo reais do escopo excluído do **item** — dado, não código — a primeira volta seguinte foi verde.

Isso é uma propriedade do adaptador ratificado no INT-04, não uma regressão; **não foi alterado aqui**, porque mexer nele muda contrato ratificado sem evidência de regressão. Fica registrado como candidato a item próprio.

Modelo do runner trocado de `qwen2.5-coder:7b` para `qwen2.5-coder:14b` em `apps/web/.env.local` após quatro falhas seguidas em `invalid_structured_response`. Mesmo runner, mesmos gates, apenas modelo mais estável. É configuração local não versionada; a linha do SUP-04 foi preservada e os alvos anteriores continuam declarados.

#### Confirmações de segurança

Zero `result_accepted` e zero itens `completed` em todo o banco local. Todos os **15 claims** criados pelo laço, em 8 contas de prova, foram liberados: **zero claims ativos** do laço e **zero itens `in_progress`**. Os três claims ativos remanescentes no banco são fixtures de 2026-07-20 das provas do SUP-03 e do AUTO-02, preservadas como evidência auditável e **não tocadas**. As quatro workspaces isoladas terminaram **byte a byte intactas** (`git status` vazio, `sum()` ainda retornando `a - b`): nada foi aplicado, aceito, autorizado ou integrado. Nenhum merge, push, deploy ou `db reset`. `private.begin_work_attempt` não foi tocado; SUP-04 e SUP-05 permanecem idênticos.

#### Limitações declaradas

- **A persistência de `WorkHandoffV1` não foi implementada.** O banco continua guardando apenas `handoff_reference`, uma string opaca. É tarefa separada e exige checkpoint humano por alterar contrato persistido e vocabulário de eventos.
- **O AUTO-05 não foi iniciado nem comprovado.** Sem checkpoint estruturado persistido não há de onde `planWorkResumption` eleger retomada; o abandono do SUP-04 não produz handoff algum.
- **Não há execução contínua.** Uma volta por invocação; quem chama decide a periodicidade.
- **A `maxDuration` da rota é 1800 s** e uma volta longa ocupa a conexão HTTP inteira. Cliente que desiste no meio produz cancelamento cooperativo, como observado.
- O laço herda a estabilidade do executor local: enquanto o modelo falhar seu próprio gate factual, a volta termina corretamente em `execution_failed`, que é comportamento, não defeito.

**A Fase E não está encerrada.** O critério "com N itens elegíveis, o supervisor executa um por vez na ordem definida" está comprovado; a retomada real do AUTO-05 continua pendente.

### Ratificação do laço operacional (2026-07-26) — mecanismo de execução da V0

A revisão humana **aprovou, ratificou e encerrou** o laço operacional. Registro append-only: nenhuma seção anterior foi reescrita; a seção acima permanece como o percurso que levou até aqui.

**Provas frescas na ratificação (2026-07-26, HEAD `a36d7cf`):** o espelho puro do SUP-04 (`packages/core`, `work-reconciliation`) passou 23/23; o laço (`apps/web/lib/work-orchestration/supervisor.test.ts`) passou 15/15; `typecheck` limpo nos cinco workspaces (mobile, web, core, supabase, types). A suíte pgTAP (381 asserções, 12 suítes) **não foi reexecutada**: o laço não tocou migration alguma e SUP-04/SUP-05 permanecem byte a byte, de modo que reexecutar suíte ratificada não altera o veredito.

**Decisões arquiteturais ratificadas nominalmente:**

- **uma volta por invocação** via rota autenticada, sem daemon, agendador ou polling — a periodicidade pertence a quem chama, e `requiresAnotherTurn` diz se vale insistir;
- **reconciliar (SUP-04) antes de selecionar**, para nunca decidir sobre um estado que a interrupção deixou mentindo;
- **serialização inteiramente do banco** (lock do item, lock consultivo de alvo, índice único parcial), **sem mutex em memória** e **sem consulta prévia de disponibilidade** antes do claim — prever posse na aplicação é a janela que o SUP-05 mediu;
- **`evaluateAutonomousEligibility` apenas como parser** do `execution_spec`, com divergência em relação ao espelho SQL saindo **fail-closed sem tomar posse**;
- **terminal reusando `record_commanded_work_terminal`**, validado por correlação de `execution_started` (emitido pelos dois caminhos) e não por origem, evitando duplicar a guarda do SUP-04 contra sinal tardio;
- **incerteza não vira conclusão** — executor que lança, transcrição fora do contrato do INT-01 ou terminal recusado deixam a tentativa **aberta e a posse retida** para o SUP-04, sem inventar desfecho;
- **desfecho máximo de uma volta em `review`** — nenhum caminho aceita, autoriza, integra ou aplica resultado (fronteira do INT-03 intacta).

**Riscos e limitações que sobrevivem à ratificação** (registrados, não resolvidos): `WorkHandoffV1` permanece **sem persistência** e o **AUTO-05 em retomada real continua não iniciado**, bloqueado por isso; não há execução contínua, e a `maxDuration = 1800 s` ocupa a conexão HTTP inteira, com cancelamento cooperativo quando o cliente desiste no meio; o achado do `taskFor()` do `LocalRunnerAdapter` — que costura arquivos reais do escopo excluído no prompt e induz o modelo a editá-los — é propriedade do INT-04, **candidato a item próprio**, e não foi alterado aqui; o modelo local em `apps/web/.env.local` foi trocado para `qwen2.5-coder:14b`, configuração local não versionada.

**Confirmações de segurança desta ratificação:** nenhum código funcional foi alterado; nenhuma migration foi tocada; `private.begin_work_attempt`, SUP-04 e SUP-05 permanecem idênticos; nenhum resultado foi aceito, autorizado, integrado ou aplicado; nenhum merge, push, deploy ou `db reset`.

**Consequência para a Fase E:** o laço está ratificado como o **mecanismo de execução da V0**. Ele é seguro contra órfãs por composição com o SUP-04, mas **não retoma** trabalho pausado enquanto o handoff estruturado não for persistido. A Fase E **permanece aberta** por uma única pendência nomeada — a retomada real do AUTO-05, bloqueada pela persistência de `WorkHandoffV1` (tarefa separada, com checkpoint humano).

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
