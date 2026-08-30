# Provisionamento On-Demand V1 — boundary provado com processo local real

- **Data/tipo:** 2026-08-30 — desenvolvimento + prova controlada.
- **Objetivo:** dar ao Anima um lifecycle governado para disponibilizar e desligar um node de
  compute quando a Goma não tiver headroom, preservando `necessidade ≠ autorização de gasto` e
  toda a autoridade de execução na Goma. Sem cloud real, sem despesa.
- **Branch / HEAD inicial:** `dev` / `14e49b7` (== `origin/dev`; `origin/main` == `99bec54`).
- **HEAD final:** commit que inclui este registro.
- **Commits:**
  - `fd92ced` — `Modele o ciclo de vida governado de node de compute (core puro)`.
  - `7dcd764` — `Prove o lifecycle de provisionamento com processo local real`.
  - commit de documentação que inclui este registro + [Plano 005](../planos/005-provisionamento-on-demand-v1.md).

## Investigação da governança existente (antes de desenhar)

- Placement V0 (`coder-placement.ts`) recebe `paidComputeAuthorized: boolean`, hardcoded
  `false` em `autonomous-backlog-deps.ts` — o gate financeiro canônico não existia.
- Invariante financeira já presente: `recovery-successor.ts` recusa sucessor que introduza
  `financial_authorization|paid_compute|auto.?provision`; `autonomous-authorization.ts` exclui
  impacto `financial`; `impact_level` tem `financial`. Os dois "backlogs" citados (auditar
  autorização/custo; exigir autorização humana) eram conceitos a não duplicar, não itens
  literais — nenhuma primitiva financeira persistida existia.
- Resource Governor é observacional/advisory (`EVIDÊNCIA ≠ CLASSIFICAÇÃO ≠ ADVISORY ≠ DECISÃO
  ≠ AÇÃO`); budget local×external é por tentativa/tempo, não dinheiro. Visão em
  `docs/arquitetura/visao-identidade-compute-distribuido.md` (§6, §7, §9, §11–13, §19).

## Mudanças relevantes

- Core puro: `node-lifecycle` (SM mínima idempotente/fail-closed), `paid-compute-authorization`
  (autorização humana com proveniência, fail-closed), `node-lease` (envelope temporal + custo
  derivado), `node-provisioner` (contrato provider-agnóstico), `provisioning-decision` (separa
  placement de provisionamento), `node-lifecycle-evidence` (host-observed). Exportados do index.
- Web (prova): `local-process-node-provisioner` (sobe/desliga PROCESSO REAL pela porta
  `NodeProvisioner`), fixture `fake-inference-node.cjs` (endpoint fake-realista com modos de
  falha), `provisioning-on-demand-v1.test`.

## Decisões

- Placement continua sendo só decisão; a criação de servidores mora numa camada separada
  (`decideCoderProvisioning`), subordinada à autorização financeira e ao lifecycle.
- Autorização de compute pago é artefato HUMANO com proveniência (nunca `system`, nunca
  derivada de pressão). Boolean solto substituído por decisão determinística.
- Evidência de lifecycle é host-observed (Goma é a fonte da saúde/custo).
- Persistência (evento/RPC/migration) e wiring vivo deliberadamente DEFERIDOS (gaps
  registrados no Plano 005), favorecendo vertical slice real sobre infra especulativa (§19).

## Provas / gates (números)

- Core: 61 suítes / 1304 testes verdes (baseline 1235 + 69 novos: node-lifecycle 25,
  paid-compute-authorization, node-lease, provisioning-decision, node-lifecycle-evidence).
- Prova controlada web: `provisioning-on-demand-v1` 6/6 verdes — lifecycle completo com
  processo real + coder real aplicando no Git da Goma + gate real; recovery (provision_failed
  sem auto-retry, health_failed com teardown, shutdown_failed, idempotência, lease expirado).
- Web work-orchestration adjacente (placement/evidence/executor/prova): 57/57 verdes.
- Typecheck raiz: mobile, web, core, supabase, types — todos verdes.

## Limitações / não feito

- Sem persistência da evidência de lifecycle nem da autorização financeira (sem migration/RPC).
- Caminho vivo inalterado: `paidComputeAuthorized=false` segue no Resident Host.
- Sem prova com provider pago (bloqueada por autorização financeira persistida, de propósito).
- `next build` de produção não executado: a mudança é aditiva (lib + teste + fixture), não toca
  rota/página/componente, e o typecheck dos 5 workspaces passou.

## Invariantes de segurança preservadas

- `necessidade ≠ autorização de gasto`; compute pago fail-closed; sem auto-provisão em falha.
- Worktree, Git, gates, Verifier, banco e Anima Web permanecem na Goma.
- `.worktrees/`, `.claude/settings.local.json`, `apps/web/.env.local`, `watch4-sensors.txt`
  preservados.

## Efeitos externos

- Nenhuma cloud, VM/GPU, deploy, merge, `main`, credencial ou gasto externo.
- Nenhum node escreveu no repositório; a workspace original permaneceu intacta.
- Push para `origin/dev` autorizado explicitamente pelo usuário nesta sessão (repo público);
  segredos auditados antes do push.

## Próximo ponto exato de retomada

Recorte de persistência: `work_event_type host_observed_node_lifecycle_recorded` + RPC
host-observed + migration/RLS + typegen para a evidência de lifecycle; e a tabela/RPC
autenticada da `PaidComputeAuthorizationV1` (autoria humana, sem `service_role`). Só então
ligar `decideCoderProvisioning` + provisioner + lease ao Resident Host, preferindo primeiro um
node **owned** provisionado on-demand. Comparação de providers pagos registrada no Plano 005;
nenhum será provisionado sem autorização financeira separada.
