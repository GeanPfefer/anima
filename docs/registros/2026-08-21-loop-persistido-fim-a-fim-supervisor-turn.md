# 2026-08-21 — Primeira célula PERSISTIDA do modo autônomo local (supervisor-turn real)

- **Tipo:** prova (viva, persistida).
- **Branch:** `claude/integration-application-layer`. **HEAD:** `c999aed` (código inalterado nesta prova; só doc).
- Complementa [`2026-08-21-loop-local-coder-verifier-fim-a-fim.md`](2026-08-21-loop-local-coder-verifier-fim-a-fim.md) (que provou a COMPOSIÇÃO do Verifier). Aqui a prova é pelo **caminho persistido real de produção** (Supabase local + rota `supervisor-turn`), sem atalho manual entre etapas.

## Objetivo
Provar, a partir do estado REAL do Supabase, a célula persistida: `approved work → autonomous execution → coder local → real diff → real gates → durable handoff → independent observed evidence → durable verifier opinion → projected final result`.

## Ambiente
Docker 29.7.2; Supabase local (`supabase_db/rest/kong/auth` healthy; `vector` reiniciando — irrelevante). Next.js 15.5 dev server (`.env.local`). Ollama `qwen3-coder:latest` (default de produção do backend ollama). Usuário dev `daee716f-…` (no allowlist).

## Caminho atravessado (real, sem atalhos)
1. **Seed real** (RPCs autenticados como o usuário, token JWT legítimo assinado com o GoTrue secret local — RLS trata como o usuário, NÃO service-role bypass): `ai_conversations` (mensagem-fonte) → `create_work_proposal` → `resolve_approval` (approve). Item `project:anima`, planner `local_ollama_project_tools_v1`, `execution_spec` (executor worktree, coder_backend ollama, model qwen3-coder:latest, base_sha=HEAD, validation_criteria `npm test --workspace=packages/core`, limits {3,30}). Objetivo pequeno/determinístico: acrescentar um comentário de marcação ao fim de `packages/core/src/xp.ts`.
2. **POST `/api/work-orchestration/supervisor-turn`** (Bearer do usuário) → a ROTA real: classificou (bounded/low/reversible/clear) → roteou `worktree-v1` / `ollama:qwen3-coder:latest` → executou `OllamaCoderBackend` em worktree isolada do repo real → gate `npm test --workspace=packages/core` → persistiu tudo. `terminalKind:result`.
3. **Diff REAL** na branch `anima-work/<attempt>`: `+// anima-verifier-proof-…` ao fim de `xp.ts` (append via a op nova). **Workspace real INTACTO** (isolamento de worktree).

## Cadeia de eventos PERSISTIDOS (reconstruída do banco, por `seq`, correlação única ao attempt)
`work_proposed → context_attached → work_approved(user) → work_intelligence_classified → work_routing_adjusted → work_routing_decided → work_claimed → work_started(user) → execution_started → checkpoint_recorded(executor, ⇒ fase Testando) → result_submitted(executor, handoff) → work_claim_released → host_observed_gate_evidence_recorded(host) → host_observed_coder_evidence_recorded(host) → host_observed_evidence_recorded(git, host) → verifier_opinion_recorded(verifier)`

- **Verifier `verified`**, `restsOnAttestedEvidence:true`, `coverage {git:true,gates:true}`. Findings com `scope_independently_observed`/`gates_independently_observed` (provenance **independent** — repousa em git+gate host-observed, não só na atestação).
- **Git host-observed** (independente): `observedChangedFiles: ["packages/core/src/xp.ts"]`.
- **Gate host-observed**: `npm.cmd test --workspace=packages/core` → `outcome passed, exitCode 0, ~31s` (suíte real do core).
- **Estado final do item: `review`** — pronto para revisão humana, NÃO auto-integrado. Verifier ADVISORY preservado.

## Semântica de ordem (assíncrona/fail-open, por desenho)
Após `result_submitted`, a rota persiste na ordem: (0) gate host-observed → (0b) coder → (1) git host-observed → (2) `computeAndPersistVerifierOpinion` (lê o estado FRESCO, inclui git+gate recém-persistidos). Tudo fail-open (persistir evidência/parecer nunca altera o desfecho). Ordem determinística nas duas rodadas.

## Reprodutibilidade
**2/2 rodadas verdes** (attempts `bd5dffe4` e `c10a1a26`), ambas `verified`, `coverage {git:true,gates:true}`, gate exit 0, item `review`. Não acidental.

## Superfície do usuário
A UI real já dispara isso: `WorkProposalCard.tsx`/`WorkDecisionCard.tsx` fazem POST em `/api/work-orchestration/supervisor-turn`; a apresentação projeta fase (`deriveWorkProgressPhase`) + parecer (`opinionHistory`). Sem gap de UI demonstrado.

## Invariantes / efeitos
- `origin/main` = `99bec54` intacta. SEM push/PR/merge/deploy/`integrated`. Verifier não aceitou/integrou (item ficou `review`).
- Nenhuma mudança de schema. Nenhum default/piso/roteamento de modelo alterado (qwen3-coder é o default do backend ollama; medição, não ratificação).
- Preservados `.worktrees/`, `.claude/settings.local.json`, `apps/web/.env.local`. Branches `anima-work/<attempt>` mantidas (referências de resultado revisáveis, por desenho). Dev server e Supabase locais reutilizados (não subvertidos).
- RLS respeitado: seed e execução autenticados como o usuário; nenhum caminho privilegiado para forçar verde.

## Próximo ponto de retomada
Loop persistido autônomo local FECHADO e reprodutível. Próximo gargalo: (a) disparo pela UI real ponta a ponta (a `WorkProposalCard` já posta ao supervisor-turn; falta validar a criação de item worktree-elegível pela superfície de chat — nuance histórica do `developmentMode`); (b) fase pós-review (aceitar → integração de 2ª aprovação humana, `decide_integration`), fora do micro-loop.
