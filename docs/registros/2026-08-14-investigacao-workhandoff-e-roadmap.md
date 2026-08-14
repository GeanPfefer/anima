# 2026-08-14 — Investigação do WorkHandoffV1 + reclassificação do roadmap

**Tipo:** desenvolvimento (investigação sem alteração de código de produção).
**Objetivo:** num novo ciclo de limite, reconstruir o roadmap a partir das fontes
canônicas, classificar os próximos recortes (A ratificado-implementável / B efeito
externo / C nova decisão) e investigar a fundo o risco sobrevivente
**`WorkHandoffV1` sem persistência**, determinando se há recorte incremental
derivado de contratos já ratificados ou se exige nova decisão arquitetural.

## Estado Git (reconciliado, não de memória)

- **Branch:** `claude/integration-application-layer`
- **HEAD inicial e final:** `e1870df` — **inalterado** por esta investigação até o
  commit deste registro.
- **origin/main:** `973ef465acaa3955f8e176c72903975cf3912ac6` — **intacta**.
- **Ahead:** 251 à frente de origin/main; **sem upstream, NUNCA pushada**.
- **Working tree:** limpa (só `.worktrees/` não rastreado, preservado).

## Reconstrução curta do roadmap (fontes: AGENTS.md, checkpoint 2026-08-14, PRD §1f.1, Plano 002 + backlog)

O backlog do [Plano 002 — Modo Autônomo V0](../planos/002-modo-autonomo-v0.md)
está, nas fases **A–F, integralmente implementado e ratificado**: ORQ-01…04,
AUTO-01…06, INT-01…04, SUP-01…05 + laço operacional, INTEL-01…04. A Fase G (UX)
está majoritariamente ratificada (UX-02, UX-04); **prontos-para-revisão não
ratificados**: UX-00, UX-03, e a **paridade mobile do UX-01**. A camada de
aplicação/integração/publicação (ADR-002) chegou à **Fase 3 (review request)
congelada em `READY_FOR_HUMAN_EXTERNAL_PROOF`**.

Classificação dos eixos remanescentes:

- **B — bloqueado por efeito externo (não executar):** primeira criação real de PR
  (Fase 3); `merged`/`integrated`/`apply`; deploy; qualquer push/PR/merge no
  GitHub real.
- **C — bloqueado por nova decisão (arquitetura/produto/política):** persistência
  do `WorkHandoffV1` terminal (ver abaixo); **Reviewer/Verifier automatizado
  independente**; superfície de UI de auto-desenvolvimento (produto); alterar a
  própria política de segurança (maturidade de grau máximo, Marco 006).
- **A — ratificado e implementável localmente que aumente autonomia real:**
  **nenhum recorte de código limpo encontrado** — ver "Determinação" abaixo. As
  ratificações humanas pendentes (UX-00/UX-03/UX-01-mobile) são checkpoint humano,
  não trabalho de código.

## Investigação: o que é, exatamente, o "`WorkHandoffV1` sem persistência"

### 1. O que se perde hoje

`WorkHandoffV1` (AUTO-04, [`work-handoff.ts`](../../packages/core/src/work-orchestration/work-handoff.ts))
é o handoff estruturado **terminal**. Tem builder (`buildWorkHandoff`), reconcile
idempotente e um **payload proposto** (`buildWorkHandoffPayload` →
`WorkHandoffPayloadV1`) explicitamente marcado no código como *"payload proposto
para o log append-only"*.

Fato verificado por busca em todo o repositório: **`buildWorkHandoffPayload` e
`WorkHandoffPayloadV1` só têm referências em testes.** Nenhum RPC, rota ou
serviço persiste um `WorkHandoffV1` terminal. Não existe evento `handoff_recorded`
nem `record_work_handoff`. O que o término persiste é **apenas** a
`handoffReference` opaca + os campos próprios do sinal
(`record_commanded_work_terminal`, [migration 20260726000003](../../supabase/migrations/20260726000003_terminal_sequence_after_checkpoints.sql)):
`result → review` guarda `summary/result_references/validations/limitations/handoff_reference`;
`error → failed` guarda `code/message/retryable/handoff_reference`;
`cancelled → cancelled` guarda `handoff_reference`.

### 2. Em quais cenários isso limita retomada/autonomia — resposta: em nenhum vivo

A retomada real (`planWorkResumption`, [`work-resumption.ts`](../../packages/core/src/work-orchestration/work-resumption.ts))
tem três fontes discriminadas (`WorkResumptionSourceV1`). Rastreando os
**consumidores de aplicação** (`supervisor.ts`), só **duas** são construídas ao
vivo, e **ambas derivam de fatos persistidos**:

- `human_decision_checkpoint` — `human_decision_resumption_source` reconstrói um
  `WorkHandoffV1` *pausado* que `record_work_decision_required`
  ([migration 20260729000003](../../supabase/migrations/20260729000003_decision_resumption.sql))
  **sintetiza a partir do último `checkpoint_recorded`** e persiste dentro do
  evento `input_requested`.
- `abandoned_checkpoint` — `abandoned_work_resumption_source` projeta o maior
  `checkpoint_recorded` (mid-flight `WorkCheckpointV1`) + `attempt_abandoned`
  (SUP-04).

O ramo **`terminal_handoff`** do `planWorkResumption` — o caminho puro do AUTO-05
associado aos cenários do Marco 003 (`machine_restart`, `provider_limit_reached`
etc.) — **só é exercitado em teste de domínio; nenhum código de aplicação o
constrói**, porque não há `WorkHandoffV1` terminal persistido de onde
reconstruí-lo. Na prática, toda interrupção real (shutdown/restart/limite) é
reconciliada pelo SUP-04 (`attempt_abandoned`) e retomada por **checkpoint**, não
por handoff terminal. Além disso, os desfechos terminais **não são retomáveis**
por construção (`resumableStates = {'approved'}`): `result → review` (decisão
humana), `error → failed` (terminal), `cancelled → cancelled` (terminal).

### 3. Mecanismos duráveis que já existem (e cobrem a retomada)

- `checkpoint_recorded` + `record_work_checkpoint`/`latest_work_checkpoint`
  (Etapa 2A, **ratificado**) — o `WorkCheckpointV1` mid-flight é a **substância
  durável** da retomada.
- `input_requested` com `WorkHandoffV1` pausado sintetizado do checkpoint
  (UX-02, **ratificado**).
- `attempt_abandoned` + `abandoned_work_resumption_source` (SUP-04, **ratificado**).
- `WorktreeHandoffV1` (INT-05) — a **evidência git estruturada** do resultado é
  embutida no sinal `result` e **persistida** em `executor_signal`, relida por
  `projectWorktreeHandoff`. É o handoff durável que a integração (ADR-002)
  realmente consome.

Ou seja: o substrato de **retomada** (checkpoints) e o substrato de **integração**
(`WorktreeHandoffV1`) são ambos duráveis. O `WorkHandoffV1` terminal é o único
conceito com payload proposto **sem produtor vivo e sem consumidor**.

### 4. Existe recorte incremental já implícito/ratificado nos contratos?

**Não, sem antes de uma nova decisão.** Persistir um `WorkHandoffV1` terminal
exigiria (a) um produtor — ou o executor emite estrutura no terminal (muda o
contrato INT-01, hoje o `result`/`error`/`cancelled` só carregam
`handoffReference` opaco), ou o servidor sintetiza do último checkpoint (padrão do
UX-02) — **e (b) um consumidor**, que hoje não existe (o ramo `terminal_handoff`
não é alcançado no laço). Construir sem consumidor é exatamente o
*"contrato especulativo além do que a Fase consome"* que o INT-01 adverte.

### 5. Determinação

**`WorkHandoffV1` terminal persistido é arquitetura à frente da necessidade —
Categoria C (nova decisão).** O "risco sobrevivente" é uma observação de
**completude** do payload proposto do AUTO-04, **não uma lacuna funcional** que
limite a autonomia hoje: a retomada é integralmente coberta por checkpoints
persistidos. **NÃO implementado** nesta sessão. Proposta precisa abaixo.

## Achado irmão (mesma família): evidência durável de tentativa que FALHA

O contrato ratificado `WorktreeHandoffV1` (INT-05,
[`worktree-handoff.ts`](../../packages/core/src/work-orchestration/worktree-handoff.ts))
**já suporta `status: 'failed'` + `safeError` + gates reprovados** (*"falha
honesta, nunca silenciosa"*). Porém o produtor vivo
([`worktree-executor.ts`](../../apps/web/lib/work-orchestration/worktree-executor.ts))
**só constrói o handoff no sucesso**; na falha de gate ele retorna um `error` com
uma frase, **descartando** a evidência estruturada já coletada (`changed`,
`diffNumstat`, `gateOutcomes`, `commitSha` da branch descartável). O revisor de um
item `failed` recebe só a string. Anexar isso exigiria estender o sinal `error` do
INT-01 (campo `worktreeHandoff?` aditivo), o validador de transcrição e
`projectWorktreeHandoff` (hoje só lê `result_submitted`) — **e definir um
consumidor**, que hoje não existe (o único consumidor de `projectWorktreeHandoff`
é o pipeline de integração, que só consome sucesso). **Categoria C** (evolução de
contrato ratificado + decisão de consumo). NÃO implementado.

## Propostas precisas — NÃO RATIFICADAS (menu de decisão humana, ranqueado por valor)

1. **Verifier V0 — validação independente pura (aditiva, não substitui o gate
   humano).** Função pura em `packages/core` que, a partir de fatos persistidos
   (`WorktreeHandoffV1` + `validationCriteria` + `includedScope` + correlação),
   emite um **veredito consultivo** ("todo critério declarado tem gate
   correspondente; todos os gates passaram; alterações ⊆ escopo aprovado;
   correlação íntegra"). É o eixo `revisar` do mapa de maturidade (PRD §1f.1),
   classificado como **maturidade promovível por evidência**, e materializa a
   linha de governança `Reviewer/Verifier`. Ratificação necessária: (i) o
   escopo exato do que se verifica; (ii) que o veredito é **advisory** — alimenta,
   nunca substitui, a decisão humana; (iii) o consumidor (projetar no cartão de
   revisão existente é UX = decisão de produto). Menor recorte: a função pura +
   testes, **sem** UI, atrás de ratificação do consumo.
2. **Evidência durável de falha** (achado irmão acima) — promove `revisar`/`reparar`
   por auditabilidade. Exige extensão aditiva do sinal `error` (INT-01) + consumidor.
3. **Persistência do `WorkHandoffV1` terminal** — menor prioridade. **Recomendação:
   não construir** até existir um cenário real de retomada por handoff terminal
   (hoje inexistente); a retomada por checkpoint já cobre os cenários do Marco 003.

## Provas/gates executados (baseline, código não alterado)

- **typecheck:** 5 workspaces limpos.
- **core (Jest):** **31 suítes / 694 testes PASS** (o checkpoint anterior citava
  689 por não ter re-rodado a suíte completa após `fc17cae`; 694 é o número atual,
  sem regressão).

Nenhum gate vermelho ⇒ nenhum bug oculto ⇒ nenhum recorte Categoria-A de correção.

## Invariantes de segurança / efeitos externos

- **Zero** push, PR, merge, deploy, GitHub mutativo, token real, alteração de
  origin/main, force, reset destrutivo, clean, remoção de worktrees.
- Preservados: `.claude/settings.local.json`, `apps/web/.env.local`, `.worktrees/`.
- Nenhum contrato ratificado alterado; nenhum gate afrouxado.

## Fronteiras humanas restantes (`BLOCKED_BY_HUMAN_DECISION`)

- Ratificar Fase 3 e atravessar (ou não) a **primeira criação real de PR** (B).
- Escolher qual fronteira C liberar — o menu ranqueado acima é a entrada da decisão.
- Ratificações pendentes: UX-00, UX-03, paridade mobile UX-01.

## Próximo ponto exato de retomada

Reconstruir de `e1870df` (ou do HEAD após o commit deste registro). O backlog
local ratificado (Plano 002 A–F) está fechado; o trabalho seguro restante é
**trabalho de evidência** sobre estágios de maturidade (PRD §1f.1) **atrás de
ratificação humana** do consumo. Não reabrir: `taskFor()` (corrigido),
`ollama-coder excludedScope` (neutro), Fase 3 (congelada), retomada por checkpoint
(ratificada). A próxima ação de maior valor é o humano escolher no menu acima —
com destaque para o **Verifier V0 pura** como o recorte mais próximo de
Categoria-A (pequeno, puro, aditivo, sobre a linha de governança ratificada),
pendente apenas da ratificação do escopo/consumo.
