# 2026-08-21 — Loop autônomo local disparado pela SUPERFÍCIE DE PRODUTO (chat → review)

- **Tipo:** prova (viva, persistida) + investigação.
- **Branch:** `claude/integration-application-layer`. **HEAD:** `99fc3ff` (código inalterado nesta prova; só doc).
- Fecha a fronteira "usuário → Anima autônomo → review" pela superfície REAL do produto. Complementa os registros `2026-08-21-loop-persistido-fim-a-fim-supervisor-turn.md` (persistência via supervisor-turn com seed manual) e `2026-08-21-loop-local-coder-verifier-fim-a-fim.md`.

## Pergunta investigada
Pela superfície normal de chat/web, é possível criar um work item worktree-elegível e levá-lo até `review` — mensagem → proposta → aprovação → "Executar autonomamente" → supervisor-turn → execução → gates → verifier → review — SEM seed manual após a entrada do usuário?

## Classificação: **A** (a superfície já suporta) + um gap de ambiente separado
- **`developmentMode` NÃO é gap nem hack removível:** é fronteira de produto deliberada (`lib/ai/chat-surface.ts`, pós-incidente): habilita ferramentas de repositório só com DUAS condições independentes — flag da superfície dedicada (`developmentMode:true`, enviado pelo `ChatClient` no modo dev) E autorização persistida (`ANIMA_DEVELOPMENT_CHAT_USER_IDS`). É autonomia progressiva; sem o env, impossível para todos.
- **A rota real de chat cria o item elegível:** `POST /api/ai/chat` (cookie auth) → `interpretWorkRequest` → (work_candidate sem spec) `shouldRunProjectPlanner` → `planExecutableProjectWork` (planner investiga o repo real) → `createWorkOrchestrationService.createProposal` → item `proposed` com `execution_spec` (target project:anima, executor worktree, coder ollama, base_sha=HEAD, permissions, validation_criteria, limits {3,30}). Confirmado: item criado com `included_scope:["packages/core/src/xp.ts"]`, executor worktree.
- **Aprovar** = `POST /api/work-orchestration/decisions {decision:{type:'approve'}}` (o botão "Aprovar" do `WorkProposalCard`). **Executar autonomamente** = `POST /api/work-orchestration/supervisor-turn` (o botão, visível quando `state==='approved' && autonomousEligible`).

## Prova viva (surface → review), reconstruída do Supabase — VERDE
Item `b3c7c2e2` (attempt `64a34571`), tudo pelas rotas de produto (cookie do usuário dev; nenhum seed manual pós-mensagem):
`work_proposed → context_attached → work_approved(user) → work_intelligence_classified → work_routing_decided → work_claimed → work_started(user) → execution_started → checkpoint_recorded(→Testando) → result_submitted(handoff) → host_observed_gate_evidence_recorded → host_observed_coder_evidence_recorded → host_observed_evidence_recorded(git) → verifier_opinion_recorded`
- **Verifier `verified`**, `coverage {git:true,gates:true}`; git host-observed `["packages/core/src/xp.ts"]`; gate `npm test --workspace=packages/core` `passed exit0`; **item final `review`** (não auto-integrado; Verifier advisory). Diff real na branch (`+// End of XP calculations module`); workspace real intacto. Coder `ollama:qwen3-coder:latest`, ~76s.

## Gap determinístico REAL encontrado (separado da superfície) — próximo gargalo
Uma primeira rodada pela superfície criou um item cujo planner (OpenAI) escolheu o gate `npm run typecheck` (typecheck do monorepo inteiro, inclui apps/web). Esse gate **FALHA numa worktree isolada** (`execution_failed`, exit 2; item→`failed`, fail-closed correto, sem verified falso). Causa raiz (repro com node_modules linkado): `apps/web/next-env.d.ts` referencia `/// <reference path="./.next/types/routes.d.ts" />`, um artefato GERADO por `next dev`/`build` e ausente numa checkout fresca → `Cannot find module 'next/navigation'`/`*.module.css`. Gates escopados a um workspace que não depende de artefatos gerados do Next (ex.: `packages/core`) rodam limpo. **Não é gap de superfície/elegibilidade**; é o executor de worktree × gates que incluem typecheck do apps/web. O menor recorte NÃO foi necessário para esta prova (tarefa escopada ao core passou) — fica como próximo gargalo: fazer o worktree sustentar typecheck do apps/web (gerar `.next/types` no worktree) OU o planner preferir gates worktree-compatíveis.

## Planner local (observação, não bloqueio)
Com `ANIMA_PROJECT_PLANNER_PROVIDER=local` (qwen2.5:14b), o planner rodou ~220s e "não chegou a uma proposta terminal" (variância on-demand conhecida). O default de produção (planner OpenAI) produziu a proposta em ~18–30s de forma confiável. O micro-loop de EXECUÇÃO permaneceu 100% local (OllamaCoder/qwen3-coder) nas duas provas verdes; o planner (upstream da aprovação) é o único componente de nuvem, e é o default configurado.

## Auth / bootstrap (BOOTSTRAP-DA-PROVA ≠ caminho de produto)
A rota de chat usa cookie (`@supabase/ssr createServerClient`). Sessão obtida pelo fluxo canônico do GoTrue (admin `generate_link` magiclink → `verify` → access+refresh) e o próprio `@supabase/ssr.setSession` computou o cookie `sb-127-auth-token` (validado por `getUser`). Sem senha/token no repo; sem mutar conta. Todo o caminho pós-login (chat/proposta/aprovação/execução/persistência) é real.

## Invariantes / efeitos
- `origin/main` = `99bec54` intacta. SEM push/PR/merge/deploy/`integrated`. Verifier não integrou (itens em `review`/`failed`). Nenhum schema/default de modelo/roteamento alterado. `developmentMode` NÃO afrouxado (é a fronteira correta). Gates NÃO afrouxados (o gate que falhou falhou honestamente).
- Preservados `.worktrees/`, `.claude/settings.local.json`, `apps/web/.env.local`. Dev server/Supabase locais reutilizados. Branches `anima-work/<attempt>` mantidas (referências revisáveis). Itens de prova (`f0840e2b` failed, `b3c7c2e2` review) permanecem no DB local como evidência.

## Próximo ponto de retomada
Loop pela superfície de produto FECHADO até `review`. Próximo: (a) o gap do gate de typecheck do apps/web na worktree (para o Anima trabalhar sobre apps/web autonomamente); (b) fase pós-review na superfície (aceitar → `decide_integration`, 2ª aprovação humana), fora do micro-loop.
