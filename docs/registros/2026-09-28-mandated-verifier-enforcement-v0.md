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

---

## V0.1 (2026-09-28) — fechar a fronteira de REVIEW + defesa persistente

HEAD inicial `59eb37e`. Uma auditoria independente apontou que o V0 era **acceptance-gated**, não
**lane-gated**. O residual declarado acima (RPC SQL de revisão sem gate) era real: o item entrava em
`review` na RPC terminal **antes** do Verifier, e uma chamada direta ao PostgREST aceitava sem parecer.
Esse fato do V0 fica preservado aqui. A migração é `20260928000000_mandated_verifier_review_gate.sql`.

### Resultado candidato (sem estado novo)

No lane (`verifier_requirement` ≠ `advisory`), `record_commanded_work_terminal` grava `result_submitted`,
que é o **resultado candidato**, durável e com identidade própria, e mantém o item em `in_progress`.
Nenhum enum novo: reuso de `in_progress` + evento existente. `review` **não** é usado como "pendente de
verificação". Lanes advisory continuam indo direto a `review`.

### Ponto de liberação para review

`record_verifier_opinion` persiste o parecer e, **na mesma transação**, chama
`private.release_mandated_result`. Ela move `in_progress → review` só quando o veredito decisivo
(`private.mandated_result_verdict`) é conclusivo: `verified`, ou `rejected` para inspeção/retrabalho.
A transição é justificada pelo próprio `verifier_opinion_recorded` (linha nova da matriz normativa
`in_progress × verifier_opinion_recorded → review`); nenhum evento sintético é criado. Replay: sem evento
novo, liberação reavaliada. Retorno: `released_for_review`.

Ordem host-side (pós-turno, agora obrigatória): evidência de gate → coder → git → Verifier → persistência →
**releitura** (`verifyAndReleaseCandidate`). Só o `review` relido conta como liberado.

### Persistence / read-back

Parecer em memória não conta. A liberação relê o log no SQL, e o host relê o item depois de persistir.
Persistência recusada ⇒ `persist_failed` (retido). Item relido fora de `review` ⇒ `release_not_observed`
(retido). Releitura falha ⇒ `readback_failed` (retido).

### Correlação (`private.mandated_result_verdict`)

O parecer **mais recente** com: item, `proposal_version` do item, `attempt_id` do resultado,
`result_event_id` = **último** `result_submitted`. A base dele precisa de: evidência git do host da
mesma attempt/versão **com `observedCommitSha` = `commitSha` do handoff do resultado**, evidência de gate
da mesma attempt/versão e evidência do coder da mesma attempt/versão. Saídas: `verified | rejected |
inconclusive | missing | result_mismatch | evidence_incomplete | commit_mismatch`. Parecer antigo nunca
libera resultado novo, e resultado antigo não é aceitável. O core (`evaluateVerifierRequirement`)
espelha a exigência de evidência git+gate (`verifier_evidence_incomplete`).

### Defesa SQL

- **Trigger** `guard_mandated_review_release` (BEFORE UPDATE OF state em `work_items`): recusa (55000)
  **qualquer** transição do lane para `review` sem veredito conclusivo. Cobre terminal, submissão manual,
  reconciliação e escrita direta. Consequência declarada: a submissão manual (`submit_work_result`) de
  um item do lane é recusada; ele só chega a `review` pelo Verifier.
- **`review_work_result_versioned`**: `accept` do lane exige `mandated_result_verdict = 'verified'`
  para o resultado aceito (`verifier requirement not satisfied`). `request_changes` segue livre.
- **`reconcile_supervised_work`**: um candidato pendente **não** é materializado em `review` nem
  abandonado. É relatado como `result_pending_verification` / `requires_verification`, e o supervisor
  re-verifica (`verifyAndReleaseCandidate`) antes da seleção. Crash entre candidato e Verifier ⇒ o
  restart não abre janela de review.

### Autoria do Verifier (residual — NÃO resolvido)

`record_verifier_opinion` é `SECURITY DEFINER`, chamável por qualquer usuário autenticado da allowlist,
e carimba `author='system'`/`origin='verifier'`. O host residente usa a **mesma** identidade do usuário
(GoTrue → Bearer → RLS). Não existe mecanismo para distinguir um parecer do Verifier do host de uma
submissão arbitrária do cliente sem uma identidade de sistema nova (fora do escopo; sem PKI).
Consequência: `MANDATED_LANE_RUNTIME_GUARANTEES_V0` (agora `mandated-worktree-lane-v2`) declara
`verifier: required_fail_closed` (o enforcement existe) e `verifierAuthorship: user_session_unproven`,
e **`fail_closed` NÃO é declarado**.

### Timeout

`MANDATED_VERIFIER_TIMEOUT_MS = 60_000` explícito (compute + persistência). Estouro ⇒ `verifier_timeout`
(retido; a reconciliação relata e a próxima volta re-verifica). Não depende de timeout de transporte.

### Readiness

Lane real (histórico real, read-only, sem RPC): **supervised**; o mandato é bloqueado **só** por
`operational_criteria_pending` (a maturidade nem chega a avaliar as salvaguardas do mandato).
`fail_closed` aparece em `missingForNext`. Auto-aprovação: **DENY** (`autonomy_readiness_insufficient`).
Nenhum item real carrega o marcador ainda (88 itens lidos): nada existente muda de comportamento.

### Testes V0.1

- pgTAP `supabase/tests/mandated_verifier_review_gate.test.sql` (29): candidato fica `in_progress`;
  resultado durável; replay do terminal sem duplicata; advisory direto a review; reconciliação relata
  pendente, não materializa, não abandona; trigger recusa escrita direta; inconclusive não libera;
  verified sem gate não libera; commit incoerente não libera; attempt/versão/resultEventId errados
  recusados; verified correlacionado libera (atômico); verified não gera `result_accepted`; replay do
  parecer sem duplicata; rejected mais recente ⇒ aceite direto recusado; aceite com resultado errado
  recusado; rejected libera para inspeção, aceite recusado, `request_changes` funciona; aceite humano com
  verified corrente funciona; advisory aceita sem parecer.
- Web `mandated-verification.test.ts` (12): released (verified/rejected), inconclusive, throw, timeout,
  persistência recusada, sem resultado, read-back divergente, read-back falho, nunca aceita, advisory
  inalterado.
- Core: `verifier-requirement.test.ts` (18, +evidência incompleta); `autonomy-readiness-enforcement.test.ts`
  (30: `fail_closed` ausente por autoria; invariante 0 liberações com o runtime real).
  Web `auto-approval.test.ts` (25): sintético + regras canônicas negado por `fail_closed`; caminho da RPC
  só com regra hipotética explícita; perfil com `verifierAuthorship`.
- Suíte SQL completa: 3 arquivos falharam, nenhum toca as funções alteradas nem usa o marcador:
  `compute_routing_decision` (assinatura de função inexistente), `budget_blocked_human_resume` e
  `work_budget_local_vs_external` (política de orçamento posterior). Pré-existentes.
- Core 2270/2270; typecheck OK; `git diff --check` OK. Web 1957/1959: `project-tools` e
  `worktree-executor` são flakes de carga conhecidos (4/4 e 56/56 isolados).
- Não testado por unidade: o wiring da re-verificação no supervisor (o fake não suporta o repositório);
  a garantia de "sem janela de review" está provada no SQL.

### Residuais após V0.1

Autoria do parecer (acima). Um candidato persistentemente inconclusivo fica `in_progress` sem saída
humana dedicada (a reconciliação o relata; saída governada = trabalho futuro). Submissão manual de item
do lane recusada por construção.
