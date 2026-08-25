# Preparação de classificação estrutural

- **Data/tipo:** 2026-08-25 — investigação, desenvolvimento e prova local.
- **Objetivo:** reconciliar o primeiro clique em “Preparar elegibilidade autônoma” do ServedRead v3 e corrigir a falha sem repetir a mutação real.
- **Branch / HEAD inicial:** `dev` / `f025ce9`, igual a `origin/dev`; `main` e `origin/main` em `99bec54`, intocados.
- **Efeito do clique original:** nenhum. Item `0898a0c2…` permaneceu `approved` v3 e com `updated_at` do `manual_work_released`; nenhuma classificação, decisão de routing, request, execution, claim, attempt ou terminal foi criada.
- **HTTP reconstruído pelo código real:** `POST /api/work-orchestration/prepare-autonomous`, body `{workItemId, expectedProposalVersion:3}`; resposta `409 {ok:false,error:{code:"classification_policy_not_applicable"}}`. A ausência de `error.message` causou o fallback genérico do card.
- **Causa raiz:** o helper exigia `impact_level='low'`, mas o item persistido é `structural`. Os demais checks passam: approved v3, programming, planner conhecido, target project:anima, permissões isoladas, três validações e limites 3/30. O payload INTEL-01 validou estruturalmente; a RPC não exige work_started, routing, claim ou attempt.
- **Correção:** mantém a ponte fechada e passa a admitir `low|structural` somente depois de aprovação vigente. `low` conserva `bounded/low/reversible/clear/normal`; `structural` recebe `bounded/moderate/conditionally_reversible/clear/normal`, padrão conservador já usado na prova ratificada. Erros HTTP carregam mensagem/Postgres code. Falha de escrita é seguida por releitura: fato corrente válido retorna replay; ausência preserva o erro original.
- **Invariantes:** nenhuma autoaprovação estrutural; nenhuma mudança de schema/RPC; nenhum claim, attempt, execution_started, execution request, coder, worktree, provider, resultado ou integração no helper. O item real não foi chamado novamente durante implementação/testes.
- **Provas/gates:** 59 testes web focados e 1.167 testes core passaram; typechecks de web, core e supabase passaram; `git diff --check` passou. A suíte do card preserva avisos preexistentes de `act(...)`, sem falhas.
- **Commit funcional:** `e678f07` (`Reconcilie a preparação da classificação estrutural`).
- **Próximo ponto:** após commit/push, Gean atualiza a UI e clica uma vez em “Preparar elegibilidade autônoma”. Se nenhum estado concorrente mudou, readiness esperada após reload: `eligible=true`; só então o card oferece os botões autônomos. Não clicar em execução ainda.
