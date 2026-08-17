# 2026-08-17 — Resource Governor V0: consumidor real, machine-wide e superfície na UI

**Tipo:** implementação + provas determinísticas (sem LLM, sem Supabase vivo).

**Objetivo:** continuar o **Resource Governor V0** (entregue no mesmo dia em
[2026-08-17-resource-governor-v0](2026-08-17-resource-governor-v0.md)) tornando o advisory
**útil para um consumidor real**, sem conceder autoridade nova. O seam de leitura estava pronto
**sem consumidor**; esta sessão fecha o eixo
`estado persistido → classificação → snapshot atual → ResourceAdvisory → superfície read-only`
no fluxo do Supervisor e na UI. Advisory continua advisory: informa, **nunca** decide/bloqueia/atua.

**Branch:** `claude/integration-application-layer`.
**HEAD inicial:** `36ab186`. **HEAD final:** `be9f080` (5 commits abaixo).
**origin/main:** `973ef465acaa3955f8e176c72903975cf3912ac6` — **intacta, SEM push.** ~295 ahead.
**Árvore:** limpa exceto `.worktrees/` (preservada).

Detalhe arquitetural vivo em `docs/arquitetura/orquestracao-de-trabalho.md`
§"Resource Governor V0 implementado" → "Consumidor real", "Superfície na UI", "Persistência própria:
avaliada e dispensada".

## O que foi implementado (5 commits)

- **`9787bb1`** — core puro `adviseWorkloadProfiles` (`resource-advisory.ts`): parecer por **cada**
  perfil histórico contra o mesmo snapshot/reserva (um turno exercita vários gates → múltiplos
  perfis), sem colapsar workloads. Preserva ordem; reaproveita `adviseWorkloadExecution`.
- **`f234f24`** — seam host `composeSupervisorResourceAdvisory` (`resource-governor.ts`) +
  fiação em `POST /supervisor-turn`: o report (`ResourceGovernorAdvisoryReport`) é anexado **ao lado**
  de `value`, nunca dentro do resultado do Supervisor. Bloco **independente e totalmente fail-open**
  (fetch + composição sob `try/catch`), **pós-terminal**, **fora do caminho quente** (`runSupervisorTurn`
  intocado; bloco do Verifier byte-idêntico ao original). `null` quando não há observação (histórico
  insuficiente = nada a aconselhar).
- **`5526a04`** — leitura **machine-wide**: primitiva mínima `listEventsByType(eventType)` no
  repositório (core interface + service + impl Supabase). Eventos de um tipo em **todos** os itens do
  usuário, **sem filtro de `work_item_id`** — a **RLS já ratificada** de `work_events` (EXISTS item do
  dono) é a única fronteira, o mesmo padrão de `findResumableWorkItems`; índice `work_events_type_time_idx`
  cobre `event_type`. A rota passa a alimentar o advisory com a evidência de gate machine-wide (senão um
  item **novo** cairia sempre em `insufficient_evidence`). A agregação por `(kind, command, repo)` já era
  machine-wide no core.
- **`257d5c0`** — UI web: `WorkProposalCard` renderiza a projeção per-item `resourceCost` (já serializada
  desde `5ebaae3`, mas não exibida) — por comando de gate: contagem, mediana, classe, falhas. Read-only.
- **`be9f080`** — paridade mobile (`MobileWorkCard` + `presentMobileWorkResourceCost`) + descritores
  compartilhados no core (`describeCostClass`, `formatObservedDurationMs`, a régua de
  `describeValidationOutcome`); o web deixa de duplicar os rótulos.

## Decisões de recorte (fronteiras honestas)

- **Persistência própria avaliada e DISPENSADA.** O mandato pedia só criar evento/RPC novo se, após um
  consumidor real, ficasse demonstrado que derivar de `host_observed_gate_evidence_recorded` é
  insuficiente. Ficou demonstrado o contrário: a **data já é suficiente** para custo cross-item; a
  limitação era o **escopo per-item da leitura**, resolvido por `listEventsByType` (leitura machine-wide
  dos eventos que já existem). **Nenhuma migration/RPC nova.**
- **Advisory anexado como leitura pós-turno, não endpoint dedicado.** O consumidor natural é a resposta
  do `/supervisor-turn`. Um `GET` dedicado (advisory queryable sem rodar turno) não tem consumidor ainda
  → evitado como infra especulativa. Fica como fork elegível.
- **Custo per-item na UI, advisory machine-wide fora da UI per-item.** A UI mostra `resourceCost`
  (evidência + classificação **per-item**, durável, serializada). O **advisory** é machine-wide e
  depende do snapshot vivo — não tem lar per-item honesto; segue no seam host-side / resposta do turno.
- **Bloco do Verifier intocado.** A opção de compartilhar o fetch de eventos entre Verifier e advisory
  foi descartada para não tornar o fetch do Verifier fail-open (mudança de comportamento) e manter o
  blast radius mínimo: o advisory é bloco separado, com fetch próprio sob `try/catch`. Custo: uma leitura
  extra de eventos no caminho de resultado — aceitável por ser pós-terminal e fail-open.

## Provas/gates (determinísticas, sem LLM/Supabase)

- **core:** 860/860 (+8 na sessão: `adviseWorkloadProfiles` 5, `listEventsByType` no service 1,
  descritores 2). `packages/core` Jest.
- **supabase:** `repository.test.ts` 8/8 (+1: prova o shape da query de `listEventsByType` e a
  **ausência de filtro de item** — RLS é a fronteira). `integration.test.ts` **skipped** (sem Docker).
- **web:** seam `resource-governor.test.ts` 13/13 (+8, inclui "3 itens distintos → 1 perfil");
  rota `supervisor-turn/route.test.ts` 10/10 (+4: anexa ao lado de `value`; fail-open engole exceção;
  omite quando `null`; não lê no caminho sem terminal); `WorkProposalCard.test.tsx` 41/41 (+3).
- **mobile:** 44/44 (+4 em `mobile-work-result.test.ts`).
- **typecheck:** 5 workspaces limpos (a mudança de interface do repositório toca core, supabase, web,
  mobile; mocks parciais de mobile/execute-commanded não quebraram).

## Invariantes de segurança preservadas

- origin/main intacta; **sem push, PR, merge, deploy, force, efeito externo, credencial real**.
- `.worktrees/`, `.claude/settings.local.json`, `apps/web/.env.local` preservados; nenhum reset/clean
  destrutivo; nenhuma evidência apagada.
- **Nenhuma autoridade nova.** O advisory não decide, não bloqueia, não muda elegibilidade, não mata
  processo, não para Docker/Supabase, não descarrega modelo, não agenda, sem efeito externo.
  **EVIDÊNCIA ≠ CLASSIFICAÇÃO ≠ ADVISORY ≠ DECISÃO** preservado no consumidor e na UI.
- Leitura machine-wide **read-only**, isolada pela política RLS **já ratificada** — não introduz
  fronteira de isolamento nova; reusa a de `findResumableWorkItems`.

## Fronteiras humanas / prova viva pendente

- **Cross-user do read machine-wide:** o `integration.test.ts` (dois usuários contra Supabase vivo) fica
  **skipped** sem Docker/Supabase. O isolamento é garantido pela **RLS já ratificada** de `work_events`,
  não por este código; a prova viva com dois usuários é fronteira humana/ambiental.
- **UI ao vivo:** renderização do `resourceCost` no navegador e no dispositivo mobile exige item com
  evidência de gate + Supabase/auth; provado por teste de componente (web) e de projeção (mobile), não
  ao vivo.

## Próximo ponto de retomada

Recortes elegíveis (locais, reversíveis, sem efeito externo, prováveis):
1. **Endpoint de leitura dedicado** (`GET`) do advisory machine-wide — só se surgir um consumidor real
   (ex.: um painel/status que consulte "vale rodar agora?" sem disparar um turno).
2. **Observar custo além do gate** — hoje só `host_observed_gate_evidence_recorded` alimenta o custo; a
   duração do coder/suite/build/container ainda não é observada. Exige novo ponto de observação host-side
   (cuidado com o caminho quente do executor); avaliar recorte próprio.
3. **Advisory relativo ao item** — aconselhar sobre os gates **declarados no contrato** do item (não só
   os já observados), usando o histórico machine-wide para classificar; daria ao advisory um lar per-item.
4. **Classificação ciente de desfecho/recência** — separar durações de gate `failed` das `succeeded`;
   pesar observações recentes. Refinamento sem consumidor claro ainda.

Qualquer automação de **controle** (matar/parar/descarregar/agendar/prioridade) permanece **FORA do V0**
e exige recorte próprio + autorização humana. A progressão continua
`OBSERVAR → evidência → histórico → classificar → advisory → PROVAR advisory → decisão assistida →
controle limitado → controle autônomo maduro` — sem pular níveis.
