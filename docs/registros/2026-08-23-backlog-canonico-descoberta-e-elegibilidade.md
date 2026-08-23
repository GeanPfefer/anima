# Backlog canônico/documental — descoberta read-only + elegibilidade determinística

Data: 2026-08-23
Tipo: desenvolvimento (core puro) + descoberta viva sobre o documento real

`CANONICAL_BACKLOG_DISCOVERY = PASS` · `NEXT_CANONICAL_CANDIDATE = PASS`

## Objetivo

Reduzir a dependência humana de TRADUZIR "essa linha do roadmap" → `work_item`. Primeiro
passo da ponte: o Anima LER o próprio backlog CANÔNICO/documental de forma estruturada e
decidir, conservadoramente, o próximo candidato materializável — SEM criar trabalho ainda.

- Branch: `dev`. HEAD inicial: `bfe6876`. Commits: `8925b2f` (descoberta) + `213ccfb`
  (elegibilidade + endurecimento). `origin/main`: `99bec54`, intacta.

## Inventário (as 10 perguntas do handoff)

1. **Fonte canônica única?** Sim — `docs/planos/002-modo-autonomo-v0-backlog.md` é a lista
   de itens do Modo Autônomo V0 (apontada por AGENTS.md + Plano 002).
2. **IDs estáveis?** Sim — `ORQ-01`…`ORQ-04`, `AUTO-01`…`06`, `INT-01`…`04`, `SUP-01`…`05`,
   `INTEL-01`…`04`, `UX-00`…`04` (28 itens; padrão `[A-Z]{2,6}-\d{2}`).
3. **Estados explícitos?** Parcial — em prosa (`**Estado (data):** …` / `**Atualização …:**`),
   keyword-classificável, mas nem todo item auto-declara (muitos só têm estado no Plano).
4. **Dependências?** Sim — `**Dependências:** <IDs>` por item.
5. **Acceptance criteria?** Parcial — `**Aceite:**` em vários itens + critérios de fase no Plano.
6. **Prioridade?** Sim — baldes Agora/Depois/Futuro + sequência recomendada.
7. **Bloqueios?** Deriváveis de dependências + estados.
8. **Ligação docs↔work_items?** Praticamente NÃO — só 1 work_item casa o padrão de ID (coincidência).
9. **Source-of-truth ou doc?** É a fonte canônica dos itens V0, mas quase tudo está `done`
   (as fases V0 foram concluídas); a frente ATIVA (resident host etc.) vive no Plano/registros,
   não como IDs neste doc.
10. **Parseável deterministicamente?** Sim (IDs/deps/prioridade); estado exige keyword. **Sem LLM.**

## Mudança (core puro `packages/core/.../canonical-backlog.ts`)

- **`parseCanonicalBacklog`** (`8925b2f`): projeta cada `### <ID> — <Título>` em
  `CanonicalBacklogCandidate` {`sourceId`, `title`, `status`, `statusEvidence`,
  `dependencies` (só IDs, self excluído), `sourceRef` {document, heading, line}}. Estado/deps
  não vazam entre seções; ID duplicado → primeira ocorrência. `unknown` é HONESTO.
- **`classifyCanonicalBacklogStatus`**: done | awaiting_review | not_started | unknown. Após o
  achado ao vivo (abaixo), classifica pelo marcador que aparece MAIS CEDO no texto (o estado do
  próprio item vem antes de citações a outros), com negação de "não ratificad"; "implementado"
  sozinho NÃO é done.
- **`planCanonicalBacklogMaterialization`** (`213ccfb`): decide o PRÓXIMO materializável —
  PURO, conservador. done/awaiting → settled (não reaparecem); já-ligado → não duplica;
  `unknown` → não materializa (poderia estar concluído); `not_started` só com TODAS as deps
  `done`; dependência não satisfeita → blocked, sem congelar um pronto posterior; ordem canônica
  (FIFO). Razão tipada + `pending`.

## Achado ao vivo (e correção)

A primeira descoberta viva classificou **AUTO-05 como `not_started`** e a elegibilidade o
elegeu — mas AUTO-05 está **`done`** (ratificado 2026-07-28). Causa: a linha de estado é prosa
longa que cita OUTRO item — "…o usuário **ratificou**… Próxima fase elegível: Fase F, **não
iniciada**." A classificação por PRIORIDADE de categoria (not_started antes de done) pegou o
"não iniciada" da Fase F. **Fix:** classificar pelo marcador MAIS CEDO (o "ratificou" do próprio
item vem antes). Regressão coberta em teste. É exatamente o risco que o handoff alertou —
materializar trabalho já concluído — evitado.

## Provas

- `canonical-backlog.test` **23/23** (classificação + parsing + elegibilidade: done não
  reaparece, blocked não congela, dependência não resolvida não materializa, já-ligado não
  duplica, FIFO, unknown→não materializa, regressão AUTO-05). typecheck **5 workspaces** PASS.
- **DESCOBERTA VIVA no doc REAL** (após o fix): 28 candidatos, **15 done / 13 unknown**,
  dependências e localização corretas. **ELEGIBILIDADE VIVA:** decisão `none /
  status_unresolved` (`settled=15, statusUnknown=13, ready=0`) — o Anima corretamente
  **NÃO** materializa nada: o backlog V0 está essencialmente completo e os 13 `unknown` não
  podem ser confirmados como não-concluídos sem enriquecimento de estado. Comportamento SEGURO
  e HONESTO.

## Segurança / invariantes

Tudo é PROJEÇÃO DE LEITURA pura: nenhuma escrita, nenhum work_item criado, nenhuma tabela nova,
nenhum LLM. A autoridade continua sendo o domínio (work_items). Conservador por construção:
na dúvida (`unknown`), NÃO materializa.

## Fronteira (parada deliberada) — Level 6: MATERIALIZAÇÃO

Materializar UM candidato → `work_item proposed` é o próximo recorte, mas exige **decisão de
produto/arquitetura** — não é mecânico:

1. **Granularidade.** Os itens canônicos deste doc são FASES conceituais (ex.: "SUP-01 — Fila
   persistente"), não tarefas executáveis únicas. Materializar ingenuamente criaria work_items
   mal-formados. Definir QUAIS itens (ou sub-itens) são materializáveis e em que granularidade
   é uma decisão.
2. **Derivação do proposal/`execution_spec`.** Uma fase-objetivo não tem `execution_spec` de
   worktree óbvio; derivá-lo exige planejamento (possível LLM) — o que este recorte
   deliberadamente evitou (determinístico).
3. **Nada materializável AGORA.** O doc real rende `none` (tudo done/unknown), então não há
   prova viva de materialização a fazer sobre o backlog real — seria preciso um cenário
   sintético, que não prova a derivação geral.

`materialização ≠ aprovação`: quando feita, cria um item `proposed` sob as fronteiras humanas
existentes. A política pura `planCanonicalBacklogMaterialization` já entrega o candidato certo
com segurança; o que falta é a decisão de COMO um candidato canônico vira uma proposta
executável — a próxima fronteira humana/arquitetônica.

## Próximo ponto de retomada

1. **Level 6 (decisão):** granularidade de materialização + derivação de proposta/spec a partir
   de um candidato canônico (fase → tarefa executável). Provavelmente reusa `create_work_proposal`
   (item `proposed`, sob aprovação humana) + o planejador para o `execution_spec`.
2. Enriquecimento de estado: cruzar `status='unknown'` com o Plano (fases aceitas) para reduzir
   os 13 unknown — hoje conservadoramente não-materializáveis.
3. Correlação docs↔work_items (materializedSourceIds real) para o "não duplicar".
