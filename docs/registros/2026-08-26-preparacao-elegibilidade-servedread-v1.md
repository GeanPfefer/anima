# Preparação real da elegibilidade do ServedRead V1

- **Data/tipo:** 2026-08-26 — prova viva + reconciliação read-only.
- **Objetivo:** provar autoritativamente que a preparação da elegibilidade autônoma registra somente a classificação da versão aprovada e não inicia execução.
- **Branch / HEAD inicial:** `dev` / `87a52c0`, igual a `origin/dev`; `origin/main` em `99bec54`, intocada.
- **Work item:** `26f3c07f-bc6d-42cb-9a03-57f6894883d7`, ServedRead Provenance V1, `programming/low`, proposta v1, escopo de escrita limitado a `ollama-protocol.ts` e `ollama-protocol.test.ts`.
- **Ato humano observado:** após aprovar v1, Gean clicou exatamente uma vez em “Preparar elegibilidade autônoma”; a UI passou a oferecer parecer de recursos e execução autônoma sem iniciar o trabalho.
- **Fonte autoritativa:** consulta administrativa read-only localizou o item/eventos; a fila foi consultada em transação `READ ONLY`, com `ROLE authenticated` e `request.jwt.claim.sub` igual ao owner do item. A ausência de credenciais do Resident Host e de sessão de navegador conectada impediu reutilizar um token Bearer real; nenhuma chave administrativa foi entregue ao host ou usada para mutação.
- **Evidência:** exatamente quatro eventos, em ordem: `work_proposed` seq 38928, `context_attached` 38929, `work_approved` 38930 e `work_intelligence_classified` 38931. A classificação v1 é `system_assessed`, `bounded/low/reversible/clear/normal`, policy `human-approved-project-planner-v1`.
- **Readiness:** `public.autonomous_work_queue()` devolveu o item para a versão aprovada 1 e target `anima`; portanto a elegibilidade autônoma autoritativa é verdadeira.
- **Invariantes:** item permaneceu `approved`; claims = 0; `execution_started` = 0; eventos com `authority=autonomous_execution_request` = 0. Nenhum coder, worktree, provider, gate, resultado, integração, PR, merge ou deploy foi acionado pela preparação.
- **Reconciliação histórica:** o item estrutural anterior `0898a0c2…`, citado no registro de 2026-08-25, avançou depois daquele snapshot e hoje está `failed` após uma tentativa real. Ele não é este novo item e sua história não foi alterada nesta prova.
- **Próximo ponto:** o novo ServedRead está canonicamente elegível. Avaliar recursos e, se admitido, persistir um pedido autônomo separado; deixar o Resident Host executar em worktree isolada até o terminal, sem ampliar o escopo.

