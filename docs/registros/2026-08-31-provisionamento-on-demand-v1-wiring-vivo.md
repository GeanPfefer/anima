# 2026-08-31 — Provisionamento On-Demand V1: wiring vivo + prova positiva owned ao vivo

**Tipo:** desenvolvimento + prova (ao vivo). Fecha oficialmente **"Provisionamento
On-Demand V1 — wiring vivo"**. Empilha sobre o 1º recorte, registrado em
[`2026-08-30-provisionamento-on-demand-v1.md`](2026-08-30-provisionamento-on-demand-v1.md).

## Objetivo

Ligar o Provisionamento On-Demand V1 ao caminho vivo do Resident Host, persistir a
evidência de lifecycle e a autorização de compute pago, e **provar** a cadeia nas duas
direções (owned positiva ao vivo; paid negativa determinística), sem cloud e sem gasto.

## Branch / HEAD

- Branch `dev`. HEAD inicial `a6e02ba` (= `origin/dev`). HEAD final `3ae4713` (= `origin/dev`).
- `origin/main` intacta em `99bec54` o tempo todo.

## Commits

- `f244dd3` — Persista a evidência de lifecycle de node e a autorização de compute paga.
- `240292d` — Ligue o node on-demand ao Resident Host com fail-closed financeiro.
- `3ae4713` — Prove o burst owned on-demand VIVO pelo Resident Host e corrija a resolução ESM do fixture.

## Mudanças relevantes

- Persistência (migrations `supabase/migrations/20260830000003..007`, aplicadas ao Supabase
  local): enum + RPC `record_host_observed_node_lifecycle` (append-only, auth.uid+allowlist,
  attempt OPCIONAL, índice único semântico → replay idempotente/conflito `55000`); tabela
  owner-scoped `paid_compute_authorizations` + RPCs `grant`/`revoke` só humano (service_role
  consulta, não fabrica). Core `NodeLifecycleEvidenceV1` ganhou `leaseId` + `attemptId` anulável.
- Wiring `apps/web/lib/work-orchestration/resident-on-demand-node.ts` +
  `autonomous-backlog-deps.ts`: burst on-demand opt-in sob pressão; paid consulta autorização
  ANTES de tudo; owned provisiona processo real e persiste evidência; `inFlight` evita 2ª provisão.
- Lever de prova/ops `ANIMA_ON_DEMAND_FORCE_BURST` (aditivo, env-gated, fail-closed): força só a
  pré-condição de pressão; não burla o gate financeiro nem `unknown`.

## Decisões

- Para provar o burst com a Goma sob headroom (pressão `low`), Gean optou pelo **lever** de
  prova/ops em vez de criar pressão de RAM real (arriscado pela fragilidade de infra observada).
- Prova viva executada pelo **Resident Host in-process bounded** (`ANIMA_RESIDENT_MAX_ITERATIONS=1`),
  escopada a UM item via `autonomous_execution_request` → `requestedWorkItemId` (sem colateral).

## Bugs

- **Encontrado e corrigido (`3ae4713`):** o provisioner de prova resolvia o fixture com
  `__dirname`, **indefinido no runtime ESM** do Resident Host (`--experimental-transform-types`)
  → `__dirname is not defined`. Só o Resident Host revela (jest roda CommonJS). Fix: resolver via
  `projectRoot()` (dual-safe ESM+CJS). A tentativa que crashou o fez ANTES de qualquer attempt —
  zero tentativas consumidas.

## Provas / gates

- **Prova positiva owned VIVA** (item real `d5fa75d7-dc51-4258-8d7a-800865c801e1`, gate
  `npm run typecheck`): offline → provision (node `owned-burst-1`, PROCESSO REAL) → ready →
  routing `ollama:remote/owned-burst-1:qwen3-coder:latest` → coder aplica edit → checkpoint
  `bc8c2aa7` (base `240292d`, 1 arquivo) → gate **passed exit 0 (19.5s)** → lifecycle
  reserved→released→shutdown_requested→shutdown_confirmed (idle→stop→offline) → Verifier
  **verified (0 violations)** → item `review` → **`result_accepted` (user) → `completed`**.
  As 6 transições de lifecycle persistidas pela RPC real (identidade residente Bearer/RLS).
- **Prova negativa financeira** (determinística, pelo mesmo wiring): paid sem autorização →
  `paid_compute_authorization_required`, NodeProvisioner nunca instanciado.
- Gates: core `1304/1304`; web work-orchestration `705/705`; typecheck `5 workspaces`; pgTAP `16/16`.

## Invariantes de segurança preservadas

- `necessidade de recurso ≠ autorização de gasto`. Gate financeiro fail-closed; o lever de prova
  não o burla. Evidência gravada só por identidade humana/residente (Bearer/RLS), **nunca**
  service_role. Aprovação e aceite são atos humanos autenticados.

## Efeitos externos

- **Realizados:** push normal `origin/dev` (`a6e02ba`→`3ae4713`), autorizado (repo público).
- **Explicitamente NÃO realizados:** nenhum provider pago real chamado; nenhuma despesa; nenhum
  deploy/merge/`integrated`/PR; `origin/main` intacta; nenhuma credencial de provider tocada.
  O item de prova parou em `completed` — **não** foi integrado (INT-05 exige 2ª aprovação humana).

## Worktrees / ambientes

- `.worktrees/` preservado (dirs pré-existentes de terceiros/operador intactos; o worktree da
  prova foi criado e descartado). `watch4-sensors.txt` preservado.

## Limitações / não feito

- Persistência de `estimatedCost` observado e política de idle/lease vivas ficam para recortes
  futuros. UI de autorização paga e 1º adapter de provider real ainda não existem.

## Próximo ponto exato de retomada

- UI mínima de concessão/revogação de autorização de compute pago sobre as RPCs/tabela já
  existentes (owner-scoped, ação humana explícita, sem credencial de provider, sem chamar
  provider pago real). Ver [`docs/planos/005`](../planos/) e a memória do projeto.
