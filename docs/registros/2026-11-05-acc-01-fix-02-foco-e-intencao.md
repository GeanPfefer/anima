# ACC-01-FIX-02: recuperação pontual do foco e correção de intenção — 2026-11-05

Append-only. Tipo: **correção** (uma operação pontual autorizada no banco residente + código + migration NÃO aplicada). Formato de [`README.md`](README.md). Antecede: diagnóstico ACC-01-FIX-01 (sem arquivo).

## Incidente

Durante o teste do ACC-01-E1, "qual trabalho está em foco" casou `isWorkContinuation` (palavra solta "trabalho"). Sem foco e com vários candidatos, a rota emitiu `focus_confirmation_required` e a UI abriu `WorkFocusChoice`. O clique acidental fez duas escritas: `set_work_focus` (item `fad07a1f-c03b-4211-a42c-c353a1572694`, `Durability D1 (sucessor)`) e `attachContext` (`work_contexts` `7a6bb28b-155d-4faf-b9da-76d64e24c343`, evento `context_attached` seq 86943). O item não mudou (proposed, versão 1, `updated_at` 2026-10-14).

## Recuperação pontual (exceção autorizada, única escrita no residente)

Pré-condições conferidas: usuário `e570e43b-0263-43a1-b8e9-63b4eb2b5ba4`, item acima, `updated_at` do foco = `2026-11-05 19:47:41.61473+00` (instante do clique, sem atualização posterior). Em uma transação: `DELETE FROM public.work_focus` com igualdade exata de `user_id`, `work_item_id` e `updated_at`; exigência de exatamente 1 linha; e verificação de que contagens de `work_items`, `work_events`, `work_contexts` e o hash do conteúdo de `work_items` ficaram idênticos (foco −1). Resultado: COMMIT; foco do usuário 0 linhas; evento 86943 e contexto `7a6bb28b…` preservados; item inalterado; as outras 2 linhas de foco (outros usuários) intactas. Não é substituto da operação canônica (abaixo).

## Código

- `@anima/core`: `classifyWorkFocusIntent` (focus_query, focus_set, focus_clear, none) e `isWorkContinuation` estrito: exige verbo de continuação/ajuste, não é pergunta e não é intenção de foco. Palavras isoladas ("trabalho", "tarefa", "proposta", "resultado", "isso", "nesse") deixaram de bastar.
- Chat (`route.ts` + `lib/ai/work-focus-chat.ts`): intenções de foco têm resposta determinística, antes de detectores, seletor e provider. Consulta é só leitura (sem seletor, sem anexar contexto). Definir foco exige comando explícito com referência inequívoca, só no Chat Dev, e chama apenas `set_work_focus`. Limpar só no Chat Dev e só com a RPC habilitada.
- `WorkFocusChoice`: texto do efeito explícito ("define o foco e anexa esta mensagem; nenhum estado muda"), botões "Definir como foco e anexar: …" e "Cancelar" (sem requisição). O seletor só nasce de continuação explícita.
- `lib/work-orchestration/work-focus.ts` e `DELETE /api/work-orchestration/focus`: serviço mínimo de limpeza, desligado por padrão (`ANIMA_CLEAR_WORK_FOCUS_ENABLED=1` exigido; 501 sem a flag; nenhuma chamada à RPC).

## Migration preparada, NÃO aplicada ao residente

`supabase/migrations/20261105000000_clear_work_focus.sql`: `public.clear_work_focus()` aditiva, SECURITY DEFINER, `search_path=pg_catalog`, autenticação e allowlist exigidas, apaga só a linha do próprio `auth.uid()`, devolve boolean (idempotente), EXECUTE só para `authenticated`. Não altera `set_work_focus`, RLS nem grants da tabela. Teste pgTAP `supabase/tests/clear_work_focus.test.sql` (15 asserções: privilégios, isolamento entre usuários, idempotência, recusas sem auth/allowlist, ledger e `work_items` inalterados) passou 15/15 em um banco descartável (`fix02_scratch`, criado no mesmo servidor a partir de dump apenas de schema do residente, depois removido). `database.ts` não foi regenerado (o tipo da RPC não existe até a aplicação).

## Provas

Core: 132 suítes / 3307 testes; `tsc` core e web limpos; web chat+`lib/ai`: 38 suítes / 503 testes (um flake conhecido de `project-tools.test`, passa isolado); mobile `mobile-work.test` 7/7. Novos testes: `work-focus-intent.test`, `work-focus-chat.test` (leitura sem escrita, set só via `set_work_focus` sem contexto, ambíguo/inexistente/sem referência, pessoal não muta, limpeza com/sem flag, fronteira da rota por fonte), `WorkFocusChoice.test` (Cancelar não grava).

## Próximo ponto de retomada

Aplicar a migration ao residente por procedimento seletivo e transacional com mandato próprio, regenerar tipos e ligar `ANIMA_CLEAR_WORK_FOCUS_ENABLED=1`; só então a limpeza de foco fica disponível ao usuário.
