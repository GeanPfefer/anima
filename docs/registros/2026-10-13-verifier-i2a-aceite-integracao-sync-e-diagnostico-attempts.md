# 2026-10-13 — Verifier I2a: aceite, integração governada, sincronização local e diagnóstico do limite de attempts

Continua [a attempt](2026-10-13-verifier-i2a-attempt-8013c5e2.md). Sem push, nova attempt, mudança de política, migration, código adicional, limpeza de evidências, force-push, Host contínuo ou API paga. Nenhum contador/lease/política alterado.

## Aceite
Pré: item `review` v1; resultado `bac45f16-867a-4324-ad90-42171430b60c` ↔ attempt `9351a91d-f688-40f6-8b3c-4bcac627075d` ↔ commit `828f2d18…` (filho único de `3c7aab87`, 0 merges); 5 arquivos core; Verifier 86480 `work-verifier-v4` `verified` (md5 `2dd4355b…`); 0 integrações; 0 claims. `work accept` (uma vez) ⇒ `result_accepted` **86482**, item **completed** v1; parecer 86480 preservado (md5 idêntico). Ressalvas da revisão (duplicate_test 2%, EOL misto) mantidas registradas.

## Integração governada
Clone `C:\Users\GeanTeco\anima-recovery\anima-integration-8013c5e2` (`--no-hardlinks`, origin canônico, `pushurl=DISABLED-no-push-allowed`, HEAD destacado em `3c7aab87`, dev fora de checkout, candidato em `refs/anima/candidate/8013c5e2`). Inspeção 22/22 guards. Execução única: `integration_effect_authorized` **86483** (auth `8013c5e2-c0de-4e00-8f21-8013c0ffee01`) → `executeAuthorizedIntegrationWithSupabase` → Trusted System Writer → `integration_completed` **86484** (22:56:20Z). Receipt: `ff_only`, `effected`, `observed true`, `previousTargetSha 3c7aab87…`, `resultingTargetSha 828f2d18…`, `mergeCommitSha null`, `mergeParents []`.

## Sincronização local
Preflight: HEAD `3c7aab87` em `dev`, índice vazio, status idêntico, 0 sobreposição com WIP/untracked, sem node. `git fetch <clone> refs/heads/dev:refs/anima/integrated/8013c5e2` (SHA conferido) + `git merge --ff-only` ⇒ `dev` = **`828f2d180100e9c13d2b15003a71353dfc330d2b`**; 5 arquivos (+802/−301 bruto; real: +13/−0 em host-observed-gate-evidence por EOL), 0 merges, `git diff --check` limpo. Sem reset/clean/stash.

## Verificações (principal)
Core jest 120 suítes/2740 PASS; core `tsc` limpo; web `tsc` 0 erros fora de `scripts/_session`; import nativo de `deriveGateTestReport`/`parseGateTestReport`/`sha256Hex` OK (limit maxTests 2000; `VERIFIER_VERSION=work-verifier-v4`). Replay (157 itens, 50 pareceres): 0 deriva; `d795e414` rejected; `8013c5e2` verified. Banco: ledger 156, max seq 86484, 0 claims válidas; parecer 86480 intacto.
Remotos/Git: dev local 1 commit à frente de origin/dev (`3c7aab87`, não publicado); origin/main `99bec54e` inalterada; status Git/WIPs idêntico; 46 worktrees.

## Diagnóstico do limite 6/24 h (read-only) — ver [plano 059](../planos/059-execucao-supervisionada-sem-teto-global-de-attempts.md)
Origem: regra do ANIMA em SQL (`private.unattended_work_budget_decision`, constantes fixas 3/item, 6/usuário, 7200 s/24 h, 2700 s/60 min), contando `execution_started` com claim em janela móvel de 24 h (liberação do mais antigo em `2026-10-14T03:28:50Z`). Achados: regressão (v1 de `20260905000000` sobrescreveu a v2 consciente de custo); `codex-cli` seria "externo" mesmo na v2; supervisão humana JÁ existe (`work_supervision_leases`, `grant_work_supervision`, CLI `work supervise`, 49 leases históricos) e supera todos os motivos do budget, mas: autenticada só por `auth.uid()` do dono (mesmo usuário da automação), sem evento no ledger, não consumível por attempt (várias attempts dentro do TTL). Proposta E0/E1/E2 no plano 059.
