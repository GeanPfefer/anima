# 2026-09-03 — Prova viva do replan real do PIN-02 (fallback 14b, barreira de edição)

**Tipo:** prova viva end-to-end da capability de replanejamento (Plano 007) + correção
de integração + evidência de limite do modelo/estratégia.
**Branch:** dev. **HEAD de código:** `ae6d6d9` (= `origin/dev`, pushado). `main` = `99bec54` intacta.

Continua [implementação do replan](2026-09-02-replanejamento-unidade-minima-implementacao.md)
e o [diagnóstico do PIN-02](2026-09-02-diagnostico-semantico-pin02.md). Não é PIN-03.

## Objetivo atingido (plano governado) e barreira final (compute/estratégia)

Primeira prova real da cadeia **falha determinística → diagnóstico humano ratificado →
plano semanticamente diferente → nova execução governada**, sem chamar de retry e sem
reduzir escopo. Chegou até a execução do coder pelo fallback governado; parou numa
falha de edição do modelo 14b na única tentativa transferida.

## Cadeia executada (tudo pela via canônica)

1. **Push:** ff `70fea87→4b5c500` para `origin/dev` (capability do Plano 007). Depois `ae6d6d9`.
2. **Diagnóstico humano ratificado** por Gean e materializado no schema real (`ReplanDiagnosis`:
   `finding=test_code_incorrect`; 3 corrections `resolve_imports`/`respect_api_types`/
   `assert_public_boundary` com símbolos REAIS confirmados no código; `evidenceReference`
   = registro do diagnóstico). Fatos comprovados: o teste do checkpoint `1ee1921` usava
   `serializeProjectIdeaV0`/`deserializeProjectIdeaV0` sem import e INEXISTENTES na API
   pública (real = `draftProjectIdea`/`validateProjectIdea`), prop `version` em vez de
   `schemaVersion`, `serialize({})` e testes duplicados → falha de COMPILAÇÃO determinística.
3. **`anima work replan 5b8e371d --diagnosis <json>`** (CLI, identidade residente) → successor
   `7b132de5` **proposed**; lineage `4b63fe6b` seq 1; falha correlacionada `b6783ef2`; attempt
   `0cfdd6cb`; **budget transferido used 2 + alloc 1 = max 3** (não resetado).
4. **Inspeção:** escopo mínimo idêntico (`project-intake.test.ts` incl; `project-intake.ts`+
   supabase/apps/types excl), `max_attempts=1`, `resume_from_checkpoint` de `0cfdd6cb`, 3 critérios
   preservados (2 gates+covers, 1 `proof:scope`), objetivo materialmente diferente (embute o
   diagnóstico, corrige a direção errada). Todas as condições do mandato §7 OK.
5. **`anima work approve 7b132de5`** → **approved**.
6. **Classificação canônica** (`ensurePlannedProjectClassification`, a mesma função da rota
   `prepare-autonomous`, sob identidade residente). Dois gaps que o Plano 007 §Gates ANTECIPOU
   barravam o successor — corrigidos em `ae6d6d9` (sem hackear o budget):
   - budget: aceitar `max_attempts∈[1,3]` (era `===3`), pois o replan transfere saldo;
   - lineage: subir MÚLTIPLOS hops (`replan → correção → original PIN-02`) até a proveniência
     canônica, com guarda de ciclo/órfão/teto (era um único hop). +4 testes; 14/14.
7. **Resident Host** (`npm run local-host`, in-process, autonomia + fallback governado) → o
   Supervisor **selecionou naturalmente**: classified → routing → claimed → started →
   `execution_started` (attempt `ab7e7b6f`).
8. **Fallback governado ENGAJOU** (evidência host-observed `CoderModelSelectionEvidenceV1`):
   `preferred qwen3-coder:latest (18GB) excede a capacidade (16GB) → selected qwen2.5-coder:14b
   (10GB), downgraded=true, reason=preferred_exceeds_capacity`.

## Barreira final (§11): edição do 14b

O coder 14b rodou (~48s), gravou um `checkpoint` parcial e então falhou com
`[ollama_ambiguous_replacement] "before" ocorre 0 vez(es) em project-intake.test.ts`
(âncora de `replace_exact` não casou; `retryable:true`). O gate focado reprovou (exitCode 1).
Como o **budget transferido era 1**, esgotou-se: item `7b132de5` = **failed** (used 1/1). O
Resident Host entrou em `waiting_human_or_recovery` e **NÃO** criou outro replan nem
auto-retentou — o anti-loop do Plano 007 e a fronteira de budget seguraram.

Conforme o mandato §11: **PAREI**. Não criei outro replan, não afrouxei nada, **não usei
compute pago**. Registro esta evidência como possível **limite de capacidade do modelo/
estratégia de edição** do 14b (âncora inexistente), agravado por a unidade só ter 1 tentativa
transferida. Fica como próximo alvo: robustez do protocolo de edição do coder local sob o 14b
(classe já vista no fix de CRLF `applyEditOperations`), OU mais budget/estratégia.

## Estado final

Mecanismo do Plano 007 provado end-to-end até a execução governada; a integração
replan↔classificação foi fechada (`ae6d6d9`). O PIN-02 NÃO convergiu a review: barreira no
edit do 14b. `origin/dev`=`ae6d6d9`; `main` intacta; PIN-03 não aberto.
