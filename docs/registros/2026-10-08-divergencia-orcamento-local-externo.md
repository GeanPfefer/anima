# Divergência preexistente de orçamento local/externo — 08/10/2026

Diagnóstico por leitura de migrations, sem consultar ou alterar qualquer banco.
Branch `dev`, HEAD `6bc4aadef9414d655600c2ea37c6be436b3628c8`.
Registro separado do hardening Single-Item; não propõe correção nesta tarefa.

A migration `20260821000002_local_vs_external_work_budget.sql` introduz a decisão
V2 que diferencia `costClass` local/externo e conserva contadores distintos. A
migration posterior `20260905000000_budget_blocked_human_resume.sql` substitui
`private.autonomous_work_budget_decision` por uma decisão V1 com concessão humana:
usa `userAttempts24Hours >= 6` e `userRuntimeSeconds24Hours >= 7200` totais, além
do limite por item e da reserva interativa. Não usa os contadores externos para
esses tetos. `20260905000004_human_supervised_work.sql` renomeia essa decisão para
`unattended_work_budget_decision` e a envolve com política
`autonomous-work-budget-v1-supervision`; não restaura a separação V2.

Isso é uma divergência entre contratos versionados do orçamento; não é causada
pela RPC scoped proposta, que delega ao início e aos triggers existentes.
Nenhuma dessas migrations históricas foi editada. Não se inferiu qual schema está
aplicado no residente. Os testes de orçamento local/externo podem revelar essa
divergência ao aplicar a sequência completa num banco independente; qualquer
falha deve ser registrada separadamente, sem desabilitar triggers ou mudar quotas
para liberar o Single-Item.

O cenário concorrente `budget` foi estreitado para a política V1-supervision sem
lease de supervisão nem concessão pendente, cinco starts históricos sintéticos e
uma admissão restante. Ambos os lados precisam passar isoladamente com ROLLBACK;
a prova futura deve observar o lock por usuário, depois recusa específica
`user_attempt_budget_exhausted` para B. Testes locais e leitura do SQL não provam
visibilidade após a espera nem enforcement real. Uma eventual revisão de política
exige outro escopo e autorização humana.
