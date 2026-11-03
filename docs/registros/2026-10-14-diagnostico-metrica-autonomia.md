# Diagnóstico — métrica de autonomia (read-only) e menor contrato proposto (2026-10-14)

Append-only. `dev` = `8b5455d3`. Somente leitura (ledger local, código). Nada criado, aprovado, executado, integrado ou publicado. Base: ledger com 3.1k+ eventos, seq 86683; 49 itens `completed`; 60 leases E0.

## 1. O que o ledger observa (e quem assina)
| Classe | Eventos (autor) | Leitura |
|---|---|---|
| Ato humano observado | `work_approved`(user 219), `work_intelligence_classified`(user 22, `human_confirmed`), `result_accepted`(user 49), `integration_effect_authorized`(user 17), `changes_requested`(19), `proposal_changes_requested`(22), `work_cancelled`(11), `work_rejected`(7), `input_provided`, `manual_work_released`, `work_deferred`/`paused`/`control_requested` | autor `user` = identidade residente/RLS |
| Ato de política | `work_approved`(system 42, `authority: autonomous_policy`), `work_intelligence_classified`(system 138, `system_assessed`) | aprovação/classificação sem humano existem, mas só em caminhos canônicos ratificados |
| Fatos de sistema | claim/release, routing, `host_observed_*`, `verifier_opinion_recorded`, `integration_completed` | evidência, não decisão |
| Proposta | `work_proposed`(autor `anima`, 204), `context_attached` | NÃO prova autoria autônoma: propostas dirigidas por humano/supervisor também saem como `anima` |
| Execução | `work_started`(user 187/anima 2), `execution_started`, `checkpoint_recorded`, `result_submitted`, `execution_failed`(95) | `work_started.reason` = `supervised_execution` em 180/182; **0** reasons de operação não supervisionada |

## 2. Números (observados; limites inferiores)
- Itens `completed`: 49. Atos humanos observados por item concluído (aprovação/classificação humana/aceite/autorização de integração/etc.): média 3,8; mín 3, máx 7. **Nenhum completed com 0 atos humanos.** Desde 2026-10-07: 19 itens, média 4,6, mín 3, máx 5. Antes: 30 itens, média 3,3.
- Atos de política por item concluído: média 1,0 (0,6 desde 10-07): o sistema classifica/aprova, mas o aceite e a classificação humana continuam presentes.
- Leases E0: 60 (7 em 10-07, 2 em 10-13, 9 em 10-14, 1 do V5). 30 dos 49 itens completed tiveram lease (14 desde 10-07). 56 dos 60 leases cobrem uma claim no intervalo do lease.
- Attempts: 182 claims em 160 itens; 84 `result_submitted`; 95 `execution_failed`; 1 `attempt_abandoned`. Desde 10-07: 27 claims, 21 submitted, 6 failed.
- Origem declarada (`intent.planner`): 24+ itens `operator_supervisor_claude_v0` (14 completed), 13 `human_explicit_independent_proposal` completed, 3 `resident-*-proof` em review. Nenhuma execução demonstra operação sem humano.

## 3. Lacunas e limites epistemológicos
1. **Autor `user` ≠ humano digitando.** O supervisor (Claude) opera com a mesma identidade residente; o ledger não distingue ato humano de ato do supervisor sob mandato no chat. Exige-se um campo de proveniência (ex.: `actor_kind`) ou aceitar "humano ou supervisor autenticado".
2. **E0 fora do ledger.** `work_supervision_leases` é tabela sem eventos; só dá para ler (RLS `select_own`). Ausência de lease ≠ ausência de supervisão.
3. **`owner_instance_id` é texto livre do chamador** (`supervisor-v0`, `single-item-*`, `selfdev-*`…): não é sinal de autonomia.
4. **Supervisão externa não registrada:** leitura de tela, decisão no chat, `git sync`, `push`, quem rodou `execute-one`.
5. **Falhas sem código estruturado:** `execution_failed` tem `reason` genérico + `message` livre + `retryable`; classificar por causa exige parsing de texto.
6. **Lineage não canônico:** só `replaces_work_item_id` (1), `depends_on_work_item_ids` (5), `prior_attempt_context` (7), `historical_references` (17), `resume_from_checkpoint` (44), `recovery_provenance` (2). O denominador por lineage só vale onde há elo explícito.
7. Ausência de evento nunca vira "sem intervenção".

## 4. Definições propostas (autonomy-evidence-v0, função pura no Core)
- **Unidade:** item (`work_item_id`), com lineage apenas por elos explícitos; janela por `result_accepted`/terminal (default 14 dias e "desde sempre"; sempre mostrar n).
- **Atos humanos observados (HO):** contagem por tipo da §1 (autor `user`), excluindo `work_started`.
- **Atos de política (PO):** approve/classify com autor `system`.
- **Supervisão E0 observada (LS):** nº de leases do item (entrada externa ao ledger).
- **Falhas:** `execution_failed`/attempt, separados em `failed_attempts` e `completed`; nunca somados a atos humanos; razão = texto bruto + `retryable`.
- **Modo observado de início:** `work_started.reason`.
- **Classes de ciclo (mutuamente exclusivas):** `human_directed` (planner humano/supervisor), `policy_approved`, `unattended_candidate`, `unknown`.
- **Critério verificável para ciclo sem intervenção humana (positivo, não por ausência):** (a) aprovação `autonomous_policy` e classificação `system_assessed`; (b) 0 eventos de autor `user` entre `work_proposed` e o evento terminal; (c) 0 leases E0 do item; (d) claim feita pelo Resident Host com fato de sistema próprio (`host_observed_*` com `execution_mode: unattended`, assinado pelo Trusted System Writer — **inexistente hoje**); (e) `work_started.reason` ≠ `supervised_execution`. Se (d)/(e) faltarem ⇒ `unknown`, nunca `unattended`. Aceite humano é medido à parte: "unattended até review" ≠ "autônomo até completed".
- **Resultado atual:** 0 ciclos `unattended_candidate`; 49 completed `human_directed`/`policy_approved` com ≥3 atos humanos.

## 5. Apresentação mínima (reuso)
Em `page.tsx` já existe `autonomyReadiness` (referência `agency.run-tests`) com o bloqueador `autonomous_operation_evidence_unavailable`. Proposta: o Core calcula `AutonomyEvidenceSummary` (função pura sobre eventos canônicos já lidos por `readCapabilityEvolution` + leases) e o `autonomyReadiness` passa a anexar um bloco "Evidência de autonomia": itens concluídos (n, janela), atos humanos por item (média, mín–máx), % com E0, tentativas falhas, ciclos `unattended_candidate` (0), e "N desconhecidos". O bloqueador só é substituído quando houver ≥1 ciclo `unattended_candidate` verificado; **nenhuma maturidade muda automaticamente** (o motor de prova segue decidindo).

## 6. Menor contrato governado (proposto; NÃO criado)
- **Escopo (3 arquivos + 1 teste novo):** `packages/core/src/autonomy-evidence.ts` (+ `autonomy-evidence.test.ts` novo, `test_binding` ≥10 testes), `apps/web/lib/evolution/capability-assessment-read.ts` (ler leases user-scoped e repassar), `apps/web/app/(app)/evolution/page.tsx` + componente de bloco read-only em `EvolutionClient.tsx` (+ ajuste de seu teste). Sem migration, sem schema.
- **Dados:** eventos já lidos (2764+), `work_supervision_leases` (SELECT), `intent.planner`, `execution_spec`.
- **Testes positivos:** contagem por item; janela; lease ligado a item; `unattended_candidate` só com (a)–(e) sintéticos completos. **Adversariais:** ausência de eventos ⇒ `unknown`; autor `user` do supervisor conta como humano; `owner_instance_id` forjado não vira autônomo; evento `system` isolado não basta; lease expirado ainda conta; falha não reduz atos humanos; janela vazia ⇒ "sem dados" (não zero); `maturity` nunca alterada.
- **Regressões/dependências:** `EvolutionClient.test.tsx`; `capability-proof-engine` e `autonomy-readiness` (entrada nova opcional); leitura de leases sob RLS; custo da página (reusar a mesma leitura).
- **Fora do escopo (próximos):** emitir fato `execution_mode: unattended` pelo host e eventos de E0 (exigem migration e autorização própria); `actor_kind` humano×supervisor; código estruturado de falha.
