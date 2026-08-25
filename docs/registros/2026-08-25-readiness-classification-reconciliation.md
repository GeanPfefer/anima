# Readiness: reconciliação da classificação autônoma

- **Data/tipo:** 2026-08-25 — desenvolvimento + prova read-only.
- **Objetivo:** explicar por que ServedRead Provenance V1 v3 não aparecia como elegível após `manual_work_released` e corrigir o impasse sem contornar gates.
- **Branch / HEAD inicial:** `dev` / `c97c642`; `origin/dev` igual. `main` e `origin/main` em `99bec54`, intocados.
- **Prova real:** item `0898a0c2-80ec-4b4d-a7a3-9fd5239268f9` está `approved`, v3; AUTO-01=true; aprovação vigente=true; dependências satisfeitas=true; zero claims; zero eventos de attempt/terminal; fila vazia para o item. A guarda exclusiva que falhou foi `private.autonomous_intelligence_eligibility`, com `eligible=false`, `reason=work_intelligence_classification_missing` e nenhum evento `work_intelligence_classified`.
- **Causa raiz:** o retorno `resident_host_required` passou a preceder o bridge de classificação no antigo POST explícito do Supervisor. O card, por sua vez, só oferecia o sinal autônomo a itens já presentes na fila que exige essa classificação.
- **Mudança:** readiness read-only distingue classificação ausente/incompleta; o card explica o motivo e oferece preparação explícita; a preparação autenticada aplica o mesmo envelope estreito do bridge (`approved`, low/programming, planner conhecido, project:anima, worktree permissions, 3/30) e registra somente a classificação append-only.
- **Gates:** 53 testes web direcionados passaram; typecheck web passou; `git diff --check` passou. Warnings preexistentes de `act(...)` continuaram não-fatais.
- **Segurança:** nenhum gate afrouxado; `.worktrees/` e `.claude/settings.local.json` preservados; nenhuma alteração SQL, service role, claim, attempt, pedido autônomo, coder, worktree, resultado, merge, deploy ou aprovação humana foi produzida.
- **Fronteira humana:** a sessão de navegador disponível pertencia a outra conta; o item real não foi mutado. O usuário correto deve clicar “Preparar elegibilidade autônoma”; somente após a releitura autoritativa o botão “Executar autonomamente” poderá aparecer. Não clicar nele até decidir iniciar o coder.
