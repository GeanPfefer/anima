# 2026-10-13 — Integração governada de `d795e414`: parada por lacuna (`target_checked_out`)

Tipo: descoberta e preflight (somente leitura). HEAD a4f46f8 inicial e final; **nada integrado**; sem autorização/efeito de integração,
push, código, migration ou nova attempt. Sequência do [aceite humano](2026-10-13-single-item-aceite-humano-d795e414.md).

## Mecanismo oficial (ADR-002 e plano 013)
`result_accepted` → `authorize_integration_effect` (evento `integration_effect_authorized`, user; congela repositório, alvo
`refs/heads/dev`, SHA esperado, commit do handoff, modo) → `executeAuthorizedIntegrationWithSupabase` (CAS `update-ref`) → Trusted System
Writer → `integration_completed`. Modo `ff_only` (migration 20261003000000, aplicada): alvo avança para o commit EXATO do resultado.
Não há comando de CLI (a fase F2 do plano 013 não existe); os precedentes SDC-20…23 usaram scripts de sessão com `ANIMA_INTEGRATION_REPO_ROOT`
em um **clone dedicado**, nunca em `G:\anima`, e publicaram depois. O Verifier não é pré-condição do mecanismo (completed + aceite +
repositório + alvo ancestral); logo `rejected` + aceite humano em lane advisory é admissível.

## Preflight (PASS)
HEAD == a4f46f8 em dev; candidato 1a18fc8 com 1 commit, 0 merges, pai == base; escopo exato de 3 arquivos; sem sobreposição com WIPs;
índice vazio; sem operação Git em curso; item `completed`, `result_accepted` seq 86395, Verifier `rejected` seq 86393 preservado; 0 eventos
de integração; configuração `ANIMA_INTEGRATION_*` presente (remote `origin`, repositório confere), System Writer disponível; origin/dev
5391073 e origin/main 99bec54 intocados.

## Lacuna (bloqueio)
`GitIntegrationEffectProvider.targetCheckedOut()` = **true**: `refs/heads/dev` está em checkout no worktree principal `G:\anima`. O executor
(`integration-effect.ts:244`) devolve `human_required: target_checked_out` nos dois modos; o **Modo W** (ff dentro do checkout, com preflights)
está reservado à F2 e não existe. Tentar autorizar+executar só persistiria uma autorização sem efeito. Além disso, `ff_only` move o alvo para o
commit EXATO do resultado, então **não suporta ajustar a mensagem** do commit (qualquer amend criaria outro commit e quebraria a correlação
handoff/receipt). Nada foi feito.

## Caminhos (decisão humana)
A) Clone dedicado (precedente SDC-20…23): clone local com `dev` fora de checkout, remote `origin` apontando ao repositório, fetch da branch do
candidato, `ANIMA_INTEGRATION_REPO_ROOT` do processo; autorizar+executar ff_only; depois publicar do clone (push) ou sincronizar o `dev` de
`G:\anima` (operação Git manual).
D) Local direto: com a sessão sem outros escritores em `dev`, `git switch --detach` no checkout principal (mesmo commit, árvore intacta), executar
o fluxo governado em `G:\anima`, e `git switch dev` de volta (aplica o diff dos 3 arquivos, sem sobreposição com WIP).
B) Implementar o Modo W (código + testes; fase F2 do plano 013).
Mensagem em português imperativo: só via modo `merge_no_ff` (merge commit "Integre … (attempt …)" preservando o commit candidato como pai) ou
ajuste fora do primitivo; nunca por reescrita no ff_only.
