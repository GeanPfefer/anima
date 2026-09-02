# 2026-09-02 — Ciclo de correção pós-review pela CLI, sem a web

**Tipo:** desenvolvimento + prova. **Branch:** `dev`. **HEAD inicial:** `de14178`.
**HEAD final:** commit que contém este registro. Continua
[2026-09-02-cli-operacional-adapter-oficial.md](2026-09-02-cli-operacional-adapter-oficial.md).

## Objetivo

Fechar o seam da **materialização da correção pós-`request_changes`**, que ainda dependia
da rota web `review-corrections`, e provar o ciclo `review → request_changes → materializar
sucessor → aprovação humana` operável pela CLI com o Next.js desligado. Sem TUI, sem PIN-03,
sem duplicar regra na CLI.

## Seam (já era application-level — nenhuma extração necessária)

`correctReviewedWorkItem(client, workItemId)`
([review-correction-orchestration.ts](../../apps/web/lib/work-orchestration/review-correction-orchestration.ts))
já recebia um `SupabaseClient` (não `NextRequest`) e continha toda a capacidade (carregar
item+eventos, ler lineage, `planCorrectionFromReview` puro, `proposeCorrectionSuccessor` →
RPC `propose_recovery_successor` idempotente). A rota `review-corrections/route.ts` só faz
parse do body + mapeia HTTP (5xx infraestrutura × 422 precondição). A CLI chama a MESMA
capacidade; o split 422/5xx virou exit `3`/`1`.

## Mudanças (CLI)

- `anima work correct <id>` → `correctReviewedWorkItem` (porta `ReviewCorrectionCapability`
  injetada; testável por duplo). Boundary máximo `proposed`; NÃO aprova.
- **Split de verbos** alinhado ao domínio (antes `work approve` = accept_result):
  * `anima work approve <id>` → aprovação de PROPOSTA (`resolveApproval`, `proposed → approved`);
  * `anima work accept <id>` → aceite de RESULTADO (`reviewResult`, `review → completed`).
- `anima work show` enriquecido: objetivo, escopo incluído/excluído e **gates planejados do
  execution_spec com `covers`** — superfície de inspeção de governança do pipeline do Verifier v2.
- Runners sobre a porta do application service; exit codes preservados (0/1/2/3).

## Prova viva (Next DOWN 3000 ausente, Supabase UP 54321)

Tudo pela CLI, identidade residente `e570e43b-…` (RLS via GoTrue, sem service_role), ZERO
chamada a localhost:3000:

- `work correct 8e9fd82b-…` → sucessor **`330e55e2-0ce2-436c-8293-85a052c24632`** materializado
  em `proposed` (lineageId `09c1b515-…`, recoverySequence 1, replayed false), exit 0.
- `work show 330e55e2-…` → escopo ESTRITO da correção: incluído
  `packages/core/src/project-intake.test.ts`; excluído `packages/core/src/project-intake.ts`
  (implementação preservada), `supabase/`, `apps/`, `packages/types/`; objetivo retoma do
  checkpoint `2602dac` e embute a razão autorizada.
- `work approve 330e55e2-…` → `resolveApproval` → **`approved`**, exit 0 (aprovação humana
  autorizada por este mandato, condições de escopo satisfeitas).

PIN-02 (`8e9fd82b-…`) permanece `changes_requested` (não mutado; o sucessor é item separado
ligado por lineage). Attempt/result/branch/checkpoint/verifier v1 históricos intactos.

## Achados críticos (o próximo seam real)

O sucessor é escopo-correto, MAS **não converge a `verified` sob o Verifier v2** por dois fatos:

1. **Gates sem `covers`.** Os gates planejados ("Project Intake focado", "Typecheck core")
   herdam o execution_spec do PIN-02 (planejado antes de `33c88ea`) e não declaram `covers`.
   `work show` mostra "SEM covers" e cobertura de aceite **0/2**.
2. **Critérios de aceite do sucessor são invariantes de ESCOPO** — "cumprir a revisão tocando
   apenas o test file" e "manter a implementação intacta". A regra do Verifier v2 (cada aceite
   → gate aprovado via `covers`) é estruturalmente incapaz de marcar esses como cobertos: um
   gate roda um comando, não prova que um arquivo permaneceu intacto — quem prova é a OBSERVAÇÃO
   DE ESCOPO (`scope_respected`/`change_in_excluded_scope`). Logo, mesmo adicionando `covers`,
   o critério "impl intacta" continuaria `acceptance_criterion_without_evidence` → `inconclusive`.

Consequência: `deriveResumeCorrectionSuccessor` + Verifier v2 (`33c88ea`) têm uma incompatibilidade
de modelo para o caso de correção. Fechá-la é decisão de DOMÍNIO (não da CLI): ou a derivação
emite critérios/gates prováveis por comando com `covers`, ou o Verifier v2 passa a satisfazer
critérios de escopo pela evidência de escopo observada. Fora do "extrair só o necessário" desta
sessão e toca o Verifier v2 (que `33c88ea`/mandato pedem preservar).

## Não executado (deliberado)

Self-dev pesado (qwen3-coder/worktree/gates) NÃO foi disparado: a máquina é compartilhada
(Governor/convivência — mandato §12, que autoriza deixar a prova viva pendente com evidência) E
a execução não convergiria a `verified` pelos achados acima. Nenhum app do usuário foi encerrado.

## Segurança e efeitos externos

Sem service_role (RLS/GoTrue/Bearer; token nunca logado). Sem migration, `db reset`, publish
externo, PR, merge, deploy. `origin/main` = `99bec54` intacta. Efeitos persistidos (autorizados):
sucessor de correção materializado (`330e55e2`) e sua aprovação (`approved`). `.worktrees/`,
`watch4-sensors.txt`, `apps/web/.env.local`, `.claude/settings.local.json` preservados.

## Validação (gates)

typecheck `apps/web`+`packages/core` limpos. CLI jest 30/30 (args, app com duplos, render).
Suítes proporcionais do core/web executadas na sessão anterior sem regressão; esta sessão só
adiciona `apps/web/cli`.

## Fronteiras humanas / próximo ponto de retomada

O sucessor `330e55e2` está `approved` e ELEGÍVEL (autonomia habilitada), mas nada executa até
alguém rodar o resident host. **Antes de rodar o self-dev**, resolver o gap covers/escopo acima
(decisão de domínio) para que a correção possa alcançar `verified`; senão o ciclo retorna a
`review` `inconclusive` e à decisão humana. PIN-03 (migration) permanece adiado.
