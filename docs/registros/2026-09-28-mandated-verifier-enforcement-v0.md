# 2026-09-28 — Mandated Verifier Enforcement V0: Verifier obrigatório e fail-closed no lane mandatado

- **Tipo:** desenvolvimento (core puro + serviço + materializer + CLI). US$ 0, sem provider, sem
  authority, sem migração.
- **Branch:** `dev`. **HEAD inicial:** `c1fa22a` (Mandated Envelope Hardening V0). `main`/`origin/main`
  intactas (`99bec54`).
- **Registry, regras de prova e regras de readiness não alterados.** `agency.produce-change` segue
  `proven`; opção C (critérios operacionais) não implementada; mandato não reativado.
- **Antecedente:** [Hardening V0](2026-09-28-mandated-envelope-hardening-v0.md) — ele removeu `verifier` e
  `fail_closed` do contexto por serem suposição. Esse registro fica preservado como está.

## Modo de falha anterior (Fase 0)

```
attempt → executor worktree (gates host) → record terminal: result_submitted ⇒ item = review
       → release claim
       → persistPostTurnHostObservations (pós-turno):
           gate evidence (.catch) → coder evidence (.catch) → git evidence (.catch)
           → computeAndPersistVerifierOpinion (.catch)   ← só em terminal `result`
```

- O Verifier roda **depois** de o item já estar em `review`.
- Ele pode não rodar (terminal ≠ `result`, leitura de item/eventos falha), lançar ou ter a persistência
  recusada (`record_verifier_opinion`). Também pode devolver `inconclusive` (ex.: sem cobertura de gate)
  ou `rejected`. **Tudo era silencioso:** `.catch(() => undefined)` e desfecho `skipped`/`persist`
  não-fatal.
- Chegava a `review` e era aceitável pelo humano qualquer resultado, com ou sem parecer, e com
  parecer `rejected`/`inconclusive`. Depois de `review` nada é automático: aceite, integração (INT-05) e
  dependências (`completed`) exigem ato humano.

## Fronteira escolhida

O lane é identificado por um **marcador persistido** no `execution_spec`:
`verifier_requirement: 'required_fail_closed'`.

- O **materializer canônico** grava o marcador (o planner do chat não grava: continua `advisory`).
- O **Envelope V1** o exige (`verifier_requirement_not_fail_closed`; check `verifier_required_fail_closed`).
- Valor ausente ou `advisory` ⇒ advisory. Qualquer outro valor ⇒ obrigatório (na dúvida, exige).
- O marcador segue o item: se um humano aprovar um item canônico, o Verifier também é obrigatório.

**Boundary fail-closed = ACEITE do resultado.** `WorkOrchestrationService.reviewResult`, a autoridade
de aplicação usada pela rota web `/reviews` e pela CLI, e `planResultReview` (CLI/UI) recusam o `accept`
de um item com marcador, a menos que haja parecer válido, correlacionado e `verified`
(`evaluateVerifierRequirement`). `request_changes` continua livre (retrabalho pelo fluxo de correção
existente). Falha ao ler item/eventos ⇒ recusa.

O Verifier é salvaguarda técnica, não authority de produto: `verified` **não** aceita nem integra. Ele só
deixa de bloquear o aceite humano.

## Outcomes conclusivos (contrato existente, sem outcome novo)

`verified` e `rejected` concluem; `inconclusive` não conclui. Só `verified` satisfaz a salvaguarda.

## Comportamento em falha

| Situação | Razão | Efeito |
|---|---|---|
| `rejected` (parecer mais recente correlacionado) | `verifier_rejected` | aceite recusado; resultado preservado; `request_changes` → correção |
| `inconclusive` | `verifier_inconclusive` | aceite recusado |
| Verifier lançou / persistência falhou / não rodou | `verifier_missing` | aceite recusado |
| sem resultado/handoff | `verifier_result_missing` | aceite recusado |
| resultado revisado ≠ último, ou versão do item ≠ versão do resultado | `verifier_result_stale` | aceite recusado |
| parecer de outra attempt/resultado/versão | `verifier_uncorrelated` | aceite recusado |

Não há retry automático nem integração. A recuperação é humana: pedir mudanças, que usa o fluxo de
correção já existente. Não se criou framework de recovery.

## Correlação (TOCTOU)

O parecer decisivo é o **mais recente** de `projectVerifierOpinionHistory`, que já descarta os que
divergem do envelope do evento, com:
`workItemId` = item, `approvedProposalVersion` = versão vigente do item, `attemptId` = attempt do handoff
do último resultado, e `evidenceBasis.resultEventId` = último `result_submitted` = resultado que o humano
está aceitando. Um `rejected` posterior derruba um `verified` anterior. Parecer de attempt anterior ou de
resultado anterior nunca conta.

## Runtime guarantee

Só depois do enforcement: `MANDATED_LANE_RUNTIME_GUARANTEES_V0.verifier = 'required_fail_closed'`
(versão do perfil `mandated-worktree-lane-v1`). `verifier` só é presente quando o perfil garante **e** o
próprio item carrega o marcador. `fail_closed` foi recalculado e agora está **presente**: envelope,
histórico, avaliação, contexto, gates allowlisted, escopo, limites, provider local e Verifier obrigatório
negam ao falhar.

**Residual declarado (defesa em profundidade, não tratado):** a RPC SQL `review_work_result_versioned`
não verifica o parecer. Um humano chamando o PostgREST direto com a própria sessão contornaria o gate de
aplicação. O sistema autônomo não tem caminho de aceite. Um gate em SQL exigiria migração da função de
revisão e fica como próximo passo, se desejado.

Itens já existentes sem marcador (materializados antes desta unidade) seguem advisory. Nada retroativo.

## Readiness antes / depois (lane real, histórico real, read-only, sem RPC)

| | Antes (`c1fa22a`) | Depois |
|---|---|---|
| verifier | ausente | presente |
| fail_closed | ausente | presente |
| readiness | **manual** | **supervised** |
| blockers do mandato | `verifier_required`, `operational_criteria_pending` | `operational_criteria_pending` |

```
MATERIALIZE: sim · PROPOSE: sim · AUTO-APPROVE: NÃO · EXECUTE AUTOMATICAMENTE: NÃO
reason: autonomy_readiness_insufficient
detail: agency.produce-change: readiness supervised < mandated (operational_criteria_pending).
```

## Testes

- Core `verifier-requirement.test.ts` (17): marcador; verified satisfaz; rejected; inconclusive;
  ausente (cobre exceção, persistência falha e não-execução); attempt diferente; stale (resultado, versão,
  parecer de resultado anterior); o mais recente decide; advisory inalterado; serviço: verified só libera o
  aceite humano pedido (sem aceite automático), rejected/inconclusive/ausente recusam sem tocar o
  repositório, `request_changes` livre, leitura falha recusa, advisory inalterado; `planResultReview`
  tipado.
- Core `autonomous-authorization.test.ts` (+3): marcador ausente/advisory/desconhecido ⇒
  `verifier_requirement_not_fail_closed`.
- Core `autonomy-readiness-enforcement.test.ts` (30, atualizados): tabela de verdade com
  `verifier`/`fail_closed`; verifier só com enforcement + marcador; perfil advisory anterior ⇒ manual;
  lane real supervised com detail exato; sintético operacional permitido só com todas as salvaguardas;
  invariante (1 liberação, sempre sintética).
- Web `auto-approval.test.ts` (24): estado real negado com zero RPC e detail exato; sintético + regras
  canônicas permitido (sem regra hipotética); item sem marcador negado no envelope; perfil do runtime;
  ponto único (aprovação humana intacta). `canonical-materializer.test.ts` (+1): marcador gravado.
  CLI: mensagem tipada para `verifier_requirement_unsatisfied`.
- Core 2269/2269; typecheck OK; `git diff --check` OK. Web 1945/1946: `worktree-executor.test.ts` falhou só
  sob carga total (56/56 isolado; o arquivo não referencia Verifier, revisão nem envelope).

## Não feito (opção C)

Calibração Verifier × `changes_requested`, taxa de falso positivo, taxa de sucesso, frescor, reliability,
maturidade operacional de produce-change. Gate SQL no aceite (residual acima).
