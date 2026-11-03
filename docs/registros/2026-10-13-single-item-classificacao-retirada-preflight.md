# 2026-10-13 — Classificação humana, retirada do item obsoleto e preflight da primeira attempt

Tipo: governança e preflight (sem código). Branch dev, HEAD a4f46f8 inicial e final; sem commit, push, migration, Host,
claim, attempt ou API paga. Sequência do [registro da aprovação](2026-10-13-single-item-aprovacao-sucessor.md).

## Classificação humana de `d795e414-d603-4153-883e-124fea9ac732`

Precondições: `approved` v1, nenhuma classificação (RPC de leitura devolveu null), revisão 0. Valores confirmados pelo humano e
validados por `validateWorkIntelligenceClassification` (null) e pelos enums reais: complexity `bounded`, risk `low`,
reversibility `reversible`, planClarity `clear`, urgency `normal`; proveniência `human_confirmed`, classifierId = identidade
autenticada (e570e43b…). Adequação: três arquivos com escopo/critérios explícitos; função pura sem I/O; worktree isolada, sem
integração e com revisão humana do resultado. `record_work_intelligence_classification` (p_expected_proposal_version=1,
p_expected_classification_revision=0) pela identidade RLS: `recorded`, **revisão 1**, evento `work_intelligence_classified`
**seq 86381** (event_id cbd488f3-57df-4389-bd42-65a23f5d40b7). `prepare-autonomous` não foi repetido.

## Retirada de `b5f8178a`

`work withdraw` (mecanismo oficial) com o motivo auditável: evento `work_cancelled` **seq 86382**, `withdrawn_from_state=approved`,
`withdrawn_before_execution=true`; estado `cancelled` v1. Uma primeira chamada via `npm.cmd` falhou no cmd.exe (aspas do
argumento) antes de chegar à CLI, sem efeito; a chamada válida usou `node` direto com o mesmo CLI. `cde9684e` intocado
(`changes_requested` v2, 18 eventos).

## Preflight (somente leitura)

PASS: contrato V1 (`singleItemContractRefusal`=null, sem `resume_from_checkpoint`); elegibilidade de domínio; classificação rev 1;
HEAD == base `a4f46f87…` e os 3 arquivos sem alterações; `select_autonomous_work` seleciona `d795e414 v1`; orçamento admitido
(0/1 tentativa; 30 min); ledger 156, RPC scoped e `verify_after` PASS; Docker/Supabase/Auth/PostgREST saudáveis; 0 claims
válidas; 0 attempts; nenhum `in_progress` do usuário/alvo (os 3 `in_progress` são de outros usuários, julho/agosto); Codex 0.162.0
e login ChatGPT; `singleItemCodexRefusal`=null; `ANIMA_CODEX_*` não persistidas (.env.local e variáveis de usuário/máquina);
RAM livre 6,1 GB, WSL 5,3 GB, disco ok; sem `node`/`codex`.

Comando validado no parser (`parseArgs` → `work-execute-one`, versão 1, json). Evidências em
`C:\Users\GeanTeco\anima-recovery\classification-withdraw-preflight-*\`.
