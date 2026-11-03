# Evolution Reconciliation V5 — attempt b557509b (REVIEW, verified) — 2026-10-14

Append-only. Base `af9c5577fadba8bb0b849f0159c9ead212526947` (dev = origin/dev). Plano 064 (untracked; só o texto do item foi usado). Nada aceito, integrado ou publicado.

- Decisão humana (2026-10-14): mudar `EVOLUTION_BASELINE` quebraria `EvolutionClient.test.tsx` (hardcoded `Evolution UX V1`/`7f276d8`); escopo ampliado a 3 arquivos; janela "Evolução recente" desde 2026-10-07 (baseline `6226324`, "Evolution Reconciliation V4"), não os valores literais do plano.
- Item `4c681ba5-00cd-4715-b8fa-3be438a22cfe` v1 (contrato persistido == `command_v5.json`; `acceptance_contract:2`; 1 tentativa/35 min; sem resume). Eventos: proposed 86665, approved 86667, classificação humana 86668 (bounded/low/reversible/clear/normal).
- Preflight: HEAD==origin/dev==base; índice vazio; RAM `permit`; Codex/WSL pronto (`singleItemCodexRefusal` null); 0 claims/leases; única recusa `user_attempt_budget_exhausted` (15 attempts/24 h; runtime 24 h restante 221 s, do mesmo orçamento interno). Lease E0 `a7886086-7897-49a6-a1bf-2bac4ed05d44` (item+versão), revogado após a attempt (0 vigentes).
- Attempt `b557509b-3aa1-42c9-9453-7c9974b4f2e2` 04:43:08Z→04:49:50Z (eventos 86671–86680): checkpoint 86674, result_submitted 86675, evidências 86676–86678, **Verifier 86679 `verified` (17 checagens: 12 attested, 5 independent, 0 lacunas, 0 violações; md5 `95d1909f197beeb79afc5b2af6de0808`)**, claim liberada 86680. Checkpoint `8b5455d3d11b839ae331c8b289ae7304bbed6c8b` (1 commit sobre a base, 0 merges, 3 arquivos +245/−20, 100% CRLF, `diff --check` limpo).
- Revisão independente (worktree temporária removida): Core 10 suítes/284 testes PASS; EvolutionClient 37 PASS; `tsc` core e web 0 erros. Comparação programática base×candidato: 67 capacidades, nenhum campo estático alterado (maturity, dependsOn, name, description, meaning), distribuição 15/21/14/14/3 idêntica, só history/proofRefs/frontier mudam nas 7 capacidades previstas. Mutação: testes novos contra o registry da base falham (8). Todos os commits e arquivos citados existem na base.
- Limites: refs a planos 056-067 e registros 2026-10-14 foram vetadas (untracked). Nenhuma maturity promovida. `verified` é advisory.
- Não realizado: accept, integração, push, migrations, limpeza de WIPs.

## Aceite, integração e publicação (2026-10-14, mandato posterior)

- Aceite: `work accept` ⇒ `result_accepted` 86681 (resultado `dc688366-0a50-4604-aeb5-f3d6e73396fa`), item `completed` v1; parecer 86679 inalterado (md5 `95d1909f…`).
- Integração em clone dedicado `anima-recovery/anima-integration-4c681ba5` (sem hardlinks, push desabilitado, HEAD destacado na base): 22/22 guards; `integration_effect_authorized` 86682 (auth `4c681ba5-c0de-4e00-8f21-4c681ffee001`) e `integration_completed` 86683; receipt `ff_only`, `effected`, `previousTargetSha` af9c5577 → `resultingTargetSha` 8b5455d3, `mergeCommitSha` null.
- Sync do checkout principal: `merge --ff-only` de `refs/anima/integrated/4c681ba5`; status Git idêntico antes/depois; índice vazio.
- Publicação: `git push origin dev` normal (af9c557..8b5455d); `origin/main` = 99bec54e intacta.
- Claims/leases vigentes: 0/0. Migrations: 156. Ssem nova attempt, lease ou migration.
