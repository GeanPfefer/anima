# 2026-09-01 — Project Intake V0: início do contrato + barreira do self-dev

**Tipo:** desenvolvimento + investigação de self-dev. **Branch:** `dev`.
**HEAD inicial:** `ce354fa`. **HEAD final funcional:** `08643a2`; o commit posterior contém este
registro. `origin/main` observado em `99bec54` e **não alterado**.

Início da fase "usar a oficina para construir a oficina": o Anima começa a receber ideias de
projeto. Fonte de plano: [Plano 006](../planos/006-project-intake-v0.md).

## Objetivo e resultado

Iniciar **Project Intake V0** (representar uma ideia de projeto em linguagem natural como
estrutura durável mínima, ANTES de desenvolvimento) e, sempre que possível, fazer o próprio
Anima construí-lo pelo coder local. Resultado: o **contrato puro** existe, validado e testado; a
tentativa de self-dev foi bloqueada por infra desligada + fronteira humana (não por defeito de
código) e está registrada e preparada como handoff.

## Investigação arquitetural (antes de editar)

- **Não há entidade "Project Idea" canônica.** Os `project_*` (`project_decision_proposals`,
  `project_backlog_proposals`, `project_backlog_materialized_items`) são governança/backlog do
  DESENVOLVIMENTO, não a ideia de projeto de um usuário. Logo Project Intake é conceito novo em
  módulo próprio — não estende nem confunde os existentes.
- **Criação de WorkItem canônico** = backlog documental (`docs/planos/002-…-backlog.md`, IDs
  estáveis) → `parseCanonicalBacklog` → materializer, que usa um **planner LLM**
  (`planExecutableProjectWork`) para produzir o `execution_spec` → `proposed` → **aprovação
  humana** → claim → coder → gates → Verifier → `review`.
- **Coder local** é acionado pelo supervisor turn / worktree executor sob identidade
  Bearer/RLS (resident host) — tudo exige o stack local de pé.

## Barreira do self-dev (ato humano/infra impossível de substituir aqui)

- **Docker daemon DOWN** (`docker info` falha) → sem Supabase local (`54321` inacessível) → sem
  `work_items`/RPCs → sem materializer/supervisor/coder. Ollama (`11434`) e Next (`3000`)
  também desligados. Tooling presente (docker/ollama/supabase-cli), serviços não.
- **Aprovação humana** do item `proposed` é fronteira real (máximo autônomo é `review`).
- Barreira de RAM da Goma para coder 30B permanece pano de fundo (`OLLAMA_MODEL=qwen2.5:14b`
  atenua). Nada disso é defeito de código corrigível nesta sessão.

Decisão: não fabricar aprovação, não subir um stack que o hardware não sustenta para o coder;
implementar a FUNDAÇÃO testável (seam) e preparar os recortes 2–5 como self-dev.

## Caderno de evidência (origem observada)

- **Escrito por Claude** (coder local NÃO rodou): `packages/core/src/project-intake.ts`
  (contrato `ProjectIdeaV0` + `validateProjectIdea` + `draftProjectIdea` +
  `summarizeProjectIdeaIntake`), `project-intake.test.ts` (22 testes), export no barrel,
  Plano 006, este registro.
- **Escrito pelo coder local do Anima**: NENHUM arquivo nesta sessão. Motivo: barreira acima.
- Métrica honesta: **0%** do Project Intake V0 foi implementado pelo coder local nesta sessão.
  Todo o código é de origem Claude (commits `da11b90`, `08643a2`). Sem attempts/reads/edits/
  gates/repair/Verifier do fluxo autônomo — o fluxo não pôde ser iniciado.

## Mudanças (commits)

- `da11b90` **Introduza o contrato puro de Project Intake V0** — módulo core, domínio-genérico,
  sem LLM/persistência/efeito.
- `08643a2` **Planeje Project Intake V0 e o handoff self-dev** — Plano 006.

## Provas / gates

- Focado: `project-intake` 22/22. Core completo: **65 suites / 1371** (64+1; +22). typecheck
  packages/core PASS. Web não tocado; sem SQL (pgTAP não impactado); Next não tocado.
- typecheck 5 workspaces PASS (barrel do core alterado).

## Efeitos externos

`push` para `origin/dev` (autorizado após gates verdes). `origin/main` intacta. Nenhum
PR/merge/deploy. ZERO compute pago/RunPod/gasto. Nenhum stack local subido. Locais preservados:
`.worktrees/`, `watch4-sensors.txt`, `.claude/settings.local.json`.

## Onde o fluxo para hoje e próximo recorte

Para no **contrato**. Próximo recorte mais valioso: um recorte SEM migration que o coder local
possa convergir quando o stack subir — ex.: serializador puro `ProjectIdeaV0 ↔ shape persistido`
ou a projeção de apresentação — antes da persistência com migration/pgTAP.

**Estamos mais perto** de usar o caso real do estúdio de pilates como primeiro Project Intake: o
modelo genérico já representa exatamente os conceitos daquela ideia (título, problema, contexto,
stakeholders, objetivo, restrições, perguntas, riscos, integrações, hipótese de MVP, status). Só
faltam persistência + caminho de criação + apresentação — e um ambiente com o stack de pé (e o
humano para aprovar) para que o Anima os construa e receba o primeiro intake.
