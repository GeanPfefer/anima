# 2026-10-02 — Evolution UX V2 / Akita Baseline + direção de reuso

- Tipo: desenvolvimento e validação local de UX.
- Objetivo: mandato humano do [Plano 009](../planos/009-evolution-ux-v2-akita-baseline.md).
- Branch: `codex/evolution-ux-v2`.
- Worktree: `G:/anima/.worktrees/evolution-ux-v2`.
- HEAD inicial: `6eb2dee4971ed7ae649b1bba795d572a2dfb8665`.
- HEAD final: commit que introduz este registro e a implementação; recuperável
  por `git log -1 -- docs/registros/2026-10-02-evolution-ux-v2-akita-baseline.md`.
- Commit previsto: `Exponha o baseline Akita e a direção de reuso na evolução`.

## Mudanças e decisões

Ver contrato, rationale e fronteiras no Plano 009. Arquivos de implementação:

- `packages/core/src/capability-map.ts` e teste: direção/referências de decisão,
  responsabilidade, etapas ordenadas de target, validação e sinais advisory.
- `packages/core/src/capability-registry.ts` e teste: objetivo Akita, candidatos
  Codex/Claude separados, representações históricas Ollama/DSH, direções e
  responsabilidade explícitas. Registry 63 → 68.
- `apps/web/app/(app)/evolution/page.tsx`: objetivo padrão Akita.
- `apps/web/app/(app)/evolution/_components/EvolutionClient.tsx`, CSS e teste:
  sequência selecionável, lentes e painel com direção/reuso/provas distintos.
- PRD e Plano 009: estado vivo e retomada.

Comparação executável com o registry da baseline: as **63 capacidades anteriores
mantêm exatamente maturidade, proofRefs e history**. Nenhuma promoção/rebaixamento.
Novas capacidades Ollama/DSH são proven por registros de provas controladas já
existentes (08-21 e 08-18); não se alega operação confiável nem autonomia. Codex,
Claude e ai-memory permanecem projected/candidate nesta fotografia, apesar do
WRAP aprovado. O WIP paralelo do Claude não é fonte de prova desta branch.

## Gates finais

- Core: `npm.cmd run test --workspace=packages/core -- --runInBand capability-map
  capability-registry capability-proof autonomy-readiness`: **8 suítes, 230 PASS**.
- Web: `npm.cmd run test --workspace=apps/web -- --runInBand EvolutionClient
  capability-assessment-read self-deficiency-read produce-change-evidence-read`:
  **4 suítes, 69 PASS** (40 da EvolutionClient, 29 do read model/regressões).
- `npm.cmd run typecheck`: **PASS**, todos os workspaces com script, após correção
  dos testes. Typecheck web repetido após testes finais: **PASS**.
- `npm.cmd run build`: **PASS**, 68 páginas geradas; /evolution compilada.
- `git diff --check`: **PASS**.
- Capturas SSR estáticas desktop 1440×1000 e mobile 390×844, inspecionadas
  visualmente, em `.tmp/evolution-desktop.png` e `.tmp/evolution-mobile.png`.
  Renderer `.tmp/render-evolution.cjs` usa código real, CSS real e registry real,
  sem autenticação/banco/provider. Chromium headless; nenhum navegador interativo.
  Capturas **não** provam hidratação, integração viva ou telemetria do produto;
  pan/zoom, relações e seleção são cobertos pela suíte da EvolutionClient.

## Falhas intermediárias / ambiente

- Dependências compartilhadas inicialmente ligadas só na raiz: Next/Expo não
  resolviam. Junctions locais `node_modules`, `apps/web/node_modules` e
  `apps/mobile/node_modules` para instalações existentes; `next-env.d.ts` local
  copiado, sem instalar/alterar dependências do checkout principal.
- Corrigidos nesta branch: uso de Object.hasOwn incompatível com ES2020;
  opção `exact` inválida no getByRole; expectativa nova de RunPod corrigida
  para implemented (estado real preservado); contagens de candidatas atualizadas.
- Renderer temporário inicialmente transpôs .ts como TSX; corrigido com fileName.
- Build advertiu sobre múltiplos lockfiles e raiz de tracing inferida em G:/anima.
  Build passou; next.config não alterado para evitar delta de infraestrutura.
- Flakes observados: nenhum nos gates finais. Sem script de lint na raiz.

## Isolamento e invariantes

- Checkout principal já tinha PRD/plano TPC-01 alterados e arquivos operacionais
  não rastreados; preservados, sem copiar esse WIP para esta branch.
- Nenhuma alteração em work-orchestration, backends, executor selection,
  worktree-executor, CoderTaskSpec ou integração Codex CLI.
- Nenhuma migration, escrita em banco, policy/authority, enforcement, execução
  de harness, provider/compute pago, push, PR, merge, deploy ou integração.
- origin/dev e origin/main não alteradas por esta sessão.
- Worktree gerenciada inicialmente criada em C:/Users/GeanTeco/.codex/worktrees
  não pôde ser movida entre volumes (Improper link). Checkout de entrega criado
  no workspace G:; arquivo gerenciado não usado foi encaminhado para archive
  pela ferramenta do app. Não remover worktrees de terceiros.
- `.tmp` contém somente instrumentos/capturas desta sessão, excluídos do commit.

## Fronteira humana e retomada exata

**BLOCKED_BY_HUMAN_DECISION para integração**, por pedido explícito do humano.
A implementação e gates locais estão concluídos. Revisar branch e capturas;
integrar quando autorizado, reconciliando o PRD com as mudanças do Claude.
Não há conflito de código previsto com CodexCliCoderBackend. Antes de mudar
maturity/reuse.status do candidato Codex, auditar a integração e a prova viva
final do Claude no checkout principal; não promover por presença de código ou
pela decisão WRAP. Capturas SSR não substituem prova autenticada de /evolution.
