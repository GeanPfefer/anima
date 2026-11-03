# SDC-23 — diagnóstico de defeito de candidato (candidate recovery)

Registro append-only. Data: 2026-10-07. Branch: `dev` (`6efcc68`). Não houve edição do candidate, do registry nem de código do ANIMA.

## Item e attempt

- Item `7c313b4e-2378-4fe6-bf44-5db6c9316961` (SDC-23, Evolution Reconciliation V4), proposal v2 `codex-cli/default`, estado `failed`.
- Attempt única `ceffe8f5-e32a-4ec5-812f-d9457c287963` (`codex-cli:default`, coder `succeeded`, 98,4 s); orçamento 1/1 consumido; falha `retryable=false` (`[gate_failed]`).
- Base `6efcc68bcf7c76ce0a27a7bf3c90a26e40d05165`. Checkpoint/candidato `6226324b97ab47fa2367af639735690b78c167bf` (branch `anima-work/ceffe8f5-e32a-4ec5-812f-d9457c287963`), filho de `6efcc68`.
- Arquivos alterados (evidência do host e Git, idênticos): `packages/core/src/capability-registry.ts` e `packages/core/src/capability-registry.test.ts`. Nenhum outro arquivo rastreado.

## Falha observada

- Gate que parou a attempt: `Testes focais do core: registry, mapa e proof engine (capability)` (`npm test --workspace=packages/core -- capability`), exit 1. O typecheck do core passou. Os demais gates não rodaram.
- Reprodução independente (extrato do commit `6226324` em diretório de scratch fora do repositório): `capability-registry`: 35 passed, 1 failed.
- A única falha é o teste novo `SDC-23 descreve classificação T3 opt-in e prova viva parcial sem promoção`, em `capability-registry.test.ts` (linha 352):
  `expect(claims).not.toMatch(/Classificação pós-aprovação pelo Resident Host.*?é missing|Host não classifica aprovados não classificados/)`.
- Causa: `claims` concatena description, meaning, advancement, frontiers e notas de history do nó com espaços; a regex lazy `.*?` atravessa frases e frontiers. No nó `agency.continuous-self-development` ela liga "Classificação pós-aprovação pelo Resident Host existe no lane T3 (SDC-22)…" à outra frontier legítima "Retry/recovery genérico de Investigation read_only falha é missing…". É um FALSO POSITIVO do assert.
- O registry NÃO afirma que a classificação pós-aprovação é missing: o texto do nó diz que ela existe no lane T3, parcial, opt-in. O texto do registry está correto.

## Ato

`anima work recover-candidate 7c313b4e-… --diagnosis .tmp/sdc23-diagnosis.json` (autorização `production_candidate_incorrect_v1`, correção `test_failure`, `additionalAttempts=1`).
Correção pedida: ancorar o assert negativo por item de frontier/frase (sem atravessar fronteiras), preservando a proteção negativa; NÃO alterar `capability-registry.ts` nem qualquer comportamento, proofRef, history, maturity, nó ou relação.
O comando NÃO aprova, classifica nem executa; o successor nasce `proposed`.
