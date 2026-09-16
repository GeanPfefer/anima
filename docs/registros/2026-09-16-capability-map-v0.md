# 2026-09-16 — Capability Map / Evolution V0

**Tipo:** desenvolvimento.

**Marco conceitual:** `ANIMA CAPABILITY MAP V0` — pela primeira vez o Anima possui
uma representação **explícita** do que sabe fazer, do que foi comprovado, do que
ainda está sendo construído e dos caminhos de evolução até o sistema desejado. A
tela `/evolution` é uma **projeção** desse modelo, não uma página hardcoded.

## Objetivo

Criar a primeira versão canônica da tela de evolução do próprio Anima, sustentada
por um modelo explícito de capacidades: domínio, maturidade, dependências (grafo),
futuro projetado e referências para evidência — separando **definição** de
capacidade de **prova** de que a capacidade funciona.

## Branch / HEAD

- **Branch:** `dev`.
- **HEAD inicial:** `b14a32c` (Canonize a infraestrutura mínima de settlement do ledger de compute pago).
- **HEAD final:** commit desta sessão — "Introduza o Capability Map / Evolution V0" (ver `git log`).
- **`origin/main` (`99bec54`) INTACTA.** Nenhum push, PR, merge ou deploy realizado.

## Mudanças relevantes

Modelo puro (core, testável, sem dependência de dados):

- [`packages/core/src/capability-map.ts`](../../packages/core/src/capability-map.ts) — contrato `Capability`
  (id, domínio, maturidade, `dependsOn`, `unlocks` derivado, `target`, `meaning`,
  `advancement`, `proofRefs`), escada de maturidade
  (`projected → specified → implemented → proven → operational → autonomous`, mais
  `degraded`), validação do registro (ids únicos, refs válidas, ciclos proibidos,
  domínio/maturidade válidos), `buildCapabilityGraph` (deriva `unlocks` como
  inverso de `dependsOn` + `depth` à prova de ciclo), e análise objetiva
  (`summarizeByDomain`, `dependencyClosure`, `summarizeTargetProgress`,
  `longestDependencyPath`). **Sem porcentagem global** — só contagens.
- [`packages/core/src/capability-registry.ts`](../../packages/core/src/capability-registry.ts) — registry V0
  hand-authored com **40 capacidades** nos seis domínios (understanding, memory,
  agency, governance, compute, interaction). Estados fortes ancorados em
  **evidência real** verificada (commits `87a3ad8`, `824c714`, `1c6c656`,
  `4b5c500`, `e090013`, `533ce86`, `38494d5`, `9fa181c`, `78dfc3f`, `6adce1c`,
  `6bef210`, `636aa7b`, `43b47c2`, `b14a32c`, `37cf35f`, `de14178`, `97c042d`,
  `14815f1`, `fbf0baa`, `3d5aa65`, `8dc2228`; attempt `8a2515d8`; marcos 003/005/006/007/008;
  testes e rotas existentes). Futuro (detectar deficiência → formular → validar →
  self-development contínuo; world model; memória narrativa; proatividade
  cognitiva; autonomia progressiva; braço executor GUI) aparece como
  `projected`/`specified` — **nunca** como já existente.

UI (web):

- [`apps/web/app/(app)/evolution/page.tsx`](<../../apps/web/app/(app)/evolution/page.tsx>) — server
  component: auth guard + constrói o grafo no servidor e passa dados **planos e
  serializáveis** ao client (nenhum `Map` cruza a fronteira RSC).
- [`apps/web/app/(app)/evolution/_components/EvolutionClient.tsx`](<../../apps/web/app/(app)/evolution/_components/EvolutionClient.tsx>) —
  mapa de progressão em SVG (layout próprio, **sem** lib de graph layout): faixas
  por domínio × profundidade de dependência (fundações no topo, futuro no fundo),
  arestas de dependência (incl. cross-domain), caminho presente → futuro
  destacado. Estado por **forma + cor + texto** (glifo por maturidade), não só
  cor. Painel de detalhe com nome, descrição, domínio, maturidade, depende de,
  desbloqueia, o que significa, evidências, próximo estágio e o que falta.
- [`apps/web/app/(app)/evolution/_components/EvolutionClient.module.css`](<../../apps/web/app/(app)/evolution/_components/EvolutionClient.module.css>) —
  estilo coerente com os design tokens do app (dark, `--accent`, radius vars).
- [`apps/web/components/AppNav.tsx`](../../apps/web/components/AppNav.tsx) — item de nav "Evolução" → `/evolution`.
- [`packages/core/src/index.ts`](../../packages/core/src/index.ts) — exporta os dois módulos novos.

## Decisões

- **Definição ≠ prova.** `proofRefs` são declarativos e apontam para evidência
  **real** identificada na reconciliação; nada de id/evidência inventada.
- **Grafo, não só árvore.** `dependsOn` cruza domínios; `unlocks` é derivado
  (inverso), fonte única da verdade.
- **Sem % global falsa.** A distância até um alvo é contagem objetiva do fecho de
  dependências (existentes vs. especificadas vs. projetadas).
- **Registry manual como V0.** A arquitetura permite trocar o registry por um
  Capability Proof Engine (event log + attempts + verifier + runtime) sem mudar o
  contrato `Capability` nem a UI — mas **não** foi implementada inferência
  automática agora (fora de escopo deste ciclo).
- **Tamanho V0:** consolidadas capacidades granulares em pares naturais para
  ficar em ~40 (guia do plano: 20–40 relevantes, não centenas de microfeatures).

## Provas / gates

- `packages/core` — suíte completa: **86 suites, 1726 testes PASS** (inclui
  `capability-map.test.ts` + `capability-registry.test.ts`, 30 testes novos).
- `apps/web` — `EvolutionClient.test.tsx`: **6 testes PASS**.
- **Typecheck:** `packages/core` 0 erros; `apps/web` 0 erros nos arquivos novos
  (os 18 erros restantes são WIP pré-existente em `apps/web/scripts/*.ts`
  read-only, não relacionados a esta sessão).

## Limitações / o que não foi feito

- Sem inferência automática de provas (é o próximo passo arquitetural, por design).
- Verificação **por testes/typecheck**, não por navegador: o usuário pediu
  explicitamente para **não abrir navegador automaticamente**.
- Layout SVG é próprio e simples (V0): em células densas os rótulos podem ficar
  próximos; o mapa é rolável. Sem animações nem lib de layout (fora de escopo).

## Invariantes de segurança preservadas

- `origin/main` `99bec54` intacta; sem push/PR/merge/deploy; sem efeito externo.
- WIP amplo pré-existente (`dev`) **preservado**; commit desta sessão é escopado
  **somente** aos arquivos do Capability Map (`git add` por caminho).
- Nenhum compute pago consumido; nenhuma reserva aberta tocada.
- Sem `supabase db reset`; sem migração; sem schema.

## Próximo ponto exato de retomada

1. (Opcional) Enriquecer `proofRefs` com mais eventos/attempts do event log.
2. Evoluir o registry manual para um **Capability Proof Engine** que derive
   maturidade de event log + attempts + verifier + runtime (item 10 do plano).
3. Refinos de UI (filtros por domínio/maturidade, densidade de rótulos, foco por
   subgrafo) — só depois de o modelo estar estável.
