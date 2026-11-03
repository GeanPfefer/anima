# Recuperação bootstrap V1 — compatibilidade 247

Data: 2026-10-08. Tipo: desenvolvimento/prova determinística offline.
Objetivo: compatibilizar 246/247, preservar segurança e preparar rebuild revisável.
Branch `dev`; HEAD inicial/final `6bc4aadef9414d655600c2ea37c6be436b3628c8`.
Commits: nenhum. Sem staging/push/reset/clean/prune; worktrees e WIPs preservados.

## Mudanças e decisões

- [247](../../supabase/migrations/20260905000001_fix_budget_resume_request_correlation.sql):
  hashes integrais + atributos conhecidos, correção antiga/no-op corrigido/recusa
  terceira forma, pós-condição transacional. 246 byte-idêntica, hash registrado
  no [procedimento](../../supabase/tests/bootstrap_reconstruction.md).
- [Testes](../../supabase/tests/bootstrap_compatibility_test.py): 12 provas offline
  de texto/contrato, mutações adversariais, composição e reconciliação.
- [Compositor offline](../../supabase/tests/bootstrap_plan.py),
  [ledger proposto](../../supabase/tests/bootstrap_ledger.sql) e procedimento;
  não foi conectado nenhum executor SQL/Docker.
- [Inventário histórico](2026-10-08-bootstrap-247-inventory.json): 272 etapas,
  hashes/ordem/roles; 200 fontes disponíveis, 72 ausentes (69 Auth + 3 prerequisites).
  Somente fonte 247 mudou em relação ao manifest. Estado applied/failed-stop é
  histórico, não confirmação de estado SQL nesta sessão.
- PRD/plano 043 receberam adendos, sem substituir histórico.
- [Diff exato de código](2026-10-08-bootstrap-247-code.diff) compara migration
  com seus bytes ao início desta sessão e inclui testes/compositor/ledger novos.
  Não mistura WIPs anteriores nem alterações de EOL do restante do repositório.

Bug corrigido: 247 falhava porque 246 já continha a correlação corrigida.
Bugs/risco encontrados: 248 reinsere guarda de bloqueio atual; recompile de
paid reserve já tem regressão histórica restaurada por 20260927000001.
Ver análise detalhada no procedimento; nenhuma política de orçamento foi editada.

Executor temporário não foi localizado; revisão limitada aos artefatos históricos.
Erro 095.stderr preservado: 42601 perto de INSERT anexado sem terminador;
manifest/audit apontam ledger fora de transação nas etapas Anima. Não foi feita
nova consulta SQL. Não inferir atomicidade apenas do manifest `applied`.

## Provas/gates

- `python3 -m unittest discover -s supabase/tests -p bootstrap_compatibility_test.py -v`:
  **12/12 PASS**, incluindo antiga → corrected (1 alteração), corrected → no-op
  (0 alterações/replay), unknown → recusa; scanner nas 154 migrations locais PASS.
- `python3 -m unittest discover -s supabase/tests -p single_item_concurrency_test.py -v`:
  **25/25 PASS**, testes offline existentes; subprocesses fake/locais apenas.
- AST Python dos dois novos arquivos PASS; diff check focal PASS.
- Typecheck TypeScript/build não pertinentes: nenhum TS, tipo ou application code
  alterado; execução autorizada somente determinística/estática. Sem instalação.
- Uma falha inicial de teste: mutação de `a.user_id` não mudava a forma antiga,
  produzindo indevidamente o corpo conhecido. Corrigido para mutação comum efetiva;
  nenhuma mudança de regra para tornar o teste verde. Nenhum flake observado.

Limite da prova: modelo textual em Python e assertivas estáticas de SQL, **não**
execução PL/pgSQL/catalog ou equivalência operacional. Prova real de hashes, atributos,
ACL/RLS/atomicidade/concorrência/STABLE/deadlocks e types permanece pendente.
O compositor é conservador: etapa imagem 6 exige revisão de backslash quoting;
corpus completo não foi materializado. Ledger SQL somente proposto, nunca criado.

## Estado Git e invariantes

Status inicial continha 13.876 entradas `porcelain -uall` (inclui arquivos de WIP
não rastreados). Final: 13.884 entradas; nenhuma entrada anterior removida ou com
status alterado. Novo dirty status da 247 e sete arquivos novos desta sessão;
PRD/plano já estavam modificados e só receberam os adendos descritos acima.
Caches Python criados por estes testes foram removidos por nome exato, após
confirmar ausência no status inicial; nenhum cache/WIP anterior foi removido.
Snapshot integral do status inicial/final disponível temporariamente em
`/tmp/anima-bootstrap-247-baseline`; resumo e fronteiras recuperáveis aqui.

Sem operação Docker, SQL, migration aplicada, banco consultado/alterado, pgTAP,
fixtures ou concorrência real. `supabase_db_anima` intocável; container histórico
750bde88... não reutilizado/iniciado/removido. Nenhuma coleta live de container.
Sem Resident Host, INV-11, provider/RunPod/compute pago/API ou efeito externo.
`single_item_atomic_claim_unavailable` incondicional, sem bypass. Owner/requestId/
work_item_id/proposta/authority e regras de orçamento preservados.

## Próxima retomada exata

**BLOCKED_BY_HUMAN_DECISION** para qualquer Docker/SQL: revisar o diff e procedimento.
Antes de aprovar novo rebuild, recuperar fontes ausentes/hash/proveniência de Auth,
revisar etapa imagem 6 e resolver compatibilidade/duplicação 248 em fatia própria.
Depois, congelar plano completo/roles/prerequisites e autorizar NOVA instância
isolada; nunca carregar `applied` do histórico como ledger atual. Parar ao primeiro
erro e reconciliar fatos do novo ledger, sem retry automático. Fixtures/pgTAP/
concorrência/liberação do gate/INV-11 são fronteiras humanas posteriores separadas.
