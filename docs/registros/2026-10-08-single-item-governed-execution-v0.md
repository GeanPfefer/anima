# Sessão — Single-Item Governed Execution V0

- Data/tipo: 2026-10-08, desenvolvimento supervisionado local.
- Objetivo: execução por UUID/versão sem efeitos no backlog alheio.
- Branch: dev. HEAD inicial/final: `6bc4aadef9414d655600c2ea37c6be436b3628c8`.
- Commits: nenhum. Sem staging, push ou integração.
- Mudanças: CLI execute-one, mandato puro no core, leitura por UUID, uma volta,
  omissão de manutenção/classificação globais, checks de versão/estado e barreira
  anterior a eventos/compute/claims/attempts.
- Decisão: início comandado não substitui claim; não possui enforcement atômico
  de orçamento sob claim. Recusar antes de mutação enquanto faltar primitiva SQL.
- Bugs encontrados por inspeção de SQL versionado: requestedWorkItemId não impede
  reconciliação global; acquire_work_claim libera claim alheio vencido; trigger
  de orçamento só aplica a execution_started com claim_id.
- Correção local: recusas single-item; fluxo global/programação preservados.
- Provas: 12 suítes Jest determinísticas, 298 testes PASS; isolamento, versões,
  ausência de fallback, cloud/event writes e regressões globais/CLI.
- Typecheck: core/supabase PASS; web sem scripts/_session PASS. Web completo
  falha em scripts scratch preexistentes, preservados. Build não executado:
  backend/CLI sem UI, validação por testes e tsc.
- Falhas durante desenvolvimento: fixture sem excludedScope concreto, acesso
  strict a array e expectativas de testes corrigidos. Final verde, sem flake novo.
- Segurança/efeitos: sem banco, login residente, RPC viva, attempt, aprovação,
  Resident Host real, migration, provider, RunPod ou API paga nesta sessão.
- INV-09/INV-10/INV-11 intactas; estado conhecido, sem nova observação residente.
- WIPs anteriores preservados: PRD/plano 008, untracked e worktrees. PRD recebeu
  apenas adendo desta sessão; nenhum item histórico editado.
- Fronteira humana: autorizar migration/provas SQL de claim scoped com orçamento
  atômico; depois prova viva separada. Objetivo operacional NÃO concluído.
- Retomada: [Plano 043](../planos/043-single-item-governed-execution-v0.md) e
  [contrato/procedimento](../arquitetura/single-item-governed-execution-v0.md).
  execute-one recusa single_item_atomic_claim_unavailable, sem flag de bypass.
