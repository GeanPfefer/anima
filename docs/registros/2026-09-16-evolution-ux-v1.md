# 2026-09-16 — Evolution UX V1 + auditoria epistemológica do registry

**Tipo:** desenvolvimento.

Continuação de [`2026-09-16-capability-map-v0.md`](2026-09-16-capability-map-v0.md)
(commit `bee855c`). Esta etapa é UX/visualização/linguagem sobre a tela
`/evolution` — **sem** reescrever o modelo canônico `Capability` e **sem** iniciar
o Capability Proof Engine.

## Objetivo

Fazer `/evolution` deixar de parecer "um grafo técnico de capabilities" e passar a
ser o **Mapa de Evolução do próprio Anima**: full-width, superfície explorável
(pan/zoom), fronteira presente↔futuro explícita, foco de relações, filtro por
domínio, seletor de objetivo, e linguagem de produto ("Capacidade"/"Provas").

## Branch / HEAD

- **Branch:** `dev`.
- **HEAD inicial:** `bee855c`.
- **HEAD final:** commit desta sessão — "Aprimore a UX do Mapa de Evolução (Evolution UX V1)".
- **`origin/main` (`99bec54`) INTACTA.** Sem push/PR/merge/deploy. Sem compute pago.

## Mudanças relevantes

Modelo (extensão MÍNIMA, contrato compatível):

- [`packages/core/src/capability-map.ts`](../../packages/core/src/capability-map.ts) — `CapabilityProofKind`
  ganhou `work_item` e `route` (tipos distintos: work_item ≠ attempt ≠ commit ≠
  marco ≠ teste ≠ rota). Nenhuma outra mudança de contrato.

Auditoria epistemológica (item 12) — [`packages/core/src/capability-registry.ts`](../../packages/core/src/capability-registry.ts):

- **Correção de tipo:** a prova `8a2515d8` estava marcada como `attempt`; é um
  **work item** (tem lineage e sucessores — confirmado em `docs/planos/002-…`
  e registros de 09-07/09-08). Reclassificada para `work_item`.
- **Rebaixamento conservador:** `compute.external-provider` de `operational` →
  `proven` (chamadas pagas são raras e gated por autoridade efêmera; não há uso
  rotineiro reproduzido que sustente operational).
- **Tipagem de provas:** refs que são rotas/páginas do app reclassificadas de
  `doc` → `route`; componentes/migrations/arquitetura permanecem `doc`.
- Revisadas todas as maturidades fortes; nenhuma `autonomous` foi usada (correto:
  nada é autônomo hoje). Demais `operational`/`proven` mantidas por serem
  defensáveis pelas provas reais.

UI — [`apps/web/app/(app)/evolution/`](<../../apps/web/app/(app)/evolution>):

- `page.tsx` — passa `objectives` (todas as capacidades com `target`, com
  `progress` factual + `path` relevante) além de `domainSummaries`.
- `EvolutionClient.tsx` — reescrito: **full-width/full-height**; layout em
  **regiões de maturidade** (Fundações operacionais → Capacidades atuais →
  **FRONTEIRA ATUAL** → Próximas evoluções → Visão futura) × colunas de domínio;
  fronteira **derivada da maturidade**, não hardcoded. Viewport própria: pan por
  arraste, zoom (roda + botões `+`/`−`), `Ajustar`/`Resetar` (fit), badge de %.
  **Foco de relações** ao selecionar (cadeia ascendente+descendente forte, resto
  atenuado). **Filtro por domínio** (chips com contagem, resumo embutido).
  **Seletor de objetivo** (recalcula distância + caminho). Presente vs futuro por
  forma+cor+texto+opacidade+borda tracejada. Painel: **Capacidade selecionada**,
  **Provas** (tags tipadas), "um caminho relevante (não único)".
- `EvolutionClient.module.css` — reescrito para o novo layout; responsivo
  (empilha painel abaixo do mapa < 900px). AppNav "Evolução" mantido.

## Provas / gates

- `packages/core` — suíte completa: **86 suites, 1726 testes PASS**.
- `apps/web` — `EvolutionClient.test.tsx`: **11 testes PASS** (seleção, foco de
  relações, filtro por domínio, troca de objetivo, zoom/reset da viewport,
  linguagem de produto sem "node"/"Evidências", presente≠futuro por >1 sinal,
  painel de provas tipado, work_item≠attempt, distância factual do objetivo).
- **Typecheck:** `packages/core` 0 erros; `apps/web` 0 erros em `evolution/`
  (18 erros restantes = WIP pré-existente `apps/web/scripts/*.ts`, não
  relacionados).
- Verificação por testes/typecheck (usuário pediu para **não abrir navegador**).

## Limitações / o que não foi feito (por design)

- Sem Capability Proof Engine, sem derivação automática de maturidade, sem IA
  alterando o registry, sem migrations, sem % global, sem lib pesada de graph.
- Layout SVG próprio; em células densas os chips podem ficar próximos (mapa é
  pan/zoom). Foco mobile é básico (painel empilha; sem drawer dedicado).
- Verificação visual em navegador não realizada (restrição do pedido).

## Invariantes de segurança preservadas

- `origin/main` intacta; sem efeito externo; WIP amplo pré-existente preservado;
  commit escopado só aos arquivos de `/evolution` + core capability + este
  registro (`git add` por caminho). Sem `supabase db reset`.

## Próximo ponto exato de retomada

1. Capability Proof Engine (derivar maturidade/provas de event log + attempts +
   verifier + runtime) — o contrato e a UI já estão prontos para isso.
2. Refino mobile (drawer de detalhe) e densidade de rótulos em células cheias.
3. Auto-fit/enquadramento ao focar um domínio ou objetivo.
