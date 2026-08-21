# Cobertura do Next typegen para o gate de typecheck do apps/web por nome de pacote

Data: 2026-08-21
Tipo: desenvolvimento (correção de cobertura) + prova local

## Objetivo e triagem

Com o eixo de orçamento/retomada/prova-viva fechado (bloqueado pela janela do teto
6/24h, ver [`…-checkpoint-prova-viva-preconds-verificadas.md`](2026-08-21-checkpoint-prova-viva-preconds-verificadas.md)),
a triagem do roadmap canônico (Marco 003/005; Plano 002 fases A–F concluídas, G em
andamento; mapa de maturidade do PRD §1f.1) buscou o próximo recorte elegível no
eixo ratificado Supervisor → Executor → Reviewer, **sem** depender da prova viva
nem de nova decisão humana.

Candidato encontrado: o "próximo gargalo" registrado em
[`2026-08-21-loop-pela-superficie-de-produto-chat-ate-review.md`](2026-08-21-loop-pela-superficie-de-produto-chat-ate-review.md)
— gates de typecheck que incluem `apps/web` falham na worktree isolada porque
`apps/web/next-env.d.ts` referencia `./.next/types/routes.d.ts`, um artefato gerado
ausente num checkout fresco. O núcleo desse gargalo já fora fechado por
`prepareAnimaValidation` (roda `next typegen` na worktree antes dos gates;
[`…-prova-runtime-next-typegen-e-barreira-de-orcamento.md`](2026-08-21-prova-runtime-next-typegen-e-barreira-de-orcamento.md)).
Esta sessão fechou uma **lacuna de cobertura** remanescente na detecção.

- Branch: `dev`. HEAD inicial: `0c82712`. HEAD final: este commit.
- `origin/main`: `99bec54`, intacta. Working tree limpa exceto `.worktrees/`.

## Defeito (concreto, causal, confirmado)

`needsAnimaWebTypegen` (gate de `prepareAnimaValidation`) só reconhecia o typecheck
do apps/web por **caminho** (`--workspace=apps/web`) ou o typecheck do monorepo
inteiro. Mas `safeValidationCommand` (a allowlist do planejador) admite
`--workspace=<seletor>` para qualquer workspace, e o npm resolve **tanto o caminho
`apps/web` quanto o NOME do pacote `@anima/web`** ao mesmo workspace (confirmado:
`npm run typecheck --workspace=@anima/web` executa `tsc --noEmit` do apps/web).

Consequência: uma proposta cujo `validation_command` fosse
`npm run typecheck --workspace=@anima/web` (admitida por `safeValidationCommand`,
resolvida pelo npm ao apps/web) rodaria o typecheck do apps/web na worktree **sem**
o Next typegen → `Cannot find module 'next/navigation'` / `.next/types` ausente →
`execution_failed` → item reprovado **por engano** (fail-closed, porém sobre um gate
que o host admitiu e deveria conseguir executar). Mesma classe do bug que o typegen
fechou, mas por baixo-cobertura do predicado de detecção.

## Correção (menor recorte causal)

`apps/web/lib/work-orchestration/executor-selection.ts`: `needsAnimaWebTypegen`
passou a **parsear** o comando de typecheck (com/sem `--workspace`, tolerando
`npm.cmd`, barra final e sufixo `-- …`) e a reconhecer o apps/web pelos **dois
seletores** que o npm resolve ao mesmo workspace: caminho `apps/web` e nome
`@anima/web` (`ANIMA_WEB_WORKSPACE_SELECTORS`). Sem `--workspace` = monorepo inteiro
(inclui apps/web) → typegen. Outros workspaces (ex.: `packages/core`, `@anima/core`)
e gates de `test`/`build` **não** disparam typegen (`build` = `next build` gera os
próprios tipos; `test` = jest não checa tipos). Nada afrouxado; nenhuma mudança em
`safeValidationCommand`, no executor, no orçamento ou nos gates.

## Provas

- `apps/web` Jest `executor-selection`: **29/29** (7 casos novos: seletor por nome
  `@anima/web` com `npm`/`npm.cmd`; normalização barra-final/caixa/sufixo `-- …`;
  core por caminho e por nome NÃO dispara; test/build NÃO dispara; e a composição
  `prepareAnimaValidation` roda o typegen para `--workspace=@anima/web`).
- `npm run typecheck --workspace=apps/web`: PASS. `git diff --check`: CLEAN.
- Verificação de realidade: `apps/web` package name = `@anima/web`; root
  `typecheck` = `npm run typecheck --workspaces --if-present`; `npm run typecheck
  --workspace=@anima/web` resolve ao `tsc --noEmit` do apps/web.

Escopo do fix é um predicado puro + composição já provada de `prepareAnimaValidation`
(que roda `next typegen`, provado ao vivo na worktree no registro do typegen); logo a
cobertura nova está provada por unidade + composição, sem exigir novo worktree vivo.

## Invariantes de segurança

- Nenhum bypass de gate/orçamento; tetos inalterados; nenhum segredo. `origin/main`
  intacta; sem PR/merge/deploy. EVIDÊNCIA ≠ AÇÃO; fail-closed preservado (agora sem
  reprovar por engano um gate legítimo).

## Próximo ponto de retomada

- Prova viva de superfície `chat → … → review` segue **bloqueada pela janela do
  orçamento** (`autonomous_work_budget_status.admitted=false`); retomar só quando
  `admitted=true` (fonte de verdade = a RPC, não o relógio).
- Fase pós-review (`decide_integration`, 2ª aprovação humana) e primeira criação real
  de PR permanecem **fronteiras humanas** — exigem nova ratificação, não implementáveis
  autonomamente agora.
