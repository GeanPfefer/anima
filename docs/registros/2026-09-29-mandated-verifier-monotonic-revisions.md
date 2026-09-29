# Mandated Verifier monotônico entre revisões de proposal

**Data:** 2026-09-29
**Tipo:** correção de governança (desenvolvimento + prova isolada)
**Branch:** `dev` · **HEAD inicial:** `5deca15` (`origin/main=99bec54`)

## Causa

Ao preparar a revisão v2 do item da primeira prova trusted (`25c2c047`, TPC-01), a
investigação mostrou que `planExecutableProjectWorkRevision` chama `planExecutableProjectWork`,
que reconstrói `intent.execution_spec` do zero. Só o materializer canônico grava
`verifier_requirement`; o spec revisado saía sem a chave e as RPCs
`request_work_proposal_revision`/`revise_work_proposal` substituem o intent inteiro. Resultado:
um lane mandatado (`required_fail_closed`) virava advisory em silêncio após qualquer revisão
(`private.work_item_requires_verifier` = false).

## Regra

**Mandated Verifier is monotonic across proposal revisions.** Hierarquia real existente:
`advisory` (ausente/`advisory`) < `required_fail_closed` (qualquer outro valor, conforme
`readVerifierRequirement`). Não foram criados níveis nem mecanismo de rebaixamento.

- App: após o replanejamento, se o item anterior exige Verifier, o spec revisado recebe
  `verifier_requirement: required_fail_closed`; sem execution_spec ⇒ a revisão falha fechada.
  Escopo/gates/limites seguem revisáveis; `canonical_provenance` e `planner` inalterados no contrato.
- Banco: trigger `work_items_verifier_requirement_monotonic` (BEFORE UPDATE OF intent) recusa
  com 42501 qualquer escrita que remova o mandato — cobre as duas RPCs e escrita direta.
  Advisory → mandatado é permitido.

## Provas

- jest: 9 suítes (planner, revisão, rota proposal-corrections, mandated-verification) 178/178;
  5 casos novos em `project-work-planner-revision.test.ts` (regressão TPC-01, revisão de
  escopo/gate/limite com mandato, proveniência/planner, valor legado não-advisory, advisory intacto).
- pgTAP novo `verifier_requirement_monotonic.test.sql` 15/15; relacionados
  (mandated_verifier_review_gate, work_remediation, work_orchestration,
  pending_verification_human_recovery) PASS; bateria completa: só as 3 falhas preexistentes
  conhecidas (budget_blocked_human_resume, compute_routing_decision, work_budget_local_vs_external).
- Migration `20260929000001` aplicada SÓ no Supabase local via `supabase migration up`
  (sem reset). typecheck web PASS; `git diff --check` PASS.
- Nenhum Ollama/OpenAI; nenhuma revisão real; `25c2c047` continua proposed v1 com
  `required_fail_closed`; attempts 0; authority 0; projeção 33/0.

## Próximo ponto exato

Uma única revisão canônica de `25c2c047` para v2 (planner local `qwen2.5-coder:14b` @ 16k), com o
feedback do operador; parar em proposed v2 para nova aprovação humana.
