# 2026-10-14 — Durability D1: item 4dd96db2, attempt 05d54bb2 (falhou antes de executar)

Registro append-only. Plano de origem: `docs/planos/070-d1-preparacao-e0-v2.md` §5. US$0; nenhum banco real lido para os testes; nenhum dump, backup ou restauração.

## Resultado

**FALHOU sem executar o coder**: `execution_failed` (seq 86731) com a mensagem
`Instrução do Codex CLI excede 24000 caracteres (25547); não iniciado.`
A attempt `05d54bb2-7a6c-43d4-b5b9-6ec1ad243bea` durou 2,5 s, não criou checkpoint, resultado nem alteração de arquivo. A causa é o **tamanho do contrato** (objetivo de ~20 mil caracteres com as três referências SQL embutidas), não o conteúdo técnico.

## Cadeia de eventos (todos do item 4dd96db2-3913-4984-8fdc-348a5f9e0288)

| Etapa | Evento / fato |
|---|---|
| Proposta | `proposed` v1, mensagem fonte `a6fe83ec-6875-47d6-a9dd-89a22cd473e4`; `acceptance_contract:2`, sem `resume_from_checkpoint`, `max_attempts:1`, 40 min, base `b6d2dda4`; 6 arquivos (4 em `supabase/restore-proof`, `supabase/tests/restore_proof_snapshot_test.py`, `apps/web/lib/restore-proof/restore-proof-gate.test.ts`) |
| Validação do contrato | `singleItemContractRefusal=null`; `lintItemAcceptanceContract` = v2 sem achados; elegibilidade sem lacunas; allowlist de gates `true,true`; contrato persistido == comando; `singleItemCodexRefusal=null` |
| Aprovação | `work approve` → `approved` |
| Classificação humana | seq 86725 (`bounded/low/reversible/clear/normal`) |
| Orçamento | `admitted:false`, razão `user_attempt_budget_exhausted` (17 `execution_started` em 24 h; limite 6; também 7728 s de runtime ≥ 7200 s no mesmo orçamento interno); item 0/1; sem custo externo |
| Lease E0 | `8fb38a94-53ea-411d-ad08-3610223b831b` (06:57:25–07:27:25Z), concedido apenas por essa recusa; **revogado** após a tentativa; 0 leases vigentes |
| 1ª invocação de `execute-one` | recusada com `resource_pressure` ANTES de qualquer evento (nenhuma attempt iniciada). `admission` voltou a `permit` (27 % de RAM livre) |
| 2ª invocação de `execute-one` | mesma tentativa (item 0/1 consumida de fato só aqui); eventos 86726–86733: roteamento, `work_claimed`, `work_started`, `execution_started`, `execution_failed`, evidência do host (`outcome:failed`, 2515 ms), `work_claim_released` |

Observação sobre “sem retries”: a 1ª invocação não iniciou nenhuma attempt, então foi tratada como a mesma tentativa única ainda não consumida; ficou registrada aqui para revisão humana.

## Estado final

- Item: `failed`, versão 1, `retryable:true` no sinal do executor (não acionado). Branch vazia `anima-work/05d54bb2-…` apontando para a base; nenhuma worktree residual.
- Git: `dev = origin/dev = b6d2dda`, `origin/main = 99bec54`; `git status` com 267 entradas, idêntico (hash) ao de antes; nenhum dos seis arquivos do escopo existe.
- Supabase: ledger de 156 migrations; `work_events` seq 86733 (eram 86721; os 12 eventos novos são os acima + criação/aprovação/classificação); 0 claims vigentes; 0 leases vigentes; a claim histórica de julho permanece aberta e inalterada.
- Sem work accept, integração, push, migration, retry, recovery ou resume.

## Lição e próximo passo possível (exige novo mandato)

O limite de 24000 caracteres da instrução do Codex CLI não é verificado pelo lint do contrato. Para um sucessor: (a) reduzir o objetivo abaixo de ~14 mil caracteres, mantendo embutida só a referência de `memory-snapshot.sql` (a mais complexa, ~4,4 mil) e descrevendo `roles-projection` e `quiescence-gate` pela gramática de saída e pelas definições canônicas já escritas; ou (b) dividir em dois itens: ferramentas SQL + README (com teste Jest/Python mínimo) e a suíte sintética. As referências validadas estão em `G:\anima-durability\evidence\prep-d1\` (`memory-snapshot.sql`, `roles-projection.v2.sql`, `quiescence-gate.v2.sql`, `synthetic-fixture.sql`) e os scripts de contrato em `C:\Users\GeanTeco\anima-recovery\d1\` (`build_d1.mjs`, `command_d1.json`).
