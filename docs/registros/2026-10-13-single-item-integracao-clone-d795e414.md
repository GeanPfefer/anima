# 2026-10-13 — Integração governada de `d795e414` em clone dedicado

Tipo: governança + efeito Git local em clone. `G:\anima` NÃO foi modificado (HEAD/dev a4f46f8, índice e WIPs intactos); sem push, sem main, sem
código, migration, nova attempt ou limpeza de claims. Sequência da [lacuna](2026-10-13-single-item-integracao-lacuna-target-checked-out.md)
e do [aceite](2026-10-13-single-item-aceite-humano-d795e414.md).

## Clone e preflight
Clone `C:\Users\GeanTeco\anima-recovery\anima-integration-d795e414` (cópia de `G:\anima`, `--no-hardlinks`; `origin` com a URL canônica; push
desabilitado com `pushurl=DISABLED-no-push-allowed`; HEAD destacado em a4f46f8, `refs/heads/dev` fora de checkout; candidato em
`refs/anima/candidate/d795e414` por fetch). Inspeção do wrapper de sessão (padrão SDC-20…23): 22 guards PASS — repositório confere, item
`completed` v1, aceite 86395 e resultado/attempt/commit exatos, Verifier `rejected` preservado, lane advisory, 0 integrações, alvo == a4f46f8,
candidato descendente direto (1 commit, 0 merges), escopo exato de 3 arquivos, alvo fora de checkout, clone limpo, System Writer disponível.

## Execução (única, 2026-10-13T04:55:48Z)
`authorizeIntegrationEffect` (modo `ff_only`, authorization `d795e414-c0de-4e00-8f21-d795c0ffee01`) → `executeAuthorizedIntegrationWithSupabase`
→ Trusted System Writer. Eventos: `integration_effect_authorized` **seq 86396** (user) e `integration_completed` **seq 86397** (system).
Receipt: `mode ff_only`, `disposition effected`, `observed true`, `previousTargetSha a4f46f8`, `resultingTargetSha 1a18fc8e…`,
`mergeCommitSha null`, `mergeParents []`, correlacionado à attempt `2893a772-6112-4d12-8aef-60d36d94a308`, ao resultado aceito
`7042eb0f-9ffb-4a9f-b871-daf6ae6e3ea1` e ao repositório `https://github.com/GeanPfefer/anima`. Commit e mensagem do checkpoint NÃO foram alterados
(`anima(checkpoint): Centralizar a resolução do modelo local…` fica como está em ff_only).

## Estado
Clone: `refs/heads/dev` = 1a18fc8 (= base + 1 commit, 0 merges, só os 3 arquivos); reflog "anima integration …"; HEAD ainda a4f46f8; árvore limpa.
`G:\anima`: HEAD/dev a4f46f8, origin/dev 5391073, origin/main 99bec54 (refs locais inalteradas), índice vazio, WIPs de setembro idênticos, 46 worktrees.
Ledger/DB: Verifier 86393 `rejected` com o mesmo hash; item `completed` v1; 0 claims; ledger 156; max seq 86397. A justificativa humana do aceite
permanece em `2026-10-13-single-item-aceite-humano-d795e414.md`.

## Observação de honestidade de estado
O recibo registra o avanço de `dev` no CLONE. Até a sincronização do checkout principal e a publicação, `G:\anima/dev` e `origin/dev` NÃO contêm o
commit. Ver o procedimento recomendado de sincronização na entrega da sessão (fetch do clone para ref não-checked-out, verificação do SHA e `merge --ff-only`
no checkout humano, sem sobreposição com os WIPs; publicação separada). O clone deve ser mantido até a sincronização.
