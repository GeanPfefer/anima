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
| E | **Em andamento** | AUTO-02, AUTO-04, AUTO-05, SUP-01, SUP-02 e SUP-03 concluídos; restam SUP-04 (reconciliação) e SUP-05 (simetria de alvo, bloqueante antes de execuções reais) |
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
