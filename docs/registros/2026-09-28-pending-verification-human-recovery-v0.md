# 2026-09-28 — Pending Verification Human Recovery V0

Recuperação HUMANA de resultado candidato retido no lane com Verifier obrigatório.
Base: `dev` = `origin/dev` = `4ea8505` (Trusted System Writer V0; snapshot
`backup/marco-trusted-system-writer-v0-2026-09-28`). `main` = `99bec54` intacta. US$0.

Referências: [Mandated Verifier Enforcement V0/V0.1 + Trusted System Writer V0](2026-09-28-mandated-verifier-enforcement-v0.md) ·
PRD (topo) · CLI [`apps/web/cli/README.md`](../../apps/web/cli/README.md).

## Por que o candidato pode ficar retido

No lane `execution_spec.verifier_requirement = required_fail_closed`:

```
executor → result_submitted (CANDIDATO) → item continua in_progress
         → Verifier: inconclusive | missing | timeout | error | evidence_incomplete | commit_mismatch
         → reconcile_supervised_work relata result_pending_verification
         → Supervisor re-verifica a cada volta
```

Um Verifier que falha de forma DETERMINÍSTICA (ou o Trusted System Writer não provisionado,
que impede gravar o parecer) deixa o item `in_progress` indefinidamente. Não havia saída
humana: `request_changes` só existe em `review`; `submit_work_result` não resolve (e colidiria
com o terminal); `release_manual_work` só vale para start manual sem attempt/desfecho.

## Princípio: controle humano ≠ bypass da verificação

O humano pode dizer "pare de tentar verificar; quero retrabalho" ou "cancele". Nunca
"considere verificado". Só o gate técnico do Verifier libera `review` neste lane.

## Contrato (`public.resolve_pending_verification(work_item_id, result_event_id, decision, decision_context)`)

Migração `supabase/migrations/20260928000004_pending_verification_human_recovery.sql`
(aplicada só LOCAL com `supabase migration up`; typegen regenerado).

- `decision ∈ {request_changes, cancel}` — qualquer outro valor ⇒ `22023`.
- Autoridade: `auth.uid()` + allowlist + posse (`user_id`); GRANT só `authenticated`;
  evento `author=user`. O Trusted System Writer NÃO participa (funciona sem ele).
- Identidade exata revalidada sob `FOR UPDATE` do item: lane obrigatório; `state=in_progress`;
  `result_event_id` = `result_submitted` MAIS RECENTE; versão do resultado = versão vigente;
  attempt do resultado = attempt do `execution_started` mais recente (derivados, nunca
  escolhidos pelo caller); veredito SQL não conclusivo (`verified`/`rejected` ⇒ não é pendente).
- Nenhum novo evento/enum: reusa `changes_requested` e `work_cancelled`. Única linha nova na
  matriz: `in_progress --changes_requested--> changes_requested` (`in_progress --work_cancelled-->
  cancelled` já existia). Invariante explícita no corpo: alvo ∉ {changes_requested, cancelled} ⇒ recusa.
- Payload: `origin=pending_verification_recovery`, `resolved_result_event_id`, `attempt_id`,
  `approved_proposal_version`, `verifier_status` (veredito no momento da decisão).

### REQUEST_CHANGES

`in_progress → changes_requested`. Payload repete o shape do review (`requested_changes`,
`reviewed_proposal_version`, `reviewed_result_event_id`), então a correção governada por
retomada existente (`record_recovery_successor` aceita original `changes_requested`;
`anima work correct`) segue igual. Nenhum sucessor é criado aqui (outra decisão). Candidato,
attempt, pareceres, evidência e lineage preservados (append-only).

### CANCEL

`in_progress → cancelled` (`reason` opcional; default `pending_verification_cancelled`).
Sem review, aceite ou integração. Histórico preservado.

### Idempotência

Mesma decisão + mesmo texto sobre o mesmo candidato ⇒ devolve o item, sem evento novo.
Decisão (ou texto) divergente após resolução ⇒ `55000 pending verification already resolved
with a different decision`. Outro `result_event_id` / attempt / versão ⇒ `55000 pending
verification candidate changed`.

## Concorrência / atomicidade

`resolve_pending_verification`, `record_verifier_opinion`, o terminal e o review tomam
`SELECT … FOR UPDATE` na MESMA linha de `work_items`. Uma transição vence:

- Verifier primeiro (parecer conclusivo ⇒ `review`): a decisão humana relê `state=review` ⇒
  `55000` (usar o review normal: `accept`/`request_changes`).
- Humano primeiro: o parecer tardio é persistido como histórico (append-only), mas
  `release_mandated_result` não libera (estado ≠ `in_progress` e veredito `human_resolved`).

Defesa persistente: `private.mandated_result_verdict` passa a devolver `human_resolved` para
um candidato com resolução humana marcada. Logo `guard_mandated_review_release` (trigger),
`release_mandated_result` e `review_work_result_versioned(accept)` recusam ESSE candidato para
sempre — inclusive se o item voltar a `in_progress` por retrabalho manual. `changes_requested →
review` e `cancelled → review` não existem na matriz e o trigger os recusa.

Não executado: corrida real em duas sessões Postgres simultâneas. As duas ordens de
serialização foram provadas em pgTAP; a exclusão mútua decorre do row lock comum.

## Reconciliação e Supervisor

`reconcile_supervised_work` (corpo vigente + 1 ramo): veredito `human_resolved` ⇒ não relata
`result_pending_verification`, não materializa `review`, não abandona a attempt. O Supervisor
só re-verifica o que a reconciliação relata. Defesa de aplicação em
`verifyAndReleaseCandidate`: item em `changes_requested`/`cancelled`/terminal ⇒
`held:candidate_not_pending`; candidato marcado como resolvido ⇒ `held:candidate_resolved_by_human`
— sem computar nem gravar parecer.

## Superfícies

- Core puro `packages/core/src/work-orchestration/pending-verification-recovery.ts`:
  `projectPendingVerificationCandidate` (identidade exata), validação da decisão, contexto RPC.
- `WorkOrchestrationService.resolvePendingVerification` → repositório Supabase → RPC.
- CLI: `anima work resolve-pending <id> request-changes --reason "…"` | `… cancel [--reason "…"]`
  (identidade residente = o dono; exit 3 se o item não retém candidato pendente).
- Rota `POST /api/work-orchestration/pending-verification-resolutions`.
- UI (botões "Request changes"/"Cancel" no cartão do candidato pendente): NÃO feita — futuro;
  a rota já é o seam.

Itens advisory: fora do escopo (RPC recusa); review normal inalterado.

## Provas

- pgTAP `supabase/tests/pending_verification_human_recovery.test.sql` — 51/51: request_changes
  ⇒ changes_requested; cancel ⇒ cancelled; sem review/parecer/aceite/integração; resultEventId
  errado/inexistente; attempt e versão stale; advisory; review; completed; replay idempotente
  (ambas); request_changes→cancel e cancel→request_changes ⇒ conflito; Verifier antes/depois do
  humano; trigger recusa review do candidato resolvido (inclusive após voltar a in_progress);
  reconcile não relata/materializa/abandona; writer ausente para o dono durante a recuperação;
  outro usuário (P0002), fora da allowlist (42501), anon (42501); aceite do candidato resolvido
  recusado.
- Suíte pgTAP inteira: 64/67 arquivos verdes; 3 falhas PRÉ-EXISTENTES já registradas
  (`compute_routing_decision`, `budget_blocked_human_resume`, `work_budget_local_vs_external`).
  `mandated_verifier_review_gate` (29) e `trusted_system_writer` seguem verdes.
- Jest: core 2322/2322 (inclui `pending-verification-recovery.test.ts`); `packages/supabase`
  `repository.test.ts` 11/11; web: CLI, `mandated-verification` (+3 casos) e `supervisor`
  (+ caso 17) verdes; suíte web completa 1990/1995 — 5 falhas em `worktree-executor.test.ts` e
  `runpod-node-provisioner.test.ts` (timeouts sob carga), ambas 97/97 verdes isoladas; não tocadas aqui.
- `npm run typecheck` verde.

## Não feito (fora de escopo, deliberado)

Retry policy/max attempts do Verifier, Option C, reliability/freshness/maturity, self-dev,
provisionamento do writer, provider pago, UI. Nenhum efeito externo; US$0.

## Retomada

Próximo: operador provisionar o Trusted System Writer (sem ele o Verifier retém TODO candidato
do lane, e esta primitive é a saída humana); UI mínima sobre a rota; eventualmente corrida
real em duas sessões como prova adicional.
