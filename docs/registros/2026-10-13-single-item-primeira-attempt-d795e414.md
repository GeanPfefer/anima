# 2026-10-13 — Primeira attempt real do Single-Item V1 (`d795e414`)

Tipo: prova viva governada. Branch dev, HEAD a4f46f8 inicial e final; sem commit, push, migration, Host contínuo, recovery,
claim manual ou API paga. Autorização humana: uma attempt, item `d795e414-d603-4153-883e-124fea9ac732` v1.

## Preflight imediato (03:28:25Z) — todos PASS
HEAD == base `a4f46f87…`; 3 arquivos limpos e idênticos à base; item `approved` v1, classificação rev 1, 0 attempts, último evento 86381;
ledger 156 e `verify_after` PASS (RPC scoped); 0 claims válidas, 0 transações, nenhum `in_progress` do usuário; REST/Auth 200;
sem `node`/`codex`; RAM 6,5 GB, disco ok; `select_autonomous_work` seleciona `d795e414 v1`; orçamento admitido (0/1).

## Execução (única)
`cd G:\anima\apps\web` com `ANIMA_CODEX_CLI_TRANSPORT=wsl`, `ANIMA_CODEX_WSL_DISTRO=Ubuntu-24.04`, `ANIMA_CODEX_WSL_USER=geanteco`,
`ANIMA_CODEX_WSL_CLI_PATH=/home/geanteco/.nvm/versions/node/v22.23.3/bin/codex` só no processo, `npm.cmd run anima -- work execute-one
d795e414-d603-4153-883e-124fea9ac732 --version 1 --json` (background, uma vez). Início 03:28:39Z, fim 03:30:36Z (1 min 57 s), exit 0.

Cronologia (UTC, ledger): 03:28:50.5 `work_routing_adjusted` 86383, `work_routing_decided` 86384, `work_claimed` 86385 (claim 5b537359,
lease 35 min), `work_started` 86386, `execution_started` 86387 (attempt **2893a772-6112-4d12-8aef-60d36d94a308**); 03:30:23
`checkpoint_recorded` 86388; 03:30:35.98 `result_submitted` 86389; 03:30:36.1 evidências do host 86390–86392 (gate, coder, git);
`verifier_opinion_recorded` 86393; `work_claim_released` 86394 (`attempt_finished`, 03:30:36.35). O gate passou na pilha real (autenticada).

Executor `worktree-v1` / `codex-cli:default` via `wsl.exe` (Ubuntu-24.04, login ChatGPT): exit 0 em 91,1 s. Gate do host
(`npm.cmd test … project-work-planner-selectable.test.ts`): exit 0 em 12,0 s. Mudanças só na worktree isolada, commit de checkpoint
`1a18fc8e95bb3327252bb0861e701081ddd693cd` na branch `anima-work/2893a772-6112-4d12-8aef-60d36d94a308` (+86/−2, exatamente os 3
arquivos autorizados). O working tree principal não mudou (status idêntico, 3 arquivos com os mesmos hashes); worktree descartada
(46 worktrees); nenhum `codex` órfão na distro.

## Resultado: Verifier `rejected` ⇒ volta `execution_interrupted` / `single_item_verification_failed`
Parecer `work-verifier-v3`: 12 checagens, 9 independentes, 3 lacunas, 1 violação. Lacunas `acceptance_substantive_gate_insufficient`
(os 3 aceites do `expected_effects`, cobertos só por gate com afirmação substantiva) e violação `criterion_covers_unknown_acceptance`
(o `covers` do critério de escopo — "Somente os três arquivos aprovados foram alterados." — não pertence ao aceite aprovado).
OK: correlação, escopo independentemente observado e respeitado, gates observados, branch. Item em `review` v1 (revisão humana
pendente); claim liberada; sem integração, aceite ou retry. Em `work-verification.ts`: gate verde + afirmação substantiva só
produz associação declarada; apenas `gate_assertion` (gate host-observado que passou) ou escopo observado provam.

## Diagnóstico
O defeito está no **desenho do contrato do sucessor**, não no executor nem no código: os aceites foram redigidos como
comportamentos substantivos, que o Verifier v3 não consegue provar só por gate; e o critério de escopo cobre um texto fora do
aceite. O código produzido atende ao objetivo: `resolveLocalProjectPlannerModel` (puro, preserva precedência e valores vazios),
usado pelo construtor e por `diagnoseConfiguredProjectPlanner` (somente provider e modelo, sem I/O nem segredos), com testes de
precedência, default, explícito e ausência de segredos. Mesmo contrato teria produzido o mesmo parecer em `b5f8178a`.

## Orçamento e custo
Item: 1/1 tentativa usada (`item_attempt_budget_exhausted`); runtime 105 s (limite 7200 s/24 h). Sem eventos de compute/provider/custo;
Codex por assinatura ChatGPT, nenhuma API paga. RAM Windows 6,5 → 6,6 GB livres; `vmmem` ~2,8 GB; sem pico crítico observado.

## Próximas decisões humanas
(a) Revisar a branch e decidir `accept` / `request-changes` / descartar o resultado em `review` (o Verifier não o aprovou).
(b) Se quiser um `verified`, redesenhar o contrato em item novo: aceites = afirmações de gate (`claim_kind: gate_assertion`) e de
escopo com `covers` idêntico a um aceite aprovado; comportamentos substantivos ficam no objetivo e na revisão humana.
Evidências: `C:\Users\GeanTeco\anima-recovery\attempt-d795e414-*\`.
